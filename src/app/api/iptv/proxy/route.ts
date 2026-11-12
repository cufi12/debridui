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
        let upstream: Response | undefined;
        for (let redirects = 0; redirects <= 5; redirects++) {
            upstream = await fetch(target, {
                method: "GET",
                cache: "no-store",
                redirect: "manual",
                signal: AbortSignal.timeout(25000),
                headers: { Accept: "*/*" },
            });
            if (![301, 302, 303, 307, 308].includes(upstream.status)) break;
            const location = upstream.headers.get("location");
            if (!location || redirects === 5) {
                return NextResponse.json({ error: "Zu viele oder ungültige Weiterleitungen des Anbieters." }, { status: 502 });
            }
            target = new URL(location, target);
            await validateTarget(target);
        }

        if (!upstream || !upstream.ok) {
            return NextResponse.json({ error: `Anbieter antwortet mit HTTP ${upstream?.status ?? 502}.` }, { status: upstream?.status && upstream.status >= 400 && upstream.status < 600 ? upstream.status : 502 });
        }
        const declaredLength = Number(upstream.headers.get("content-length") || 0);
        if (declaredLength > 20 * 1024 * 1024) {
            return NextResponse.json({ error: "Die Playlist/EPG-Datei ist grösser als 20 MB." }, { status: 413 });
        }
        const body = await upstream.arrayBuffer();
        if (body.byteLength > 20 * 1024 * 1024) {
            return NextResponse.json({ error: "Die Playlist/EPG-Datei ist grösser als 20 MB." }, { status: 413 });
        }
        return new Response(body, {
            status: 200,
            headers: {
                "Content-Type": upstream.headers.get("content-type") || "text/plain; charset=utf-8",
                "Cache-Control": "no-store",
                "X-Content-Type-Options": "nosniff",
            },
        });
    } catch (error) {
        const message = error instanceof Error && error.name === "TimeoutError"
            ? "Zeitüberschreitung beim IPTV-Anbieter."
            : "Der IPTV-Anbieter konnte vom Server nicht erreicht werden.";
        return NextResponse.json({ error: message }, { status: 502 });
    }
}
