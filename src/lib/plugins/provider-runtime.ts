import { lookup } from "node:dns/promises";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { isIP } from "node:net";
import { getQuickJS } from "quickjs-emscripten";
import { sanitizeStreamHeaders } from "@/lib/addons/parser";
import type { ProviderInvocation } from "@/lib/plugins/provider-adapter";

const PROVIDER_TIMEOUT_MS = 15_000;
const FETCH_TIMEOUT_MS = 8_000;
const MAX_REQUESTS = 12;
const MAX_RESPONSE_BYTES = 1_000_000;
const MAX_TOTAL_RESPONSE_BYTES = 3_000_000;

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
    if (url.username || url.password || (url.port && url.port !== "80" && url.port !== "443")) {
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
                        request.destroy(new Error("Provider response exceeds 1 MB."));
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
        return value === undefined ? vm.null : vm.newString(value);
    });
    vm.setProp(headers, "get", getHeader);
    getHeader.dispose();
    vm.setProp(object, "headers", headers);
    headers.dispose();

    return object;
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

    const fetchFunction = vm.newFunction("fetch", (...args) => {
        if (++requestCount > MAX_REQUESTS) throw new Error("Provider exceeded the request limit.");
        const rawUrl = vm.getString(args[0]);
        const init = args[1] ? (vm.dump(args[1]) as ProviderFetchInit) : {};
        const controller = new AbortController();
        controllers.add(controller);
        const deferred = vm.newPromise();
        deferredPromises.push(deferred);

        void safeProviderFetch(rawUrl, init, controller.signal)
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
