import { NextRequest, NextResponse } from "next/server";
import { verifyVxParserToken } from "@/lib/iptv/vxparser-token";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest, context: { params: Promise<{ token: string }> }) {
    const { token } = await context.params;
    if (!verifyVxParserToken(token)) return NextResponse.json({ error: "Ungültiger Playlist-Link." }, { status: 401 });
    try {
        const upstream = await fetch(
            "http://127.0.0.1:8080/get.php?username=debridui&password=pass&type=m3u_plus&output=hls",
            {
                cache: "no-store",
                signal: AbortSignal.timeout(30000),
            }
        );
        if (!upstream.ok)
            return NextResponse.json({ error: "VXParser konnte die M3U nicht erstellen." }, { status: 502 });
        const source = await upstream.text();
        if (!source.startsWith("#EXTM3U"))
            return NextResponse.json({ error: "VXParser hat keine gültige M3U geliefert." }, { status: 502 });
        const streamCount = source.split(/\\r?\\n/).filter((line) => line.trim() && !line.trim().startsWith("#")).length;
        if (streamCount === 0) return NextResponse.json({ error: "Noch keine Senderdaten vorhanden. Bitte zuerst die VXParser-Senderdaten aktualisieren." }, { status: 409 });
        const prefix = new URL(`/api/iptv/vxparser/stream/${token}/`, request.nextUrl.origin).toString();
        const playlist = source.replace(/https?:\/\/127\.0\.0\.1:8080\//g, prefix);
        return new Response(playlist, {
            headers: {
                "Content-Type": "audio/x-mpegurl; charset=utf-8",
                "Content-Disposition": 'inline; filename="debridui-vxparser.m3u"',
                "Cache-Control": "private, no-store",
                "X-Content-Type-Options": "nosniff",
            },
        });
    } catch {
        return NextResponse.json({ error: "VXParser ist derzeit nicht verfügbar." }, { status: 503 });
    }
}
