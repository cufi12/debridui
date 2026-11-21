import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";

export async function POST(request: Request) {
    if (new URL(request.url).protocol !== "https:" && process.env.NODE_ENV === "production") {
        return NextResponse.json({ error: "HTTPS required" }, { status: 400 });
    }

    const body = (await request.json().catch(() => null)) as { token?: unknown } | null;
    const token = typeof body?.token === "string" ? body.token : "";
    if (!token || token.length > 512 || !/^[a-zA-Z0-9._-]+$/.test(token)) {
        return NextResponse.json({ error: "Invalid session token" }, { status: 400 });
    }

    // Verify the device-grant token against Better Auth before turning it into a cookie.
    const cookieHeader = `debridui.session_token=${token}; __Secure-debridui.session_token=${token}`;
    const session = await auth.api.getSession({ headers: new Headers({ cookie: cookieHeader }) });
    if (!session) {
        return NextResponse.json({ error: "Session token is not valid" }, { status: 401 });
    }

    const response = NextResponse.json({ success: true });
    const secure = process.env.NODE_ENV === "production";
    const cookieOptions = {
        httpOnly: true,
        secure,
        sameSite: "lax" as const,
        path: "/",
        expires: session.session.expiresAt,
    };
    response.cookies.set("debridui.session_token", token, cookieOptions);
    if (secure) response.cookies.set("__Secure-debridui.session_token", token, cookieOptions);
    return response;
}
