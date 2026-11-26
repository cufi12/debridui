import { createHmac, timingSafeEqual } from "node:crypto";

function secret(): string {
    const value = process.env.BETTER_AUTH_SECRET;
    if (!value) throw new Error("BETTER_AUTH_SECRET is not configured.");
    return value;
}

export function createVxParserToken(userId: string): string {
    const encoded = Buffer.from(userId).toString("base64url");
    const signature = createHmac("sha256", secret()).update(encoded).digest("base64url");
    return `${encoded}.${signature}`;
}

export function verifyVxParserToken(token: string): boolean {
    try {
        const [encoded, signature, extra] = token.split(".");
        if (!encoded || !signature || extra !== undefined) return false;
        const expected = createHmac("sha256", secret()).update(encoded).digest();
        const supplied = Buffer.from(signature, "base64url");
        return supplied.length === expected.length && timingSafeEqual(supplied, expected);
    } catch {
        return false;
    }
}
