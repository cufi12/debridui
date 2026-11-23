"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useAuthGuaranteed } from "@/features/auth/components/auth-provider";
import type { AddonSource } from "@/lib/addons/types";
import { AccountType } from "@/lib/schemas";

interface AudioTrack {
    index: number;
    codec: string;
    language: string | null;
    title: string | null;
}

interface ProbeResponse {
    verified?: boolean;
    fileName?: string;
    audioTracks?: AudioTrack[];
    error?: string;
}

function isGermanTrack(track: AudioTrack): boolean {
    return ["de", "deu", "ger"].includes((track.language || "").toLowerCase());
}

function languageName(code: string | null): string {
    if (!code) return "Sprache nicht markiert";
    const normalized = code.toLowerCase();
    if (["de", "deu", "ger"].includes(normalized)) return "Deutsch";
    if (["en", "eng"].includes(normalized)) return "Englisch";
    if (["es", "spa"].includes(normalized)) return "Spanisch";
    if (["it", "ita"].includes(normalized)) return "Italienisch";
    if (["fr", "fra", "fre"].includes(normalized)) return "Französisch";
    return code.toUpperCase();
}

export function AudioTrackProbe({ source, auto = false }: { source: AddonSource; auto?: boolean }) {
    const { currentAccount } = useAuthGuaranteed();
    const [loading, setLoading] = useState(false);
    const [result, setResult] = useState<ProbeResponse | null>(null);
    const autoChecked = useRef(false);
    const hash = source.magnet?.match(/urn:btih:([a-f0-9]{40})/i)?.[1];

    if (currentAccount.type !== AccountType.REALDEBRID || !hash) return null;

    const checkTracks = useCallback(async (silent = false) => {
        setLoading(true);
        setResult(null);
        try {
            const response = await fetch("/api/media/audio-tracks", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ accountId: currentAccount.id, hash }),
                cache: "no-store",
            });
            const data = (await response.json()) as ProbeResponse;
            if (!response.ok) {
                if (silent) {
                    setResult({ error: data.error || "Tonspur-Prüfung momentan nicht möglich." });
                    return;
                }
                throw new Error(data.error || "Tonspur-Prüfung fehlgeschlagen.");
            }
            setResult(data);
        } catch (error) {
            if (silent) {
                setResult({ error: error instanceof Error ? error.message : "Tonspur-Prüfung fehlgeschlagen." });
            } else {
                toast.error(error instanceof Error ? error.message : "Tonspur-Prüfung fehlgeschlagen.");
            }
        } finally {
            setLoading(false);
        }
    }, [currentAccount.id, hash]);

    useEffect(() => {
        if (!auto || !source.isCached || !hash || autoChecked.current) return;
        autoChecked.current = true;
        void checkTracks(true);
    }, [auto, source.isCached, hash, checkTracks]);

    const tracks = result?.audioTracks || [];
    const hasGerman = tracks.some(isGermanTrack);

    return (
        <div className="space-y-2">
            <Button type="button" size="sm" variant="outline" onClick={checkTracks} disabled={loading}>
                {loading ? "Prüfe Tonspuren…" : result ? "Tonspuren erneut prüfen" : "Tonspuren prüfen"}
            </Button>
            {result?.error && !result.verified && (
                <p className="text-xs text-muted-foreground">{result.error} Füge die Quelle zuerst deinem Real-Debrid-Konto hinzu und starte die Prüfung erneut.</p>
            )}
            {result && result.verified && (
                <div className="rounded-sm border border-border/50 bg-muted/20 p-2.5 space-y-2">
                    <div className="flex flex-wrap items-center gap-2">
                        <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
                            Tatsächlich enthaltene Audiospuren
                        </p>
                        {hasGerman ? (
                            <span className="text-[10px] font-semibold text-green-600">Deutsch bestätigt</span>
                        ) : (
                            <span className="text-[10px] font-semibold text-amber-600">
                                Keine deutsche Tonspur erkannt
                            </span>
                        )}
                    </div>
                    {result.fileName && <p className="text-xs text-muted-foreground break-all">{result.fileName}</p>}
                    {tracks.length ? (
                        tracks.map((track) => (
                            <div key={track.index} className="flex flex-wrap items-center gap-x-2 text-xs">
                                <span className={isGermanTrack(track) ? "font-semibold text-green-600" : "font-medium"}>
                                    {languageName(track.language)}
                                </span>
                                <span className="text-muted-foreground">{track.codec}</span>
                                {track.title && <span className="text-muted-foreground">· {track.title}</span>}
                            </div>
                        ))
                    ) : (
                        <p className="text-xs text-muted-foreground">Keine Audiospur erkannt.</p>
                    )}
                    {!hasGerman && (
                        <p className="text-xs text-amber-600">
                            Diese Datei ist nicht als deutschsprachig bestätigt. Wähle eine andere Release-Version und
                            prüfe sie erneut.
                        </p>
                    )}
                </div>
            )}
        </div>
    );
}
