"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { authClient } from "@/lib/auth-client";

type DeviceRequest = {
    user_code?: string;
    client_id?: string;
    scope?: string;
};

export default function DeviceApprovalPage() {
    const router = useRouter();
    const searchParams = useSearchParams();
    const userCode = (searchParams.get("user_code") || "").replace(/[^a-z0-9]/gi, "").toUpperCase();
    const { data: session, isPending } = authClient.useSession();
    const [request, setRequest] = useState<DeviceRequest | null>(null);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        if (!userCode || !session?.user) return;
        authClient.device({ query: { user_code: userCode } }).then(({ data }) => {
            if (data) setRequest(data as DeviceRequest);
        });
    }, [userCode, session?.user]);

    useEffect(() => {
        if (!isPending && !session?.user) {
            const returnTo = `/device?user_code=${encodeURIComponent(userCode)}`;
            router.replace(`/login?callbackUrl=${encodeURIComponent(returnTo)}`);
        }
    }, [isPending, session?.user, router, userCode]);

    async function decide(action: "approve" | "deny") {
        setBusy(true);
        setError(null);
        const result =
            action === "approve"
                ? await authClient.device.approve({ userCode })
                : await authClient.device.deny({ userCode });
        setBusy(false);
        if (result.error) {
            setError(result.error.error_description || "Die Entscheidung konnte nicht gespeichert werden.");
            return;
        }
        router.replace(action === "approve" ? "/?device=approved" : "/?device=denied");
    }

    if (isPending || !session?.user) {
        return (
            <main className="flex min-h-svh items-center justify-center p-6 text-muted-foreground">
                Lade Anmeldung …
            </main>
        );
    }

    const recognized = request?.client_id === "debridui-tv";

    return (
        <main className="flex min-h-svh items-center justify-center p-6">
            <div className="w-full max-w-md rounded-xl border bg-card p-6 shadow-sm">
                <h1 className="text-2xl font-bold">Geräteanmeldung bestätigen</h1>
                <p className="mt-2 text-sm text-muted-foreground">
                    Ein DebridUI-Fernseher möchte sich mit deinem Konto anmelden.
                </p>
                <div className="mt-5 rounded-lg bg-muted p-4">
                    <p className="text-xs text-muted-foreground">Code auf dem Fernseher</p>
                    <p className="mt-1 text-2xl font-bold tracking-[0.2em]">{userCode}</p>
                    <p className="mt-3 text-sm">
                        Konto: <strong>{session.user.email}</strong>
                    </p>
                    <p className="mt-1 text-sm">
                        Anwendung: <strong>{recognized ? "DebridUI für Android TV" : "Unbekanntes Gerät"}</strong>
                    </p>
                    <p className="mt-1 text-sm">
                        Berechtigungen: <strong>{request?.scope || "DebridUI-Kontositzung"}</strong>
                    </p>
                </div>
                <p className="mt-4 text-sm text-muted-foreground">
                    Bestätige nur, wenn derselbe Code gerade auf deinem eigenen Fernseher angezeigt wird. Teile diesen
                    Code niemals mit anderen.
                </p>
                {error && (
                    <p role="alert" className="mt-3 text-sm text-destructive">
                        {error}
                    </p>
                )}
                <div className="mt-6 grid grid-cols-2 gap-3">
                    <button
                        type="button"
                        disabled={busy || !recognized || !request}
                        onClick={() => decide("deny")}
                        className="rounded-md border px-4 py-3 font-medium disabled:opacity-50">
                        Ablehnen
                    </button>
                    <button
                        type="button"
                        disabled={busy || !recognized || !request}
                        onClick={() => decide("approve")}
                        className="rounded-md bg-primary px-4 py-3 font-medium text-primary-foreground disabled:opacity-50">
                        {busy ? "Bitte warten …" : "Bestätigen"}
                    </button>
                </div>
                {!request && <p className="mt-3 text-center text-xs text-muted-foreground">Prüfe den Gerätecode …</p>}
            </div>
        </main>
    );
}
