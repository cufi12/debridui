/**
 * VxParser administration is intentionally controlled by an explicit server-side
 * email allowlist. No account is implicitly promoted and an unset allowlist denies
 * management access to everyone until the owner configures it.
 */
export function isVxParserAdmin(email: string | null | undefined): boolean {
    if (!email) return false;
    const allowed = (process.env.VXPARSER_ADMIN_EMAILS || "")
        .split(",")
        .map((value) => value.trim().toLowerCase())
        .filter(Boolean);
    return allowed.includes(email.trim().toLowerCase());
}
