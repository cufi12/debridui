import { createDecipheriv } from "node:crypto";
import { lookup } from "node:dns/promises";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { isIP } from "node:net";
import { load as loadCheerio } from "cheerio";
import { getQuickJS } from "quickjs-emscripten";
import { sanitizeStreamHeaders } from "@/lib/addons/parser";
import type { ProviderInvocation } from "@/lib/plugins/provider-adapter";

const PROVIDER_TIMEOUT_MS = 28_000;
const FETCH_TIMEOUT_MS = 10_000;
const MAX_REQUESTS = 24;
const MAX_RESPONSE_BYTES = 1_500_000;
const MAX_TOTAL_RESPONSE_BYTES = 6_000_000;
const MAX_DOM_DOCUMENTS = 12;
const MAX_DOM_OPERATIONS = 2_000;

type ProviderFetchInit = {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
};

type PinnedResponse = {
    status: number;
    url: string;
    headers: Record<string, string>;
    body: string;
};

let quickJsPromise: ReturnType<typeof getQuickJS> | undefined;

function isPublicIpv4(address: string): boolean {
    if (isIP(address) !== 4) return false;
    const [a, b, c] = address.split(".").map(Number);
    if (a === undefined || b === undefined || c === undefined) return false;

    return !(
        a === 0 ||
        a === 10 ||
        a === 127 ||
        a >= 224 ||
        (a === 169 && b === 254) ||
        (a === 172 && b >= 16 && b <= 31) ||
        (a === 192 && (b === 0 || b === 168)) ||
        (a === 100 && b >= 64 && b <= 127) ||
        (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) ||
        (a === 203 && b === 0 && c === 113)
    );
}

async function resolvePublicIpv4(hostname: string): Promise<string> {
    if (isIP(hostname) === 4) {
        if (!isPublicIpv4(hostname)) throw new Error("Private or reserved network addresses are blocked.");
        return hostname;
    }
    if (isIP(hostname) === 6 || hostname.endsWith(".local") || hostname === "localhost") {
        throw new Error("This network destination is blocked.");
    }

    const records = await lookup(hostname, { all: true, verbatim: true });
    const ipv4Records = records.filter((record) => record.family === 4);
    if (!ipv4Records.length || ipv4Records.some((record) => !isPublicIpv4(record.address))) {
        throw new Error("Private or reserved network addresses are blocked.");
    }
    const ipv4 = ipv4Records[0];
    if (!ipv4) throw new Error("The destination has no public IPv4 address.");
    return ipv4.address;
}

function normalizeRequestHeaders(value: unknown): Record<string, string> {
    const safe = sanitizeStreamHeaders(value) ?? {};
    return Object.fromEntries(Object.entries(safe).map(([key, header]) => [key, header]));
}

async function requestPinned(url: URL, init: ProviderFetchInit, signal: AbortSignal): Promise<PinnedResponse> {
    if (url.protocol !== "https:" && url.protocol !== "http:") {
        throw new Error("Only HTTP and HTTPS provider requests are supported.");
    }
    const standardPort = url.protocol === "https:" ? "443" : "80";
    if (url.username || url.password || (url.port && url.port !== standardPort)) {
        throw new Error("Credentials and non-standard network ports are blocked.");
    }

    const address = await resolvePublicIpv4(url.hostname);
    const method = (init.method || "GET").toUpperCase();
    if (!["GET", "POST", "HEAD"].includes(method)) {
        throw new Error("Provider request method is not supported.");
    }
    if (init.body !== undefined && (typeof init.body !== "string" || init.body.length > 64_000)) {
        throw new Error("Provider request body is too large or unsupported.");
    }

    const transport = url.protocol === "https:" ? httpsRequest : httpRequest;
    const headers = normalizeRequestHeaders(init.headers);
    const body = method === "GET" || method === "HEAD" ? undefined : init.body;

    return await new Promise<PinnedResponse>((resolve, reject) => {
        let settled = false;
        const request = transport(
            url,
            {
                method,
                headers,
                timeout: FETCH_TIMEOUT_MS,
                lookup: ((
                    _hostname: string,
                    _options: unknown,
                    callback: (error: NodeJS.ErrnoException | null, address: string, family: number) => void
                ) => {
                    callback(null, address, 4);
                }) as never,
            },
            (response) => {
                const chunks: Buffer[] = [];
                let total = 0;
                response.on("data", (chunk: Buffer | string) => {
                    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
                    total += buffer.byteLength;
                    if (total > MAX_RESPONSE_BYTES) {
                        request.destroy(new Error("Provider response exceeds 1.5 MB."));
                        return;
                    }
                    chunks.push(buffer);
                });
                response.on("error", (error) => {
                    if (!settled) {
                        settled = true;
                        reject(error);
                    }
                });
                response.on("end", () => {
                    if (settled) return;
                    settled = true;
                    const responseHeaders = Object.fromEntries(
                        Object.entries(response.headers).flatMap(([key, value]) =>
                            value === undefined
                                ? []
                                : [[key.toLowerCase(), Array.isArray(value) ? value.join(", ") : String(value)]]
                        )
                    );
                    resolve({
                        status: response.statusCode ?? 0,
                        url: url.toString(),
                        headers: responseHeaders,
                        body: Buffer.concat(chunks).toString("utf8"),
                    });
                });
            }
        );

        const abort = () => request.destroy(new Error("Provider request was cancelled."));
        if (signal.aborted) abort();
        else signal.addEventListener("abort", abort, { once: true });

        request.on("timeout", () => request.destroy(new Error("Provider request timed out.")));
        request.on("error", (error) => {
            if (!settled) {
                settled = true;
                reject(error);
            }
        });
        request.end(body);
    });
}

async function safeProviderFetch(
    rawUrl: string,
    init: ProviderFetchInit,
    signal: AbortSignal
): Promise<PinnedResponse> {
    let url = new URL(rawUrl);
    let method = init.method || "GET";
    let body = init.body;
    let headers = normalizeRequestHeaders(init.headers);

    for (let redirectCount = 0; redirectCount <= 3; redirectCount++) {
        const response = await requestPinned(url, { method, body, headers }, signal);
        const location = response.headers.location;
        if (![301, 302, 303, 307, 308].includes(response.status) || !location) return response;
        if (redirectCount === 3) throw new Error("Too many provider redirects.");

        const nextUrl = new URL(location, url);
        if (nextUrl.origin !== url.origin) {
            headers = Object.fromEntries(
                Object.entries(headers).filter(
                    ([name]) => !["authorization", "cookie", "proxy-authorization"].includes(name.toLowerCase())
                )
            );
        }
        if (
            response.status === 303 ||
            ((response.status === 301 || response.status === 302) && method.toUpperCase() === "POST")
        ) {
            method = "GET";
            body = undefined;
        }
        url = nextUrl;
    }
    throw new Error("Provider redirect failed.");
}

function createQuickJsResponse(
    vm: ReturnType<Awaited<ReturnType<typeof getQuickJS>>["newContext"]>,
    response: PinnedResponse
) {
    const object = vm.newObject();
    const status = vm.newNumber(response.status);
    const url = vm.newString(response.url);
    vm.setProp(object, "status", status);
    vm.setProp(object, "ok", response.status >= 200 && response.status < 300 ? vm.true : vm.false);
    vm.setProp(object, "url", url);
    status.dispose();
    url.dispose();

    const text = vm.newFunction("text", () => vm.newString(response.body));
    vm.setProp(object, "text", text);
    text.dispose();

    const json = vm.newFunction("json", () => {
        const parsed = JSON.parse(response.body) as unknown;
        const result = vm.evalCode(`(${JSON.stringify(parsed)})`);
        return vm.unwrapResult(result);
    });
    vm.setProp(object, "json", json);
    json.dispose();

    const headers = vm.newObject();
    const getHeader = vm.newFunction("get", (name) => {
        const value = response.headers[vm.getString(name).toLowerCase()];
        return value == null ? vm.null : vm.newString(value);
    });
    vm.setProp(headers, "get", getHeader);
    getHeader.dispose();
    vm.setProp(object, "headers", headers);
    headers.dispose();

    return object;
}

/**
 * Return only the selected media's TMDB detail record locally. This narrow
 * compatibility shim avoids exposing a TMDB credential in the provider VM.
 */
function localTmdbDetail(rawUrl: string, invocation: ProviderInvocation): PinnedResponse | null {
    const url = new URL(rawUrl);
    if (url.hostname !== "api.themoviedb.org") return null;
    const pathParts = url.pathname.split("/").filter(Boolean);
    if (pathParts.length !== 3 || pathParts[0] !== "3") {
        throw new Error("Provider TMDB access is limited to the selected media record.");
    }
    const kind = pathParts[1];
    const id = Number(pathParts[2]);
    if ((kind !== "movie" && kind !== "tv") || !Number.isSafeInteger(id)) {
        throw new Error("Provider TMDB access is limited to the selected media record.");
    }
    if (id !== invocation.tmdbId || kind !== invocation.mediaType) {
        throw new Error("Provider TMDB access is limited to the selected media record.");
    }
    const title = invocation.title || "";
    const year = invocation.year && Number.isInteger(invocation.year) ? String(invocation.year) : "";
    const date = year ? year + "-01-01" : "";
    const payload =
        kind === "movie"
            ? {
                  id,
                  title,
                  original_title: title,
                  release_date: date,
                  imdb_id: invocation.imdbId || null,
                  external_ids: { imdb_id: invocation.imdbId || null },
                  translations: { translations: [] },
                  alternative_titles: { titles: [] },
              }
            : {
                  id,
                  name: title,
                  original_name: title,
                  first_air_date: date,
                  external_ids: { imdb_id: invocation.imdbId || null },
                  translations: { translations: [] },
                  alternative_titles: { results: [] },
              };
    return {
        status: 200,
        url: url.toString(),
        headers: { "content-type": "application/json; charset=utf-8" },
        body: JSON.stringify(payload),
    };
}

type DomApi = ReturnType<typeof loadCheerio>;
type DomSelection = ReturnType<DomApi>;

function installProviderCompatibility(vm: ReturnType<Awaited<ReturnType<typeof getQuickJS>>["newContext"]>) {
    let nextId = 1;
    let domOperations = 0;
    const chargeDomOperation = () => {
        if (++domOperations > MAX_DOM_OPERATIONS) throw new Error("Provider exceeded the DOM operation limit.");
    };
    const documents = new Map<number, DomApi>();
    const selections = new Map<number, DomSelection>();
    const selectionOwners = new Map<number, DomApi>();
    const saveSelection = (document: DomApi, selection: DomSelection): number => {
        chargeDomOperation();
        const id = nextId++;
        selections.set(id, selection);
        selectionOwners.set(id, document);
        return id;
    };
    const getSelection = (id: number): DomSelection => {
        const selection = selections.get(id);
        if (!selection) throw new Error("Invalid provider DOM reference.");
        return selection;
    };
    const getDocument = (id: number): DomApi => {
        const document = documents.get(id);
        if (!document) throw new Error("Invalid provider DOM document.");
        return document;
    };
    const getOwner = (id: number): DomApi => {
        const document = selectionOwners.get(id);
        if (!document) throw new Error("Invalid provider DOM reference.");
        return document;
    };
    const setFunction = (name: string, fn: ReturnType<typeof vm.newFunction>) => {
        vm.setProp(vm.global, name, fn);
        fn.dispose();
    };

    setFunction(
        "__domLoad",
        vm.newFunction("__domLoad", (html) => {
            const source = vm.getString(html);
            if (Buffer.byteLength(source, "utf8") > MAX_RESPONSE_BYTES) throw new Error("Provider HTML exceeds 1.5 MB.");
            if (documents.size >= MAX_DOM_DOCUMENTS) throw new Error("Provider exceeded the DOM document limit.");
            chargeDomOperation();
            const document = loadCheerio(source);
            const id = nextId++;
            documents.set(id, document);
            return vm.newNumber(id);
        })
    );
    setFunction(
        "__domSelect",
        vm.newFunction("__domSelect", (documentId, selector, contextId) => {
            const document = getDocument(vm.getNumber(documentId));
            const context = vm.getNumber(contextId);
            const selection = context
                ? document(vm.getString(selector), getSelection(context) as never)
                : document(vm.getString(selector));
            return vm.newNumber(saveSelection(document, selection));
        })
    );
    setFunction(
        "__domFind",
        vm.newFunction("__domFind", (selectionId, selector) => {
            const id = vm.getNumber(selectionId);
            return vm.newNumber(saveSelection(getOwner(id), getSelection(id).find(vm.getString(selector))));
        })
    );
    setFunction(
        "__domFirst",
        vm.newFunction("__domFirst", (selectionId) => {
            const id = vm.getNumber(selectionId);
            return vm.newNumber(saveSelection(getOwner(id), getSelection(id).first()));
        })
    );
    setFunction(
        "__domEq",
        vm.newFunction("__domEq", (selectionId, index) => {
            const id = vm.getNumber(selectionId);
            return vm.newNumber(saveSelection(getOwner(id), getSelection(id).eq(vm.getNumber(index))));
        })
    );
    setFunction(
        "__domText",
        vm.newFunction("__domText", (selectionId) => {
            chargeDomOperation();
            return vm.newString(getSelection(vm.getNumber(selectionId)).text());
        })
    );
    setFunction(
        "__domHtml",
        vm.newFunction("__domHtml", (selectionId) => {
            chargeDomOperation();
            const value = getSelection(vm.getNumber(selectionId)).html();
            return value == null ? vm.null : vm.newString(value);
        })
    );
    setFunction(
        "__domAttr",
        vm.newFunction("__domAttr", (selectionId, name) => {
            chargeDomOperation();
            const value = getSelection(vm.getNumber(selectionId)).attr(vm.getString(name) ?? "");
            return value == null ? vm.null : vm.newString(value);
        })
    );
    setFunction(
        "__domNodes",
        vm.newFunction("__domNodes", (selectionId) => {
            const id = vm.getNumber(selectionId);
            const document = getOwner(id);
            const ids = getSelection(id)
                .toArray()
                .map((node) => saveSelection(document, document(node as never)));
            return vm.newString(JSON.stringify(ids));
        })
    );

    const moduleCode =
        'class ProviderCheerioCollection {\n    constructor(ids, documentId) { this.ids = ids; this.documentId = documentId; }\n    get length() { return this.ids.length; }\n    find(selector) {\n        if (!this.ids.length) return new ProviderCheerioCollection([], this.documentId);\n        return new ProviderCheerioCollection([__domFind(this.ids[0], String(selector))], this.documentId);\n    }\n    first() {\n        if (!this.ids.length) return new ProviderCheerioCollection([], this.documentId);\n        return new ProviderCheerioCollection([__domFirst(this.ids[0])], this.documentId);\n    }\n    eq(index) {\n        if (!this.ids.length) return new ProviderCheerioCollection([], this.documentId);\n        return new ProviderCheerioCollection([__domEq(this.ids[0], Number(index))], this.documentId);\n    }\n    text() { return this.ids.length ? __domText(this.ids[0]) : ""; }\n    html() { return this.ids.length ? __domHtml(this.ids[0]) : null; }\n    attr(name) { return this.ids.length ? __domAttr(this.ids[0], String(name)) : undefined; }\n    toArray() { return this.ids.flatMap((id) => JSON.parse(__domNodes(id))); }\n    get(index) { return index === undefined ? this.toArray() : this.toArray()[index]; }\n    each(callback) { this.toArray().forEach((id, index) => callback.call(id, index, id)); return this; }\n    map(callback) { return this.toArray().map((id, index) => callback.call(id, index, id)); }\n}\nglobalThis.__cheerioModule = {\n    load(html) {\n        const documentId = __domLoad(String(html));\n        const select = (selector, context) => {\n            if (selector instanceof ProviderCheerioCollection) return selector;\n            if (typeof selector === "number") return new ProviderCheerioCollection([selector], documentId);\n            const contextId = context instanceof ProviderCheerioCollection ? (context.ids[0] || 0) : 0;\n            return new ProviderCheerioCollection([__domSelect(documentId, String(selector), contextId)], documentId);\n        };\n        return select;\n    }\n};\nglobalThis.__cryptoJsModule = {\n    lib: { CipherParams: { create(value) { return value; } } },\n    enc: {\n        Utf8: { parse(value) { return { utf8: String(value) }; } },\n        Hex: { parse(value) { return { hex: String(value) }; } },\n        Latin1: "Latin1"\n    },\n    mode: { CBC: "CBC" },\n    pad: { Pkcs7: "Pkcs7" },\n    AES: {\n        decrypt(params, key, options) {\n            const ciphertext = params && params.ciphertext && params.ciphertext.hex;\n            const keyText = key && key.utf8;\n            const ivText = options && options.iv && options.iv.utf8;\n            if (typeof ciphertext !== "string" || typeof keyText !== "string" || typeof ivText !== "string") {\n                throw new Error("Unsupported CryptoJS AES parameters.");\n            }\n            return { toString(encoder) {\n                if (encoder !== "Latin1") throw new Error("Only CryptoJS Latin1 output is supported.");\n                return __cryptoAesCbcDecrypt(ciphertext, keyText, ivText);\n            }};\n        }\n    }\n};';
    const evaluated = vm.evalCode(moduleCode);
    vm.unwrapResult(evaluated).dispose();

    const aesDecrypt = vm.newFunction("__cryptoAesCbcDecrypt", (ciphertext, key, iv) => {
        const hex = vm.getString(ciphertext);
        if (!/^(?:[0-9a-f]{2})+$/i.test(hex)) throw new Error("Invalid AES ciphertext.");
        const keyBytes = Buffer.from(vm.getString(key), "utf8");
        const ivBytes = Buffer.from(vm.getString(iv), "utf8");
        const encrypted = Buffer.from(hex, "hex");
        if (
            ![16, 24, 32].includes(keyBytes.length) ||
            ivBytes.length !== 16 ||
            !encrypted.length ||
            encrypted.length % 16 !== 0
        ) {
            throw new Error("Invalid AES-CBC key, IV, or ciphertext length.");
        }
        const decipher = createDecipheriv("aes-" + keyBytes.length * 8 + "-cbc", keyBytes, ivBytes);
        return vm.newString(Buffer.concat([decipher.update(encrypted), decipher.final()]).toString("latin1"));
    });
    setFunction("__cryptoAesCbcDecrypt", aesDecrypt);

    const requireFunction = vm.newFunction("require", (name) => {
        const moduleName = vm.getString(name);
        if (moduleName !== "cheerio" && moduleName !== "crypto-js") {
            throw new Error('Provider module "' + moduleName + '" is not supported.');
        }
        return vm.getProp(vm.global, moduleName === "cheerio" ? "__cheerioModule" : "__cryptoJsModule");
    });
    setFunction("require", requireFunction);
}

/**
 * Execute a single-file CommonJS-style Nuvio provider in QuickJS.
 * The VM receives no Node globals, filesystem, process environment, or ambient cookies.
 * All outbound requests are DNS-checked and pinned to public IPv4 addresses.
 */
export async function executeNuvioProvider(source: string, invocation: ProviderInvocation): Promise<unknown> {
    if (source.length > 500_000) throw new Error("Provider source exceeds 500 KB.");
    if (!quickJsPromise) quickJsPromise = getQuickJS();
    const QuickJS = await quickJsPromise;
    const vm = QuickJS.newContext();
    const deadline = Date.now() + PROVIDER_TIMEOUT_MS;
    const controllers = new Set<AbortController>();
    const deferredPromises: ReturnType<typeof vm.newPromise>[] = [];
    let requestCount = 0;
    let totalResponseBytes = 0;
    let disposed = false;
    let promiseHandle: ReturnType<typeof vm.newString> | undefined;
    let timeoutId: ReturnType<typeof setTimeout> | undefined;

    vm.runtime.setMemoryLimit(16 * 1024 * 1024);
    vm.runtime.setMaxStackSize(512 * 1024);
    vm.runtime.setInterruptHandler(() => Date.now() > deadline);

    const consoleObject = vm.newObject();
    const noop = vm.newFunction("noop", () => vm.undefined);
    for (const method of ["log", "info", "warn", "error", "debug"]) {
        vm.setProp(consoleObject, method, noop);
    }
    vm.setProp(vm.global, "console", consoleObject);
    noop.dispose();
    consoleObject.dispose();

    const atob = vm.newFunction("atob", (value) =>
        vm.newString(Buffer.from(vm.getString(value), "base64").toString("binary"))
    );
    const btoa = vm.newFunction("btoa", (value) =>
        vm.newString(Buffer.from(vm.getString(value), "binary").toString("base64"))
    );
    vm.setProp(vm.global, "atob", atob);
    vm.setProp(vm.global, "btoa", btoa);
    atob.dispose();
    btoa.dispose();

    const parseUrl = vm.newFunction("__parseUrl", (input, base) => {
        const rawInput = vm.getString(input);
        const rawBase = base && vm.typeof(base) !== "undefined" ? vm.getString(base) : undefined;
        const parsed = rawBase ? new URL(rawInput, rawBase) : new URL(rawInput);
        return vm.newString(
            JSON.stringify({
                href: parsed.href,
                origin: parsed.origin,
                protocol: parsed.protocol,
                username: parsed.username,
                password: parsed.password,
                host: parsed.host,
                hostname: parsed.hostname,
                port: parsed.port,
                pathname: parsed.pathname,
                search: parsed.search,
                hash: parsed.hash,
            })
        );
    });
    vm.setProp(vm.global, "__parseUrl", parseUrl);
    parseUrl.dispose();

    const urlPolyfills = vm.evalCode(`
        class URLSearchParams {
            constructor(init = "") {
                this._entries = [];
                if (typeof init === "string") {
                    const query = init.replace(/^\\?/, "");
                    for (const part of query.split("&")) {
                        if (!part) continue;
                        const index = part.indexOf("=");
                        const key = index < 0 ? part : part.slice(0, index);
                        const value = index < 0 ? "" : part.slice(index + 1);
                        this._entries.push([
                            decodeURIComponent(key.replace(/\\+/g, " ")),
                            decodeURIComponent(value.replace(/\\+/g, " ")),
                        ]);
                    }
                } else if (Array.isArray(init)) {
                    for (const pair of init) this.append(String(pair[0]), String(pair[1]));
                } else if (init && typeof init === "object") {
                    for (const [key, value] of Object.entries(init)) this.append(key, String(value));
                }
            }
            append(key, value) { this._entries.push([String(key), String(value)]); }
            set(key, value) {
                key = String(key);
                const first = this._entries.findIndex((entry) => entry[0] === key);
                this._entries = this._entries.filter((entry) => entry[0] !== key);
                this._entries.splice(first < 0 ? this._entries.length : first, 0, [key, String(value)]);
            }
            get(key) { return this._entries.find((entry) => entry[0] === String(key))?.[1] ?? null; }
            getAll(key) { return this._entries.filter((entry) => entry[0] === String(key)).map((entry) => entry[1]); }
            has(key) { return this._entries.some((entry) => entry[0] === String(key)); }
            delete(key) { this._entries = this._entries.filter((entry) => entry[0] !== String(key)); }
            toString() {
                return this._entries.map(([key, value]) =>
                    encodeURIComponent(key).replace(/%20/g, "+") + "=" + encodeURIComponent(value).replace(/%20/g, "+")
                ).join("&");
            }
            entries() { return this._entries[Symbol.iterator](); }
            keys() { return this._entries.map((entry) => entry[0])[Symbol.iterator](); }
            values() { return this._entries.map((entry) => entry[1])[Symbol.iterator](); }
            forEach(callback, thisArg) {
                for (const [key, value] of this._entries) callback.call(thisArg, value, key, this);
            }
            [Symbol.iterator]() { return this.entries(); }
        }
        class URL {
            constructor(input, base) {
                const parsed = JSON.parse(__parseUrl(String(input), base));
                const initialSearch = parsed.search || "";
                delete parsed.href;
                delete parsed.search;
                Object.assign(this, parsed);
                this.searchParams = new URLSearchParams(initialSearch);
            }
            get search() {
                const query = this.searchParams.toString();
                return query ? "?" + query : "";
            }
            set search(value) { this.searchParams = new URLSearchParams(value); }
            get href() { return this.toString(); }
            toString() {
                return this.origin + this.pathname + this.search + this.hash;
            }
        }
        globalThis.URL = URL;
        globalThis.URLSearchParams = URLSearchParams;
    `);
    vm.unwrapResult(urlPolyfills).dispose();

    installProviderCompatibility(vm);

    // Nuvio's shared TMDB module interpolates this marker into the detail URL.
    // The host intercepts that exact request and never forwards the marker.
    const tmdbKey = vm.newString("debridui-local-media-metadata");
    vm.setProp(vm.global, "TMDB_API_KEY", tmdbKey);
    tmdbKey.dispose();

    const fetchFunction = vm.newFunction("fetch", (...args) => {
        if (++requestCount > MAX_REQUESTS) throw new Error("Provider exceeded the request limit.");
        let rawUrl: string;
        if (vm.typeof(args[0]) === "string") {
            rawUrl = vm.getString(args[0]);
        } else {
            const href = vm.getProp(args[0], "href");
            if (vm.typeof(href) === "string") {
                rawUrl = vm.getString(href);
            } else {
                const stringResult = vm.callMethod(args[0], "toString");
                const stringHandle = vm.unwrapResult(stringResult);
                rawUrl = vm.getString(stringHandle);
                stringHandle.dispose();
            }
            href.dispose();
        }
        const init = args[1] ? (vm.dump(args[1]) as ProviderFetchInit) : {};
        const controller = new AbortController();
        controllers.add(controller);
        const deferred = vm.newPromise();
        deferredPromises.push(deferred);

        const localResponse = localTmdbDetail(rawUrl, invocation);
        const requestPromise = localResponse
            ? Promise.resolve(localResponse)
            : safeProviderFetch(rawUrl, init, controller.signal);
        void requestPromise
            .then((response) => {
                totalResponseBytes += Buffer.byteLength(response.body, "utf8");
                if (totalResponseBytes > MAX_TOTAL_RESPONSE_BYTES) {
                    throw new Error("Provider exceeded the total response size limit.");
                }
                if (disposed) return;
                const responseHandle = createQuickJsResponse(vm, response);
                deferred.resolve(responseHandle);
                responseHandle.dispose();
                vm.runtime.executePendingJobs();
            })
            .catch((error: unknown) => {
                if (disposed) return;
                const errorHandle = vm.newString(error instanceof Error ? error.message : "Provider fetch failed.");
                deferred.reject(errorHandle);
                errorHandle.dispose();
                vm.runtime.executePendingJobs();
            })
            .finally(() => controllers.delete(controller));

        return deferred.handle;
    });
    vm.setProp(vm.global, "fetch", fetchFunction);
    fetchFunction.dispose();

    const args = [invocation.tmdbId, invocation.mediaType, invocation.season, invocation.episode].map((value) =>
        value === undefined ? "undefined" : JSON.stringify(value)
    );

    const code = `
        (async function () {
            const module = { exports: {} };
            const exports = module.exports;
            ${source}
            const provider = module.exports && (module.exports.default || module.exports);
            if (!provider || typeof provider.getStreams !== "function") {
                throw new Error("Provider must export getStreams().");
            }
            return await provider.getStreams(${args.join(", ")});
        })()
    `;

    try {
        const evaluated = vm.evalCode(code, "provider.js");
        promiseHandle = vm.unwrapResult(evaluated);
        const resolvedPromise = vm.resolvePromise(promiseHandle);
        vm.runtime.executePendingJobs();

        const timeout = new Promise<never>((_, reject) => {
            const remaining = Math.max(1, deadline - Date.now());
            timeoutId = setTimeout(() => reject(new Error("Provider execution timed out.")), remaining);
        });
        const result = await Promise.race([resolvedPromise, timeout]);
        const value = vm.unwrapResult(result);
        const output = vm.dump(value);
        value.dispose();
        return output;
    } finally {
        disposed = true;
        if (timeoutId) clearTimeout(timeoutId);
        promiseHandle?.dispose();
        for (const controller of controllers) controller.abort();
        for (const deferred of deferredPromises) deferred.dispose();
        vm.dispose();
    }
}
