import { timingSafeEqual } from "node:crypto";
import { and, eq, isNotNull } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";
import { account, user } from "@/lib/db/auth-schema";
import { db } from "@/lib/db/drizzle";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: NextRequest) {
    const expected = process.env.TEMP_ACCOUNT_EXPORT_TOKEN;
    const supplied = request.headers.get("x-account-export-token") ?? "";
    if (!expected || expected.length < 64 || supplied.length !== expected.length) {
        return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    if (!timingSafeEqual(Buffer.from(supplied), Buffer.from(expected))) {
        return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    try {
        const accounts = await db
            .select({
                userId: user.id,
                name: user.name,
                email: user.email,
                emailVerified: user.emailVerified,
                userCreatedAt: user.createdAt,
                userUpdatedAt: user.updatedAt,
                accountId: account.id,
                accountKey: account.accountId,
                providerId: account.providerId,
                passwordHash: account.password,
            })
            .from(user)
            .innerJoin(account, and(eq(account.userId, user.id), eq(account.providerId, "credential")))
            .where(isNotNull(account.password));
        return NextResponse.json(
            { count: accounts.length, accounts },
            {
                headers: {
                    "Cache-Control": "no-store",
                    Pragma: "no-cache",
                    "X-Robots-Tag": "noindex",
                },
            }
        );
    } catch (error) {
        console.error("[temporary-account-export] failed", error);
        return NextResponse.json({ error: "Export failed" }, { status: 500 });
    }
}
