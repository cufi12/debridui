"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState, type FormEvent } from "react";
import { authClient } from "@/lib/auth-client";

export default function DeviceAuthorizationPage() {
    const router = useRouter();
    const searchParams = useSearchParams();
    const { data: session, isPending } = authClient.useSession();
    const [userCode, setUserCode] = useState(searchParams.get("user_code") || "");
    const [error, setError] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);

    async function submit(event: FormEvent<HTMLFormElement>) {
        event.preventDefault();
        setError(null);
        const code = userCode
            .trim()
            .replace(/[^a-z0-9]/gi, "")
            .toUpperCase();
        if (!code) {
            setError("Bitte gib den Code vom Fernseher ein.");
            return;
        }
        if (!session?.user) {
            const returnTo = `/device?user_code=${encodeURIComponent(code)}`;
            router.push(`/login?callbackUrl=${encodeURIComponent(returnTo)}`);
            return;
        }
        setBusy(true);

        const { data, error: verifyError } = await authClient.device({
            query: { user_code: code },
        });
        if (verifyError || !data) {
            setError(verifyError?.error_description || "Der Code ist ungültig oder abgelaufen.");
            setBusy(false);
            return;
        }
        router.push(`/device/approve?user_code=${encodeURIComponent(code)}`);
    }

    return (
        <main className="flex min-h-svh items-center justify-center p-6">
            <div className="w-full max-w-md rounded-xl border bg-card p-6 shadow-sm">
                <h1 className="text-2xl font-bold">Fernseher verbinden</h1>
                <p className="mt-2 text-sm text-muted-foreground">
                    Gib den kurzen Code ein, der auf deinem DebridUI-Fernseher angezeigt wird.
                </p>
                <form onSubmit={submit} className="mt-6 space-y-4">
                    <label htmlFor="device-code" className="block text-sm font-medium">
                        Gerätecode
                    </label>
                    <input
                        id="device-code"
                        autoComplete="one-time-code"
                        autoCapitalize="characters"
                        maxLength={16}
                        value={userCode}
                        onChange={(event) => setUserCode(event.target.value.toUpperCase())}
                        placeholder="ABCD1234"
                        className="w-full rounded-md border bg-background px-4 py-3 text-center text-2xl font-semibold tracking-[0.2em]"
                    />
                    {error && (
                        <p role="alert" className="text-sm text-destructive">
                            {error}
                        </p>
                    )}
                    <button
                        type="submit"
                        disabled={busy || isPending}
                        className="w-full rounded-md bg-primary px-4 py-3 font-medium text-primary-foreground disabled:opacity-50"
                    >
                        {isPending ? "Lade …" : busy ? "Prüfe Code …" : "Weiter"}
                    </button>
                </form>
                <p className="mt-5 text-xs text-muted-foreground">
                    Gib nur einen Code ein, den du gerade selbst auf deinem Fernseher siehst.{" "}
                    <Link href="/" className="underline">
                        Zurück zu DebridUI
                    </Link>
                </p>
            </div>
        </main>
    );
}
