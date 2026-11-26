import { createHmac, timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function validToken(token: string): boolean {
    const secret = process.env.BETTER_AUTH_SECRET;
    if (!secret) return false;
    const parts = token.split(".");
    if (parts.length !== 2 || !parts[0] || !parts[1]) return false;
    const expected = createHmac("sha256", secret).update(parts[0]).digest();
    let supplied: Buffer;
    try { supplied = Buffer.from(parts[1], "base64url"); } catch { return false; }
    return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}

export async function GET(
    _request: NextRequest,
    context: { params: Promise<{ path: string[] }> }
) {
    const { path } = await context.params;
    const [token, ...upstreamPath] = path;
    if (!token || !validToken(token) || !upstreamPath.length) {
        return NextResponse.json({ error: "Ungültiger oder fehlender Playlist-Zugriff." }, { status: 401 });
    }
    const safePath = upstreamPath.map((part) => encodeURIComponent(part)).join("/");
    try {
        const upstream = await fetch("http://127.0.0.1:8080/" + safePath, {
            cache: "no-store",
            redirect: "follow",
            signal: AbortSignal.timeout(60000),
        });
        if (!upstream.ok || !upstream.body) {
            return NextResponse.json({ error: "VXParser konnte den Stream nicht öffnen." }, { status: upstream.status || 502 });
        }
        const headers = new Headers();
        const contentType = upstream.headers.get("content-type");
        if (contentType) headers.set("Content-Type", contentType);
        headers.set("Cache-Control", "no-store");
        headers.set("X-Content-Type-Options", "nosniff");
        return new Response(upstream.body, { status: 200, headers });
    } catch {
        return NextResponse.json({ error: "VXParser ist derzeit nicht erreichbar." }, { status: 502 });
    }
}
