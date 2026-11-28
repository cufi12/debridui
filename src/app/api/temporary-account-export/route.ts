import { timingSafeEqual } from "node:crypto";
import { type NextRequest, NextResponse } from "next/server";
import postgres from "postgres";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

let migrationCompleted = false;

const TABLES = [
    "user",
    "account",
    "user_accounts",
    "addons",
    "user_settings",
    "playback_history",
    "search_history",
] as const;

const quoteIdentifier = (value: string) => `"${value.replaceAll('"', '""')}"`;

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

    const sourceUrl = process.env.LEGACY_DATABASE_URL;
    const targetUrl = process.env.DATABASE_URL;
    if (!sourceUrl || !targetUrl) {
        return NextResponse.json({ error: "Migration source or target unavailable" }, { status: 503 });
    }

    const source = postgres(sourceUrl, { prepare: false, max: 1, connect_timeout: 10 });
    const target = postgres(targetUrl, { prepare: false, max: 1, connect_timeout: 10 });

    try {
        const counts: Record<string, number> = {};
        await target.begin(async (tx) => {
            for (const table of TABLES) {
                const rows = await source.unsafe(`SELECT * FROM ${quoteIdentifier(table)}`);
                let inserted = 0;
                for (const row of rows) {
                    const columns = Object.keys(row);
                    if (!columns.length) continue;
                    const names = columns.map(quoteIdentifier).join(", ");
                    const placeholders = columns.map((_, index) => `$${index + 1}`).join(", ");
                    const values = columns.map((column) => row[column]);
                    const result = await tx.unsafe(
                        `INSERT INTO ${quoteIdentifier(table)} (${names}) VALUES (${placeholders}) ON CONFLICT DO NOTHING RETURNING 1`,
                        values
                    );
                    inserted += result.length;
                }
                counts[table] = inserted;
            }
        });

        migrationCompleted = true;
        return NextResponse.json(
            { success: true, transferred: counts },
            { headers: { "Cache-Control": "no-store", Pragma: "no-cache", "X-Robots-Tag": "noindex" } }
        );
    } catch (error) {
        console.error("[temporary-account-migration] failed", error);
        return NextResponse.json({ error: "Migration failed" }, { status: 500 });
    } finally {
        await Promise.all([source.end({ timeout: 5 }), target.end({ timeout: 5 })]);
    }
}
