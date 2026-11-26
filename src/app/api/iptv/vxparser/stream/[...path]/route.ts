import { NextRequest, NextResponse } from "next/server";
import { verifyVxParserToken } from "@/lib/iptv/vxparser-token";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
    _request: NextRequest,
    context: { params: Promise<{ path: string[] }> }
) {
    const { path } = await context.params;
    const [token, ...upstreamPath] = path;
    if (!token || !verifyVxParserToken(token) || !upstreamPath.length) {
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
