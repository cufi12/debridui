import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { type NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function isPublicAddress(ip: string): boolean {
    const version = isIP(ip);
    if (version === 4) {
        const p = ip.split(".").map(Number);
        if (p.length !== 4 || p.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return false;
        const [a, b] = p;
        return !(
            a === 0 ||
            a === 10 ||
            a === 127 ||
            a >= 224 ||
            (a === 100 && b >= 64 && b <= 127) ||
            (a === 169 && b === 254) ||
            (a === 172 && b >= 16 && b <= 31) ||
            (a === 192 && (b === 0 || b === 168)) ||
            (a === 198 && (b === 18 || b === 19))
        );
    }
    if (version === 6) {
        const value = ip.toLowerCase();
        return value.startsWith("2") || value.startsWith("3");
    }
    return false;
}

async function validateTarget(url: URL): Promise<void> {
    if (url.protocol !== "http:" && url.protocol !== "https:")
        throw new Error("Nur HTTP- und HTTPS-Streams sind erlaubt.");
    if (url.username || url.password) throw new Error("Zugangsdaten im URL-Host sind nicht erlaubt.");
    const hostname = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
    if (hostname === "localhost" || hostname.endsWith(".localhost") || hostname.endsWith(".local"))
        throw new Error("Lokale Netzwerkadressen sind nicht erlaubt.");
    const version = isIP(hostname);
    const addresses = version ? [{ address: hostname }] : await lookup(hostname, { all: true, verbatim: true });
    if (!addresses.length || addresses.some(({ address }) => !isPublicAddress(address)))
        throw new Error("Die Stream-Adresse ist nicht öffentlich erreichbar oder nicht erlaubt.");
}

async function fetchUpstream(initial: URL, range: string | null): Promise<{ response: Response; finalUrl: URL }> {
    let target = new URL(initial);
    for (let redirects = 0; redirects <= 5; redirects++) {
        await validateTarget(target);
        const headers = new Headers({ Accept: "*/*", "User-Agent": "Mozilla/5.0 DebridUI IPTV" });
        if (range) headers.set("Range", range);
        const response = await fetch(target, {
            headers,
            cache: "no-store",
            redirect: "manual",
            signal: AbortSignal.timeout(30000),
        });
        if (![301, 302, 303, 307, 308].includes(response.status)) return { response, finalUrl: target };
        const location = response.headers.get("location");
        if (!location || redirects === 5) throw new Error("Zu viele oder ungültige Weiterleitungen des Anbieters.");
        target = new URL(location, target);
    }
    throw new Error("Zu viele Weiterleitungen des Anbieters.");
}

function proxiedUrl(target: URL): string {
    return "/api/iptv/stream?url=" + encodeURIComponent(target.toString());
}

export async function GET(request: NextRequest) {
    const raw = request.nextUrl.searchParams.get("url");
    if (!raw) return NextResponse.json({ error: "Stream-URL fehlt." }, { status: 400 });
    let initial: URL;
    try {
        initial = new URL(raw);
        await validateTarget(initial);
    } catch (error) {
        return NextResponse.json(
            { error: error instanceof Error ? error.message : "Ungültige Stream-Adresse." },
            { status: 400 }
        );
    }

    try {
        const { response, finalUrl } = await fetchUpstream(initial, request.headers.get("range"));
        if (!response.ok && response.status !== 206) {
            return new Response("IPTV-Anbieter antwortet mit HTTP " + response.status + ".", {
                status: response.status,
            });
        }
        const contentType = response.headers.get("content-type") || "application/octet-stream";
        const isPlaylist = /mpegurl|m3u8/i.test(contentType) || /\.m3u8$/i.test(finalUrl.pathname);
        const headers = new Headers({
            "Content-Type": contentType,
            "Cache-Control": "no-store",
            "X-Content-Type-Options": "nosniff",
        });
        for (const name of ["content-range", "accept-ranges", "content-length"]) {
            const value = response.headers.get(name);
            if (value && !isPlaylist) headers.set(name, value);
        }

        if (isPlaylist) {
            const text = await response.text();
            if (text.length > 2 * 1024 * 1024) return new Response("HLS-Playlist ist zu gross.", { status: 413 });
            const rewritten = text
                .split(/\r?\n/)
                .map((line) => {
                    const trimmed = line.trim();
                    if (!trimmed || (trimmed.startsWith("#") && !/URI="([^"]+)"/i.test(trimmed))) return line;
                    if (trimmed.startsWith("#")) {
                        return line.replace(/URI="([^"]+)"/gi, (_match, uri: string) => {
                            if (/^(data:|skd:)/i.test(uri)) return 'URI="' + uri + '"';
                            try {
                                return 'URI="' + proxiedUrl(new URL(uri, finalUrl)) + '"';
                            } catch {
                                return 'URI="' + uri + '"';
                            }
                        });
                    }
                    try {
                        return proxiedUrl(new URL(trimmed, finalUrl));
                    } catch {
                        return line;
                    }
                })
                .join("\n");
            headers.delete("content-length");
            return new Response(rewritten, { status: 200, headers });
        }

        return new Response(response.body, { status: response.status, headers });
    } catch (error) {
        const message =
            error instanceof Error && error.name === "TimeoutError"
                ? "Zeitüberschreitung beim IPTV-Anbieter."
                : error instanceof Error
                  ? error.message
                  : "Der IPTV-Stream konnte nicht geladen werden.";
        return new Response(message, {
            status: 502,
            headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" },
        });
    }
}
