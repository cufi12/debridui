import { type NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const API_BASE = "https://api.real-debrid.com/rest/1.0";
const ALLOWED_ROOTS = new Set([
    "user",
    "torrents",
    "downloads",
    "unrestrict",
    "hosts",
    "traffic",
    "time",
    "settings",
    "streaming",
]);

async function handle(request: NextRequest, context: { params: Promise<{ path: string[] }> }) {
    const session = await auth.api.getSession({ headers: request.headers });
    if (!session) {
        return NextResponse.json({ error: "Anmeldung erforderlich." }, { status: 401 });
    }

    const { path } = await context.params;
    if (!path?.length || !ALLOWED_ROOTS.has(path[0]) || path.some((part) => !part || part === "." || part === "..")) {
        return NextResponse.json({ error: "Ungültiger Real-Debrid-API-Pfad." }, { status: 400 });
    }

    const token = request.headers.get("authorization");
    if (path[0] !== "hosts" && !token?.startsWith("Bearer ")) {
        return NextResponse.json({ error: "Real-Debrid-Token fehlt." }, { status: 401 });
    }

    const target = new URL(path.map((part) => encodeURIComponent(part)).join("/"), API_BASE + "/");
    target.search = request.nextUrl.search;

    const headers = new Headers({
        Accept: request.headers.get("accept") || "application/json",
        "User-Agent": "DebridUI",
    });
    if (token) headers.set("Authorization", token);
    const contentType = request.headers.get("content-type");
    if (contentType) headers.set("Content-Type", contentType);

    try {
        const method = request.method;
        const body = method === "GET" || method === "HEAD" ? undefined : await request.arrayBuffer();
        const upstream = await fetch(target, {
            method,
            headers,
            body,
            cache: "no-store",
            redirect: "manual",
            signal: AbortSignal.timeout(120000),
        });

        const responseHeaders = new Headers();
        for (const name of ["content-type", "content-length", "content-range", "accept-ranges", "retry-after"]) {
            const value = upstream.headers.get(name);
            if (value) responseHeaders.set(name, value);
        }
        responseHeaders.set("Cache-Control", "no-store");
        return new Response(upstream.body, { status: upstream.status, headers: responseHeaders });
    } catch (error) {
        const message =
            error instanceof Error && error.name === "TimeoutError"
                ? "Zeitüberschreitung bei Real-Debrid."
                : "Real-Debrid ist momentan nicht erreichbar.";
        return NextResponse.json({ error: message }, { status: 502 });
    }
}

export async function GET(request: NextRequest, context: { params: Promise<{ path: string[] }> }) {
    return handle(request, context);
}
export async function POST(request: NextRequest, context: { params: Promise<{ path: string[] }> }) {
    return handle(request, context);
}
export async function PUT(request: NextRequest, context: { params: Promise<{ path: string[] }> }) {
    return handle(request, context);
}
export async function DELETE(request: NextRequest, context: { params: Promise<{ path: string[] }> }) {
    return handle(request, context);
}
