import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";

const TOKEN_TTL_SECONDS = 365 * 24 * 60 * 60;

function secret(): string {
    const value = process.env.VXPARSER_TOKEN_SECRET;
    if (!value || value.length < 32) {
        throw new Error("VXPARSER_TOKEN_SECRET must contain at least 32 characters.");
    }
    return value;
}

export function createVxParserToken(userId: string): { token: string; expiresAt: string } {
    const expiresAtSeconds = Math.floor(Date.now() / 1000) + TOKEN_TTL_SECONDS;
    const payload = Buffer.from(
        JSON.stringify({ sub: userId, exp: expiresAtSeconds, jti: randomUUID() })
    ).toString("base64url");
    const signature = createHmac("sha256", secret()).update(payload).digest("base64url");
    return {
        token: `${payload}.${signature}`,
        expiresAt: new Date(expiresAtSeconds * 1000).toISOString(),
    };
}

export function verifyVxParserToken(token: string): boolean {
    try {
        const [payload, signature, extra] = token.split(".");
        if (!payload || !signature || extra !== undefined) return false;
        const expected = createHmac("sha256", secret()).update(payload).digest();
        const supplied = Buffer.from(signature, "base64url");
        if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) return false;

        const claims: unknown = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
        if (!claims || typeof claims !== "object") return false;
        const { sub, exp, jti } = claims as { sub?: unknown; exp?: unknown; jti?: unknown };
        return (
            typeof sub === "string" &&
            sub.length > 0 &&
            typeof exp === "number" &&
            Number.isSafeInteger(exp) &&
            exp > Math.floor(Date.now() / 1000) &&
            typeof jti === "string" &&
            jti.length > 0
        );
    } catch {
        return false;
    }
}
