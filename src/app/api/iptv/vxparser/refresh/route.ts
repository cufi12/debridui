import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
    const session = await auth.api.getSession({ headers: await headers() });
    if (!session) return NextResponse.json({ error: "Nicht angemeldet." }, { status: 401 });
    try {
        const response = await fetch("http://127.0.0.1:8080/debridui/refresh", {
            method: "POST",
            cache: "no-store",
            signal: AbortSignal.timeout(8000),
        });
        const data = await response.json();
        return NextResponse.json(data, { status: response.status, headers: { "Cache-Control": "no-store" } });
    } catch {
        return NextResponse.json({ error: "VXParser ist derzeit nicht verfügbar." }, { status: 503 });
    }
}
