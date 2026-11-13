"use client";

import { Blocks, Check, Download, ExternalLink, Power, RefreshCw, ShieldCheck, Trash2, Upload } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { installPlugin, getUserPlugins, removePlugin, setPluginEnabled } from "@/features/plugins/actions/plugins";

type Plugin = {
    id: string;
    name: string;
    version: string;
    description: string;
    author: string;
    homepage?: string;
    capabilities: Array<"subtitles" | "player" | "metadata" | "iptv">;
    enabled: boolean;
    installedAt: string;
};

const EXAMPLE_MANIFEST = JSON.stringify({
    id: "example.subtitle-helper",
    name: "Subtitle Helper",
    version: "1.0.0",
    description: "Beispiel für ein DebridUI-Erweiterungsmanifest.",
    author: "Dein Name",
    capabilities: ["subtitles"],
}, null, 2);

const CAPABILITY_LABELS: Record<Plugin["capabilities"][number], string> = {
    subtitles: "Untertitel",
    player: "Player",
    metadata: "Filminformationen",
    iptv: "IPTV",
};

export default function PluginsPage() {
    const [plugins, setPlugins] = useState<Plugin[]>([]);
    const [manifestText, setManifestText] = useState("");
    const [isLoading, setIsLoading] = useState(true);
    const [isInstalling, setIsInstalling] = useState(false);
    const [busyPlugin, setBusyPlugin] = useState<string | null>(null);

    const refresh = useCallback(async () => {
        setIsLoading(true);
        try {
            setPlugins(await getUserPlugins());
        } catch {
            toast.error("Plugins konnten nicht geladen werden.");
        } finally {
            setIsLoading(false);
        }
    }, []);

    useEffect(() => { void refresh(); }, [refresh]);

    const handleInstall = async () => {
        if (!manifestText.trim()) {
            toast.error("Bitte füge ein Plugin-Manifest im JSON-Format ein.");
            return;
        }
        setIsInstalling(true);
        try {
            const plugin = await installPlugin(manifestText);
            setManifestText("");
            await refresh();
            toast.success(`${plugin.name} wurde installiert.`);
        } catch (error) {
            toast.error(error instanceof Error ? error.message : "Plugin konnte nicht installiert werden.");
        } finally {
            setIsInstalling(false);
        }
    };

    const handleToggle = async (plugin: Plugin) => {
        setBusyPlugin(plugin.id);
        try {
            await setPluginEnabled(plugin.id, !plugin.enabled);
            await refresh();
            toast.success(plugin.enabled ? "Plugin deaktiviert." : "Plugin aktiviert.");
        } catch (error) {
            toast.error(error instanceof Error ? error.message : "Plugin-Status konnte nicht geändert werden.");
        } finally {
            setBusyPlugin(null);
        }
    };

    const handleRemove = async (plugin: Plugin) => {
        if (!window.confirm(`Plugin "${plugin.name}" wirklich entfernen?`)) return;
        setBusyPlugin(plugin.id);
        try {
            await removePlugin(plugin.id);
            await refresh();
            toast.success("Plugin entfernt.");
        } catch (error) {
            toast.error(error instanceof Error ? error.message : "Plugin konnte nicht entfernt werden.");
        } finally {
            setBusyPlugin(null);
        }
    };

    return (
        <div className="mx-auto w-full max-w-4xl space-y-4 pb-16 sm:space-y-6 lg:space-y-8">
            <PageHeader
                icon={Blocks}
                title="Plugins"
                description="Installiere und verwalte zusätzliche DebridUI-Erweiterungen."
                primaryAction={
                    <Button onClick={() => void refresh()} disabled={isLoading} variant="ghost" size="icon" aria-label="Aktualisieren">
                        <RefreshCw className={`size-5 ${isLoading ? "animate-spin" : ""}`} />
                    </Button>
                }
            />

            <section className="space-y-3">
                <div className="flex items-center gap-2">
                    <Download className="size-4 text-muted-foreground" />
                    <h2 className="text-sm font-medium">Plugin installieren oder aktualisieren</h2>
                </div>
                <div className="rounded-lg border bg-card p-4 space-y-3">
                    <p className="text-sm text-muted-foreground">
                        Füge das JSON-Manifest einer Erweiterung ein. Wird dieselbe Plugin-ID erneut installiert,
                        werden die Plugin-Informationen aktualisiert.
                    </p>
                    <textarea
                        value={manifestText}
                        onChange={(event) => setManifestText(event.target.value)}
                        placeholder={EXAMPLE_MANIFEST}
                        rows={9}
                        spellCheck={false}
                        aria-label="Plugin-Manifest als JSON"
                        className="w-full resize-y rounded-md border bg-background px-3 py-2 font-mono text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    />
                    <div className="flex flex-wrap items-center justify-between gap-2">
                        <Button type="button" variant="ghost" size="sm" onClick={() => setManifestText(EXAMPLE_MANIFEST)}>
                            Beispiel einfügen
                        </Button>
                        <Button onClick={() => void handleInstall()} disabled={isInstalling || !manifestText.trim()}>
                            <Upload className="mr-2 size-4" />
                            {isInstalling ? "Wird installiert…" : "Plugin installieren"}
                        </Button>
                    </div>
                </div>
            </section>

            <section className="space-y-3">
                <div className="flex items-center justify-between gap-2">
                    <h2 className="text-sm font-medium">Installierte Plugins</h2>
                    <Badge variant="secondary">{plugins.length} / 30</Badge>
                </div>
                {isLoading ? (
                    <div className="rounded-lg border p-6 text-center text-sm text-muted-foreground">Plugins werden geladen…</div>
                ) : plugins.length === 0 ? (
                    <div className="rounded-lg border p-6 text-center">
                        <Blocks className="mx-auto mb-2 size-7 text-muted-foreground" />
                        <p className="text-sm font-medium">Noch keine Plugins installiert</p>
                        <p className="mt-1 text-sm text-muted-foreground">Füge oben ein gültiges Plugin-Manifest ein.</p>
                    </div>
                ) : (
                    <div className="space-y-3">
                        {plugins.map((plugin) => (
                            <div key={plugin.id} className="rounded-lg border bg-card p-4 space-y-3">
                                <div className="flex flex-wrap items-start justify-between gap-3">
                                    <div className="min-w-0 space-y-1">
                                        <div className="flex flex-wrap items-center gap-2">
                                            <h3 className="font-medium">{plugin.name}</h3>
                                            <Badge variant={plugin.enabled ? "default" : "secondary"}>
                                                {plugin.enabled ? "Aktiviert" : "Deaktiviert"}
                                            </Badge>
                                            <Badge variant="outline">v{plugin.version}</Badge>
                                        </div>
                                        <p className="text-sm text-muted-foreground">{plugin.description || "Keine Beschreibung."}</p>
                                        <p className="text-xs text-muted-foreground">
                                            {plugin.id}{plugin.author ? ` · von ${plugin.author}` : ""}
                                        </p>
                                    </div>
                                    {plugin.homepage && (
                                        <a href={plugin.homepage} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
                                            Webseite <ExternalLink className="size-3" />
                                        </a>
                                    )}
                                </div>
                                <div className="flex flex-wrap gap-1.5">
                                    {plugin.capabilities.map((capability) => (
                                        <Badge key={capability} variant="outline">{CAPABILITY_LABELS[capability]}</Badge>
                                    ))}
                                    {plugin.capabilities.length === 0 && <span className="text-xs text-muted-foreground">Keine Funktionen angegeben</span>}
                                </div>
                                <div className="flex flex-wrap gap-2 border-t pt-3">
                                    <Button size="sm" variant="outline" disabled={busyPlugin === plugin.id} onClick={() => void handleToggle(plugin)}>
                                        <Power className="mr-2 size-3.5" />
                                        {plugin.enabled ? "Deaktivieren" : "Aktivieren"}
                                    </Button>
                                    <Button size="sm" variant="ghost" className="text-destructive hover:text-destructive" disabled={busyPlugin === plugin.id} onClick={() => void handleRemove(plugin)}>
                                        <Trash2 className="mr-2 size-3.5" /> Entfernen
                                    </Button>
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </section>

            <div className="rounded-lg border border-border/70 p-4 space-y-2">
                <div className="flex items-center gap-2 text-sm font-medium">
                    <ShieldCheck className="size-4 text-muted-foreground" />
                    Sicheres Plugin-Format
                </div>
                <p className="text-sm text-muted-foreground">
                    DebridUI speichert hier ausschließlich geprüfte Plugin-Metadaten. Fremde JavaScript-Dateien,
                    ausführbarer Code und unbekannte Manifest-Felder werden nicht geladen oder ausgeführt.
                    Die hier aufgeführten Funktionsbereiche sind vorbereitet; die jeweiligen Plugin-Schnittstellen
                    müssen noch einzeln in DebridUI integriert werden.
                </p>
                <div className="flex items-center gap-1 text-xs text-muted-foreground">
                    <Check className="size-3.5" /> Zugangsdaten bleiben außerhalb der Plugin-Manifeste
                </div>
            </div>
        </div>
    );
}
