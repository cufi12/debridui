"use client";

import { useEffect, useState } from "react";
import { SectionDivider } from "@/components/layout/section-divider";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";

const STORAGE_KEY = "debridui-iptv-config";

type IPTVSettings = {
    playlistUrl?: string;
    epgUrl?: string;
    playerMode?: "auto" | "native" | "external";
    externalPlayer?: "vlc" | "mx" | "just" | "kodi";
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
                <Input
                    id="iptv-playlist-url"
                    type="url"
                    placeholder="https://…"
                    value={settings.playlistUrl || ""}
                    disabled={!ready}
                    onChange={(event) => update({ playlistUrl: event.target.value })}
                />
            </div>
            <div className="space-y-1.5">
                <Label htmlFor="iptv-epg-url">EPG-URL (XMLTV)</Label>
                <Input
                    id="iptv-epg-url"
                    type="url"
                    placeholder="https://…"
                    value={settings.epgUrl || ""}
                    disabled={!ready}
                    onChange={(event) => update({ epgUrl: event.target.value })}
                />
            </div>
            <div className="space-y-1.5">
                <Label>Player</Label>
                <Select
                    value={settings.playerMode || "auto"}
                    onValueChange={(value) => update({ playerMode: value as IPTVSettings["playerMode"] })}>
                    <SelectTrigger className="w-full">
                        <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value="auto">Automatisch (HLS.js)</SelectItem>
                        <SelectItem value="native">Browser-Player (nativ)</SelectItem>
                        <SelectItem value="external">Externer Android-Player</SelectItem>
                    </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                    Automatisch nutzt HLS.js für HLS-Streams. Nativ überlässt die Wiedergabe dem Browser. Extern öffnet
                    die Stream-Adresse in einem neuen Tab.
                </p>
            </div>
            <div className="space-y-1.5">
                <Label>Android-Player für externe Wiedergabe</Label>
                <Select
                    value={settings.externalPlayer || "vlc"}
                    onValueChange={(value) => update({ externalPlayer: value as IPTVSettings["externalPlayer"] })}>
                    <SelectTrigger className="w-full">
                        <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value="vlc">VLC</SelectItem>
                        <SelectItem value="mx">MX Player</SelectItem>
                        <SelectItem value="just">Just (Video) Player</SelectItem>
                        <SelectItem value="kodi">Kodi</SelectItem>
                    </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                    Die gewählte App muss auf dem Android-Gerät installiert sein.
                </p>
            </div>
            <div className="flex items-center justify-between gap-3 rounded-sm border border-border/50 p-3">
                <div className="space-y-0.5">
                    <Label htmlFor="iptv-autoplay">Automatisch abspielen</Label>
                    <p className="text-xs text-muted-foreground">Sender direkt nach Auswahl starten</p>
                </div>
                <Switch
                    id="iptv-autoplay"
                    checked={settings.autoplay ?? true}
                    onCheckedChange={(checked) => update({ autoplay: checked })}
                />
            </div>
            <div className="flex items-center justify-between gap-3 rounded-sm border border-border/50 p-3">
                <div className="space-y-0.5">
                    <Label htmlFor="iptv-muted">Stumm starten</Label>
                    <p className="text-xs text-muted-foreground">Hilft bei Browsern, die Autoplay mit Ton blockieren</p>
                </div>
                <Switch
                    id="iptv-muted"
                    checked={settings.startMuted ?? false}
                    onCheckedChange={(checked) => update({ startMuted: checked })}
                />
            </div>
            <VXParserSettings />
        </section>
    );
}
type VXParserSetting = {
    name: string;
    group: string;
    value: string;
    info?: string;
    sensitive?: boolean;
    readOnly?: boolean;
};

function VXParserSettings() {
    const [items, setItems] = useState<VXParserSetting[]>([]);
    const [values, setValues] = useState<Record<string, string>>({});
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [message, setMessage] = useState("");
    const [playlistUrl, setPlaylistUrl] = useState("");

    useEffect(() => {
        fetch("/api/iptv/vxparser", { cache: "no-store" })
            .then(async (response) => {
                const data = await response.json();
                if (!response.ok) throw new Error(data.error || "VXParser ist nicht verfügbar.");
                const settings = Array.isArray(data.settings) ? (data.settings as VXParserSetting[]) : [];
                setItems(settings);
                setValues(Object.fromEntries(settings.map((item) => [item.name, item.value ?? ""])));
            })
            .catch((error: unknown) =>
                setMessage(error instanceof Error ? error.message : "VXParser konnte nicht geladen werden.")
            )
            .finally(() => setLoading(false));
    }, []);

    async function saveSettings() {
        setSaving(true);
        setMessage("");
        try {
            const response = await fetch("/api/iptv/vxparser", {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    settings: Object.fromEntries(
                        items.filter((item) => !item.readOnly).map((item) => [item.name, values[item.name] ?? ""])
                    ),
                }),
            });
            const data = await response.json();
            if (!response.ok) throw new Error(data.error || "Speichern fehlgeschlagen.");
            setMessage("VXParser-Einstellungen gespeichert.");
        } catch (error) {
            setMessage(error instanceof Error ? error.message : "Speichern fehlgeschlagen.");
        } finally {
            setSaving(false);
        }
    }

    async function createPlaylist() {
        setMessage("");
        try {
            const response = await fetch("/api/iptv/vxparser/playlist-link", { method: "POST" });
            const data = await response.json();
            if (!response.ok) throw new Error(data.error || "M3U-Link konnte nicht erstellt werden.");
            setPlaylistUrl(data.url);
            setMessage("M3U-Link erstellt. Du kannst ihn jetzt kopieren und im IPTV-Player eintragen.");
        } catch (error) {
            setMessage(error instanceof Error ? error.message : "M3U-Link konnte nicht erstellt werden.");
        }
    }

    async function refreshSources() {
        setMessage("");
        try {
            const response = await fetch("/api/iptv/vxparser/refresh", { method: "POST" });
            const data = await response.json();
            if (!response.ok) throw new Error(data.error || "Aktualisierung konnte nicht gestartet werden.");
            setMessage(
                data.status === "running"
                    ? "Die VXParser-Daten werden bereits aktualisiert."
                    : "VXParser-Datenaktualisierung wurde gestartet. Bitte etwas warten und danach den M3U-Link öffnen."
            );
        } catch (error) {
            setMessage(error instanceof Error ? error.message : "Aktualisierung fehlgeschlagen.");
        }
    }

    return (
        <div className="space-y-3 rounded-lg border border-border/60 p-3">
            <div>
                <h3 className="font-medium">VXParser</h3>
                <p className="text-sm text-muted-foreground">
                    VXParser-Optionen und deine persönliche M3U-Playlist. Die Einstellungen werden getrennt von deinen DebridUI-Kontodaten gespeichert.
                </p>
            </div>
            {loading ? (
                <p className="text-sm text-muted-foreground">VXParser-Einstellungen werden geladen…</p>
            ) : items.length ? (
                <>
                    {Object.entries(
                        items.reduce<Record<string, VXParserSetting[]>>((groups, item) => {
                            const key = item.group || "Weitere Einstellungen";
                            if (!groups[key]) groups[key] = [];
                            groups[key].push(item);
                            return groups;
                        }, {})
                    ).map(([group, settings]) => (
                        <div key={group} className="space-y-2">
                            <h4 className="text-sm font-medium">{group}</h4>
                            {settings.map((item) => (
                                <div key={item.name} className="space-y-1">
                                    <Label htmlFor={`vx-${item.name}`}>{item.info || item.name}</Label>
                                    <Input
                                        id={`vx-${item.name}`}
                                        type={item.sensitive ? "password" : "text"}
                                        value={values[item.name] ?? ""}
                                        disabled={item.readOnly || saving}
                                        onChange={(event) =>
                                            setValues((current) => ({ ...current, [item.name]: event.target.value }))
                                        }
                                    />
                                </div>
                            ))}
                        </div>
                    ))}
                    <Button onClick={saveSettings} disabled={saving} className="w-full">
                        {saving ? "Speichert…" : "VXParser-Einstellungen speichern"}
                    </Button>
                </>
            ) : (
                <p className="text-sm text-muted-foreground">
                    VXParser ist in dieser Umgebung noch nicht verbunden. Nach der Freigabe der Integration erscheint die vollständige Einstellungsliste hier.
                </p>
            )}
            <Button onClick={refreshSources} variant="outline" className="w-full">
                VXParser-Senderdaten aktualisieren
            </Button>
            <Button onClick={createPlaylist} variant="outline" className="w-full">
                M3U-Playlist-Link erstellen
            </Button>
            {playlistUrl && (
                <div className="space-y-2">
                    <Input readOnly value={playlistUrl} aria-label="VXParser M3U-URL" />
                    <Button
                        variant="outline"
                        className="w-full"
                        onClick={() => void navigator.clipboard.writeText(playlistUrl)}>
                        M3U-Link kopieren
                    </Button>
                </div>
            )}
            {message && (
                <p role="status" className="text-xs text-muted-foreground">
                    {message}
                </p>
            )}
        </div>
    );
}

