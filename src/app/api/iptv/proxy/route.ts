import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function isPrivateIPv4(ip: string): boolean {
    const parts = ip.split(".").map(Number);
    if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return true;
    const [a, b] = parts;
    return a === 0 || a === 10 || a === 127 || a >= 224 ||
        (a === 100 && b >= 64 && b <= 127) ||
        (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) ||
        (a === 192 && (b === 0 || b === 168)) ||
        (a === 198 && (b === 18 || b === 19));
}

function isPublicAddress(ip: string): boolean {
    const version = isIP(ip);
    if (version === 4) return !isPrivateIPv4(ip);
    if (version === 6) {
        const value = ip.toLowerCase();
        // Only globally-routable unicast IPv6; reject local, mapped and transition ranges.
        return value.startsWith("2") || value.startsWith("3");
    }
    return false;
}

async function validateTarget(url: URL): Promise<void> {
    if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("Nur HTTP- und HTTPS-Adressen sind erlaubt.");
    if (url.username || url.password) throw new Error("Zugangsdaten bitte als URL-Parameter übergeben, nicht im Hostnamen.");
    const hostname = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
    if (hostname === "localhost" || hostname.endsWith(".localhost") || hostname.endsWith(".local")) {
        throw new Error("Lokale Netzwerkadressen sind nicht erlaubt.");
    }
    const version = isIP(hostname);
    const addresses = version ? [{ address: hostname }] : await lookup(hostname, { all: true, verbatim: true });
    if (!addresses.length || addresses.some(({ address }) => !isPublicAddress(address))) {
        throw new Error("Die Zieladresse ist nicht öffentlich erreichbar oder nicht erlaubt.");
    }
}

async function fetchFollowingRedirects(initial: URL): Promise<Response> {
    let target = new URL(initial);
    for (let redirects = 0; redirects <= 5; redirects++) {
        await validateTarget(target);
        const response = await fetch(target, {
            method: "GET", cache: "no-store", redirect: "manual",
            signal: AbortSignal.timeout(25000),
            headers: { Accept: "*/*", "User-Agent": "Mozilla/5.0 DebridUI IPTV" },
        });
        if (![301, 302, 303, 307, 308].includes(response.status)) return response;
        const location = response.headers.get("location");
        if (!location || redirects === 5) throw new Error("Zu viele oder ungültige Weiterleitungen des Anbieters.");
        target = new URL(location, target);
    }
    throw new Error("Zu viele Weiterleitungen des Anbieters.");
}

function cleanAttribute(value: unknown): string {
    return String(value ?? "").replace(/[\r\n"]/g, " ").trim();
}

async function tryXtreamFallback(original: URL): Promise<string | null> {
    if (!/\/get\.php$/i.test(original.pathname)) return null;
    const username = original.searchParams.get("username");
    const password = original.searchParams.get("password");
    if (!username || !password) return null;

    const apiUrl = new URL(original);
    apiUrl.pathname = apiUrl.pathname.replace(/get\.php$/i, "player_api.php");
    apiUrl.search = "";
    apiUrl.searchParams.set("username", username);
    apiUrl.searchParams.set("password", password);

    const apiResponse = await fetchFollowingRedirects(apiUrl);
    if (!apiResponse.ok) throw new Error("Xtream-API antwortet mit HTTP " + apiResponse.status + ".");
    const account = await apiResponse.json() as {
        user_info?: { auth?: number | string; status?: string };
        server_info?: { url?: string; server_protocol?: string; port?: string | number; https_port?: string | number };
    };
    if (String(account.user_info?.auth) !== "1") {
        throw new Error("Xtream-API hat den Zugang nicht bestätigt. Bitte Zugang beim Anbieter prüfen.");
    }

    const streamsUrl = new URL(apiUrl);
    streamsUrl.searchParams.set("action", "get_live_streams");
    const categoriesUrl = new URL(apiUrl);
    categoriesUrl.searchParams.set("action", "get_live_categories");
    const [streamsResponse, categoriesResponse] = await Promise.all([
        fetchFollowingRedirects(streamsUrl),
        fetchFollowingRedirects(categoriesUrl).catch(() => null),
    ]);
    if (!streamsResponse.ok) throw new Error("Xtream-Senderliste antwortet mit HTTP " + streamsResponse.status + ".");
    const streams = await streamsResponse.json() as Array<{
        stream_id?: number | string; name?: string; category_id?: number | string;
        stream_icon?: string; epg_channel_id?: string;
    }>;
    const categories = categoriesResponse?.ok
        ? await categoriesResponse.json() as Array<{ category_id?: number | string; category_name?: string }>
        : [];
    if (!Array.isArray(streams) || !streams.length) throw new Error("Xtream-API hat keine Live-Sender geliefert.");

    let streamBase = new URL(original.origin);
    const server = account.server_info;
    if (server?.url) {
        const candidate = new URL(server.url.includes("://") ? server.url : original.protocol + "//" + server.url);
        const protocol = server.server_protocol === "https" ? "https:" : server.server_protocol === "http" ? "http:" : candidate.protocol;
        candidate.protocol = protocol;
        const port = protocol === "https:" ? server.https_port : server.port;
        if (port && /^\d{1,5}$/.test(String(port))) candidate.port = String(port);
        streamBase = candidate;
    }
    streamBase.pathname = "/";
    streamBase.search = "";
    streamBase.hash = "";
    await validateTarget(streamBase);

    const categoryNames = new Map(categories.map((item) => [String(item.category_id), cleanAttribute(item.category_name)]));
    const output = ["#EXTM3U"];
    const extension = original.searchParams.get("output")?.toLowerCase() === "m3u8" ? "m3u8" : "ts";
    for (const stream of streams) {
        if (stream.stream_id == null) continue;
        const name = cleanAttribute(stream.name) || ("Sender " + stream.stream_id);
        const group = categoryNames.get(String(stream.category_id)) || "Weitere Sender";
        const logo = cleanAttribute(stream.stream_icon);
        const epgId = cleanAttribute(stream.epg_channel_id);
        output.push("#EXTINF:-1" + (epgId ? ' tvg-id="' + epgId + '"' : "") +
            (logo ? ' tvg-logo="' + logo + '"' : "") + ' group-title="' + group + '",' + name);
        output.push(new URL("/live/" + encodeURIComponent(username) + "/" + encodeURIComponent(password) +
            "/" + encodeURIComponent(String(stream.stream_id)) + "." + extension, streamBase).toString());
    }
    return output.join("\n");
}

export async function GET(request: NextRequest) {
    const rawUrl = request.nextUrl.searchParams.get("url");
    if (!rawUrl) return NextResponse.json({ error: "URL fehlt." }, { status: 400 });

    let target: URL;
    try {
        target = new URL(rawUrl);
        await validateTarget(target);
    } catch (error) {
        return NextResponse.json({ error: error instanceof Error ? error.message : "Ungültige Zieladresse." }, { status: 400 });
    }

    try {
        const upstream = await fetchFollowingRedirects(target);
        let body: ArrayBuffer;
        let contentType = upstream.headers.get("content-type") || "text/plain; charset=utf-8";

        if (upstream.status === 884 && /\/get\.php$/i.test(target.pathname)) {
            const generated = await tryXtreamFallback(target);
            if (generated) {
                body = new TextEncoder().encode(generated).buffer as ArrayBuffer;
                contentType = "audio/x-mpegurl; charset=utf-8";
            } else {
                return NextResponse.json({
                    error: "Der Anbieter blockiert den M3U-Download (HTTP 884). Automatischer Xtream-Fallback ist mit dieser URL nicht möglich. Die URL muss die Parameter username und password enthalten.",
                }, { status: 502 });
            }
        } else {
            if (!upstream.ok) {
                const status = upstream.status >= 400 && upstream.status < 600 ? upstream.status : 502;
                return NextResponse.json({ error: "Anbieter antwortet mit HTTP " + upstream.status + "." }, { status });
            }
            const declaredLength = Number(upstream.headers.get("content-length") || 0);
            if (declaredLength > 20 * 1024 * 1024) {
                return NextResponse.json({ error: "Die Playlist/EPG-Datei ist grösser als 20 MB." }, { status: 413 });
            }
            body = await upstream.arrayBuffer();
        }

        if (body.byteLength > 20 * 1024 * 1024) {
            return NextResponse.json({ error: "Die Playlist/EPG-Datei ist grösser als 20 MB." }, { status: 413 });
        }
        return new Response(body, {
            status: 200,
            headers: { "Content-Type": contentType, "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" },
        });
    } catch (error) {
        const message = error instanceof Error && error.name === "TimeoutError"
            ? "Zeitüberschreitung beim IPTV-Anbieter."
            : error instanceof Error && error.message.startsWith("Xtream-")
                ? error.message
                : "Der IPTV-Anbieter konnte vom Server nicht erreicht werden.";
        return NextResponse.json({ error: message }, { status: 502 });
    }
}
