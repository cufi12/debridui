"use client";

import { useEffect, useState } from "react";
import { authClient } from "@/lib/auth-client";

const CLIENT_ID = "debridui-tv";
const GRANT_TYPE = "urn:ietf:params:oauth:grant-type:device_code";

type DeviceCode = {
    device_code: string;
    user_code: string;
    verification_uri: string;
    verification_uri_complete?: string;
    interval?: number;
    expires_in?: number;
};

export function TvDeviceLogin() {
    const [request, setRequest] = useState<DeviceCode | null>(null);
    const [status, setStatus] = useState("Verbinde mit DebridUI …");
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        let cancelled = false;
        let timer: ReturnType<typeof setTimeout> | undefined;
        let interval = 5;

        async function begin() {
            const { data, error: requestError } = await authClient.device.code({
                client_id: CLIENT_ID,
                scope: "openid profile email",
            });
            if (cancelled) return;
            if (requestError || !data) {
                setError(requestError?.message || "Der QR-Code konnte nicht erstellt werden.");
                setStatus("Anmeldung nicht verfügbar");
                return;
            }
            const device = data as DeviceCode;
            interval = Math.max(5, device.interval || 5);
            setRequest(device);
            setStatus("QR-Code scannen und den Code auf dem Handy eingeben");
            poll(device);
        }

        async function poll(device: DeviceCode) {
            if (cancelled) return;
            const { data, error: pollError } = await authClient.device.token({
                grant_type: GRANT_TYPE,
                device_code: device.device_code,
                client_id: CLIENT_ID,
            });

            if (cancelled) return;
            if (data?.access_token) {
                setStatus("Anmeldung bestätigt. Fernseher wird angemeldet …");
                const response = await fetch("/api/tv/session", {
                    method: "POST",
                    headers: { "content-type": "application/json" },
                    credentials: "same-origin",
                    body: JSON.stringify({ token: data.access_token }),
                });
                if (!response.ok) {
                    setError("Die Sitzung konnte nicht sicher übernommen werden. Bitte erneut versuchen.");
                    setStatus("Anmeldung fehlgeschlagen");
                    return;
                }
                window.location.replace("/dashboard");
                return;
            }

            const code = pollError?.error;
            if (code === "access_denied") {
                setError("Die Anmeldung wurde am Handy abgelehnt.");
                setStatus("Anmeldung abgelehnt");
                return;
            }
            if (code === "expired_token") {
                setError("Der Code ist abgelaufen. Bitte Seite neu laden.");
                setStatus("Code abgelaufen");
                return;
            }
            if (code && code !== "authorization_pending" && code !== "slow_down") {
                setError(pollError?.message || "Verbindung fehlgeschlagen.");
                setStatus("Anmeldung fehlgeschlagen");
                return;
            }
            if (code === "slow_down") interval += 5;
            timer = setTimeout(() => poll(device), interval * 1000);
        }

        begin();
        return () => {
            cancelled = true;
            if (timer) clearTimeout(timer);
        };
    }, []);

    // QR provider receives only the public verification page, never the one-time code.
    const verificationUrl = request ? new URL(request.verification_uri, window.location.origin).toString() : "";
    const qrUrl = verificationUrl
        ? `https://api.qrserver.com/v1/create-qr-code/?size=320x320&margin=12&data=${encodeURIComponent(verificationUrl)}`
        : "";

    return (
        <section className="mt-6 rounded-xl border bg-card p-5 text-center" aria-live="polite">
            <h2 className="text-lg font-semibold">Mit QR-Code anmelden</h2>
            <p className="mt-2 text-sm text-muted-foreground">{status}</p>
            {qrUrl ? (
                <div className="mx-auto mt-4 w-fit rounded-lg bg-white p-3">
                    {/* The QR image service receives only the public /device URL, not the one-time code. */}
                    {/* biome-ignore lint/a11y/useAltText: QR code is described by the adjacent instructions. */}
                    <img src={qrUrl} width="220" height="220" alt="QR-Code zur Geräteanmeldung" />
                </div>
            ) : (
                <div className="mx-auto mt-4 flex h-[244px] w-[244px] items-center justify-center rounded-lg bg-muted text-sm text-muted-foreground">
                    QR-Code wird erstellt …
                </div>
            )}
            {request && (
                <>
                    <p className="mt-4 text-sm text-muted-foreground">Oder öffne <span className="font-medium text-foreground">{request.verification_uri}</span> am Handy und gib diesen Code ein:</p>
                    <p className="mt-2 text-3xl font-bold tracking-[0.2em]">{request.user_code}</p>
                </>
            )}
            {error && <p className="mt-3 text-sm text-destructive">{error}</p>}
            <p className="mt-4 text-xs text-muted-foreground">Bestätige den Code nur, wenn er auf diesem Fernseher angezeigt wird.</p>
        </section>
    );
}
