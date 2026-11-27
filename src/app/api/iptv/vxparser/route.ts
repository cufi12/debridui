import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { isVxParserAdmin } from "@/lib/iptv/vxparser-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function requireAdmin() {
    const session = await auth.api.getSession({ headers: await headers() });
    if (!session) return { response: NextResponse.json({ error: "Nicht angemeldet." }, { status: 401 }) };
    if (!isVxParserAdmin(session.user.email)) {
        return {
            response: NextResponse.json(
                { error: "VXParser-Verwaltung ist nur für ausdrücklich freigeschaltete Administratoren verfügbar." },
                { status: 403 }
            ),
        };
    }
    return { response: null };
}

export async function GET() {
    const access = await requireAdmin();
    if (access.response) return access.response;
    try {
        const response = await fetch("http://127.0.0.1:8080/debridui/config", {
            cache: "no-store",
            signal: AbortSignal.timeout(5000),
        });
        if (!response.ok) return NextResponse.json({ error: "VXParser ist derzeit nicht verfügbar." }, { status: 503 });
        return NextResponse.json(await response.json(), { headers: { "Cache-Control": "no-store" } });
    } catch {
        return NextResponse.json({ error: "VXParser ist derzeit nicht verfügbar." }, { status: 503 });
    }
}

export async function PUT(request: Request) {
    const access = await requireAdmin();
    if (access.response) return access.response;
    let payload: unknown;
    try {
        payload = await request.json();
    } catch {
        return NextResponse.json({ error: "Ungültige Anfrage." }, { status: 400 });
    }
    try {
        const response = await fetch("http://127.0.0.1:8080/debridui/config", {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
            cache: "no-store",
            signal: AbortSignal.timeout(8000),
        });
        const body = await response.json().catch(() => ({}));
        return NextResponse.json(body, { status: response.status, headers: { "Cache-Control": "no-store" } });
    } catch {
        return NextResponse.json({ error: "VXParser ist derzeit nicht verfügbar." }, { status: 503 });
    }
}
