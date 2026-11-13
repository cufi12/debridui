"use client";

import { useEffect, useState } from "react";
import { SectionDivider } from "@/components/layout/section-divider";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

const STORAGE_KEY = "debridui-iptv-config";

type IPTVSettings = {
    playlistUrl?: string;
    epgUrl?: string;
    playerMode?: "inline" | "external";
    autoplay?: boolean;
    startMuted?: boolean;
};

export function IPTVSettingsSection() {
    const [settings, setSettings] = useState<IPTVSettings>({});
    const [ready, setReady] = useState(false);

    useEffect(() => {
        try {
            setSettings(JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}") as IPTVSettings);
        } catch {
            setSettings({});
        }
        setReady(true);
    }, []);

    function update(patch: Partial<IPTVSettings>) {
        setSettings((current) => {
            const next = { ...current, ...patch };
            localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
            return next;
        });
    }

    return (
        <section className="space-y-4">
            <SectionDivider label="IPTV" />
            <p className="text-sm text-muted-foreground">
                Playlist, EPG und Wiedergabeoptionen. Die Zugangsdaten werden lokal in diesem Browser gespeichert.
            </p>
            <div className="space-y-1.5">
                <Label htmlFor="iptv-playlist-url">M3U-Playlist-URL</Label>
                <Input id="iptv-playlist-url" type="url" placeholder="https://…" value={settings.playlistUrl || ""} disabled={!ready} onChange={(event) => update({ playlistUrl: event.target.value })} />
            </div>
            <div className="space-y-1.5">
                <Label htmlFor="iptv-epg-url">EPG-URL (XMLTV)</Label>
                <Input id="iptv-epg-url" type="url" placeholder="https://…" value={settings.epgUrl || ""} disabled={!ready} onChange={(event) => update({ epgUrl: event.target.value })} />
            </div>
            <div className="space-y-1.5">
                <Label>Player</Label>
                <Select value={settings.playerMode || "inline"} onValueChange={(value) => update({ playerMode: value as IPTVSettings["playerMode"] })}>
                    <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                    <SelectContent>
                        <SelectItem value="inline">In DebridUI abspielen</SelectItem>
                        <SelectItem value="external">Stream in neuem Tab öffnen</SelectItem>
                    </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">Der integrierte Player verwendet die Wiedergabefunktionen des Browsers. Extern öffnet die Stream-Adresse separat.</p>
            </div>
            <div className="flex items-center justify-between gap-3 rounded-sm border border-border/50 p-3">
                <div className="space-y-0.5"><Label htmlFor="iptv-autoplay">Automatisch abspielen</Label><p className="text-xs text-muted-foreground">Sender direkt nach Auswahl starten</p></div>
                <Switch id="iptv-autoplay" checked={settings.autoplay ?? true} onCheckedChange={(checked) => update({ autoplay: checked })} />
            </div>
            <div className="flex items-center justify-between gap-3 rounded-sm border border-border/50 p-3">
                <div className="space-y-0.5"><Label htmlFor="iptv-muted">Stumm starten</Label><p className="text-xs text-muted-foreground">Hilft bei Browsern, die Autoplay mit Ton blockieren</p></div>
                <Switch id="iptv-muted" checked={settings.startMuted ?? false} onCheckedChange={(checked) => update({ startMuted: checked })} />
            </div>
        </section>
    );
}
