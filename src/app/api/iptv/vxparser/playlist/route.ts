import { headers } from "next/headers";
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { createVxParserToken } from "@/lib/iptv/vxparser-token";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
    const session = await auth.api.getSession({ headers: await headers() });
    if (!session) return NextResponse.json({ error: "Nicht angemeldet." }, { status: 401 });
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
        const { token } = createVxParserToken(session.user.id);
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
        return NextResponse.json(
            { error: "VXParser ist nicht verfügbar oder VXPARSER_TOKEN_SECRET ist nicht korrekt konfiguriert." },
            { status: 503 }
        );
    }
}
