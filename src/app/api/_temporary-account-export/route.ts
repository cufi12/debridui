import { timingSafeEqual } from "node:crypto";
import postgres from "postgres";
import { and, eq, isNotNull } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";
import { account, user } from "@/lib/db/auth-schema";
import { db } from "@/lib/db/drizzle";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

let migrationCompleted = false;

export async function POST(request: NextRequest) {
    const expected = process.env.TEMP_ACCOUNT_EXPORT_TOKEN;
    const supplied = request.headers.get("x-account-export-token") ?? "";
    if (
        migrationCompleted ||
        !expected ||
        expected.length < 64 ||
        supplied.length !== expected.length ||
        !timingSafeEqual(Buffer.from(supplied), Buffer.from(expected))
    ) {
        return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const targetUrl = process.env.ACCOUNT_MIGRATION_TARGET_URL;
    if (!targetUrl) {
        return NextResponse.json({ error: "Migration target unavailable" }, { status: 503 });
    }

    const target = postgres(targetUrl, { prepare: false, max: 1, connect_timeout: 10 });
    try {
        const rows = await db
            .select({
                userId: user.id,
                name: user.name,
                email: user.email,
                emailVerified: user.emailVerified,
                image: user.image,
                userCreatedAt: user.createdAt,
                userUpdatedAt: user.updatedAt,
                accountId: account.id,
                accountKey: account.accountId,
                providerId: account.providerId,
                passwordHash: account.password,
                accountCreatedAt: account.createdAt,
                accountUpdatedAt: account.updatedAt,
            })
            .from(user)
            .innerJoin(account, and(eq(account.userId, user.id), eq(account.providerId, "credential")))
            .where(isNotNull(account.password));

        await target.begin(async (tx) => {
            for (const row of rows) {
                await tx`INSERT INTO "user" ("id", "name", "email", "email_verified", "image", "created_at", "updated_at")
                    VALUES (${row.userId}, ${row.name}, ${row.email}, ${row.emailVerified}, ${row.image}, ${row.userCreatedAt}, ${row.userUpdatedAt})
                    ON CONFLICT DO NOTHING`;
                await tx`INSERT INTO "account" ("id", "account_id", "provider_id", "user_id", "password", "created_at", "updated_at")
                    VALUES (${row.accountId}, ${row.accountKey}, ${row.providerId}, ${row.userId}, ${row.passwordHash}, ${row.accountCreatedAt}, ${row.accountUpdatedAt})
                    ON CONFLICT DO NOTHING`;
            }
        });

        migrationCompleted = true;
        return NextResponse.json(
            { success: true, usersTransferred: rows.length },
            { headers: { "Cache-Control": "no-store", Pragma: "no-cache", "X-Robots-Tag": "noindex" } }
        );
    } catch (error) {
        console.error("[temporary-account-migration] failed", error);
        return NextResponse.json({ error: "Migration failed" }, { status: 500 });
    } finally {
        await target.end({ timeout: 5 });
    }
}
