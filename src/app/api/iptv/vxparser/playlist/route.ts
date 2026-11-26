import { createHmac } from "node:crypto";
import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function playlistToken(userId: string): string {
    const secret = process.env.BETTER_AUTH_SECRET;
    if (!secret) throw new Error("BETTER_AUTH_SECRET is not configured.");
    const encoded = Buffer.from(userId).toString("base64url");
    const signature = createHmac("sha256", secret).update(encoded).digest("base64url");
    return encoded + "." + signature;
}

export async function GET() {
    const session = await auth.api.getSession({ headers: await headers() });
    if (!session) return NextResponse.json({ error: "Nicht angemeldet." }, { status: 401 });
    try {
        const upstream = await fetch("http://127.0.0.1:8080/get.php?username=debridui&password=pass&type=m3u_plus&output=hls", {
            cache: "no-store",
            signal: AbortSignal.timeout(30000),
        });
        if (!upstream.ok) return NextResponse.json({ error: "VXParser konnte die M3U nicht erstellen." }, { status: 502 });
        const source = await upstream.text();
        if (!source.startsWith("#EXTM3U")) return NextResponse.json({ error: "VXParser hat keine gültige M3U geliefert." }, { status: 502 });
        const token = playlistToken(session.user.id);
        const prefix = new URL("/api/iptv/vxparser/stream/" + token + "/", process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000").toString();
        const playlist = source.replace(/https?:\/\/127\.0\.0\.1:8080\//g, prefix);
        return new Response(playlist, {
            headers: {
                "Content-Type": "audio/x-mpegurl; charset=utf-8",
                "Content-Disposition": 'inline; filename="debridui-vxparser.m3u"',
                "Cache-Control": "private, no-store",
                "X-Content-Type-Options": "nosniff",
            },
        });
    } catch (error) {
        const message = error instanceof Error && error.message === "BETTER_AUTH_SECRET is not configured."
            ? "Die sichere Playlist-Signatur ist nicht konfiguriert."
            : "VXParser ist derzeit nicht verfügbar.";
        return NextResponse.json({ error: message }, { status: 503 });
    }
}
