import { headers } from "next/headers";
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { createVxParserToken } from "@/lib/iptv/vxparser-token";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
    const session = await auth.api.getSession({ headers: await headers() });
    if (!session) return NextResponse.json({ error: "Nicht angemeldet." }, { status: 401 });
    try {
        const { token, expiresAt } = createVxParserToken(session.user.id);
        const url = new URL(`/api/iptv/vxparser/playlist/${token}`, request.nextUrl.origin);
        return NextResponse.json(
            { url: url.toString(), expiresAt },
            { headers: { "Cache-Control": "no-store" } }
        );
    } catch {
        return NextResponse.json(
            { error: "Die sichere Playlist-Signatur ist nicht konfiguriert. VXPARSER_TOKEN_SECRET muss mindestens 32 Zeichen lang sein." },
            { status: 503 }
        );
    }
}
