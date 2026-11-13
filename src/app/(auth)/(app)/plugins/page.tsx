"use client";

import { Blocks, ExternalLink, Power, RefreshCw, ShieldCheck, Trash2, Upload } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
    addPluginRepository,
    getPluginRepositories,
    refreshPluginRepository,
    removePluginRepository,
    setRepositoryProviderEnabled,
} from "@/features/plugins/actions/repositories";

type Provider = {
    id: string;
    name: string;
    description: string;
    version: string;
    author: string;
    filename: string;
    supportedTypes: string[];
    enabled: boolean;
    logo?: string;
    contentLanguage?: string[];
};
type Repository = {
    id: string;
    url: string;
    name: string;
    version: string;
    providers: Provider[];
    updatedAt: string;
};

export default function PluginsPage() {
    const [repositories, setRepositories] = useState<Repository[]>([]);
    const [url, setUrl] = useState("");
    const [loading, setLoading] = useState(true);
    const [adding, setAdding] = useState(false);
    const [busy, setBusy] = useState<string | null>(null);

    const refresh = useCallback(async () => {
        setLoading(true);
        try {
            setRepositories(await getPluginRepositories());
        } catch {
            toast.error("Plugin-Repositories konnten nicht geladen werden.");
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        void refresh();
    }, [refresh]);

    const add = async () => {
        setAdding(true);
        try {
            const repo = await addPluginRepository(url);
            setUrl("");
            await refresh();
            toast.success(`${repo.name} hinzugefügt · ${repo.providers.length} Provider gefunden`);
        } catch (error) {
            toast.error(error instanceof Error ? error.message : "Repository konnte nicht hinzugefügt werden.");
        } finally {
            setAdding(false);
        }
    };

    const refreshRepo = async (repo: Repository) => {
        setBusy(repo.id);
        try {
            const updated = await refreshPluginRepository(repo.id);
            setRepositories((items) => items.map((item) => (item.id === repo.id ? updated : item)));
            toast.success(`${updated.name} aktualisiert`);
        } catch (error) {
            toast.error(error instanceof Error ? error.message : "Aktualisierung fehlgeschlagen.");
        } finally {
            setBusy(null);
        }
    };

    const toggle = async (repo: Repository, provider: Provider) => {
        const key = `${repo.id}:${provider.id}`;
        setBusy(key);
        try {
            await setRepositoryProviderEnabled(repo.id, provider.id, !provider.enabled);
            setRepositories((items) =>
                items.map((item) =>
                    item.id !== repo.id
                        ? item
                        : {
                              ...item,
                              providers: item.providers.map((p) =>
                                  p.id === provider.id ? { ...p, enabled: !p.enabled } : p
                              ),
                          }
                )
            );
        } catch (error) {
            toast.error(error instanceof Error ? error.message : "Provider-Status konnte nicht geändert werden.");
        } finally {
            setBusy(null);
        }
    };

    const remove = async (repo: Repository) => {
        if (!window.confirm(`Repository "${repo.name}" entfernen?`)) return;
        setBusy(repo.id);
        try {
            await removePluginRepository(repo.id);
            await refresh();
            toast.success("Repository entfernt.");
        } catch {
            toast.error("Repository konnte nicht entfernt werden.");
        } finally {
            setBusy(null);
        }
    };

    return (
        <div className="mx-auto w-full max-w-4xl space-y-4 pb-16 sm:space-y-6 lg:space-y-8">
            <PageHeader
                icon={Blocks}
                title="Plugins"
                description="Füge Provider-Repositories per manifest.json hinzu und verwalte einzelne Provider."
                primaryAction={
                    <Button
                        onClick={() => void refresh()}
                        disabled={loading}
                        variant="ghost"
                        size="icon"
                        aria-label="Aktualisieren">
                        <RefreshCw className={`size-5 ${loading ? "animate-spin" : ""}`} />
                    </Button>
                }
            />

            <section className="space-y-3">
                <h2 className="text-sm font-medium">Plugin-Repository hinzufügen</h2>
                <div className="rounded-lg border bg-card p-4 space-y-3">
                    <p className="text-sm text-muted-foreground">
                        Füge die HTTPS-URL einer Nuvio-kompatiblen Repository-manifest.json ein. Das Manifest wird
                        geprüft und seine Provider werden einzeln aufgelistet.
                    </p>
                    <input
                        value={url}
                        onChange={(event) => setUrl(event.target.value)}
                        onKeyDown={(event) => {
                            if (event.key === "Enter") void add();
                        }}
                        placeholder="https://raw.githubusercontent.com/…/manifest.json"
                        type="url"
                        aria-label="Repository-Manifest-URL"
                        className="w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    />
                    <div className="flex justify-end">
                        <Button onClick={() => void add()} disabled={adding || !url.trim()}>
                            <Upload className="mr-2 size-4" />
                            {adding ? "Wird geladen…" : "Repository hinzufügen"}
                        </Button>
                    </div>
                </div>
            </section>

            <section className="space-y-3">
                <div className="flex items-center justify-between gap-2">
                    <h2 className="text-sm font-medium">Meine Repositories</h2>
                    <Badge variant="secondary">{repositories.length} / 20</Badge>
                </div>
                {loading ? (
                    <div className="rounded-lg border p-6 text-center text-sm text-muted-foreground">
                        Repositories werden geladen…
                    </div>
                ) : repositories.length === 0 ? (
                    <div className="rounded-lg border p-6 text-center">
                        <Blocks className="mx-auto mb-2 size-7 text-muted-foreground" />
                        <p className="text-sm font-medium">Noch keine Repositories</p>
                        <p className="mt-1 text-sm text-muted-foreground">Füge oben eine Repository-URL hinzu.</p>
                    </div>
                ) : (
                    repositories.map((repo) => (
                        <div key={repo.id} className="rounded-lg border bg-card p-4 space-y-3">
                            <div className="flex flex-wrap items-start justify-between gap-3">
                                <div className="min-w-0">
                                    <div className="flex flex-wrap items-center gap-2">
                                        <h3 className="font-medium">{repo.name}</h3>
                                        <Badge variant="outline">v{repo.version || "?"}</Badge>
                                        <Badge variant="secondary">
                                            {repo.providers.filter((p) => p.enabled).length}/{repo.providers.length}{" "}
                                            aktiv
                                        </Badge>
                                    </div>
                                    <a
                                        href={repo.url}
                                        target="_blank"
                                        rel="noreferrer"
                                        className="mt-1 inline-flex max-w-full items-center gap-1 break-all text-xs text-muted-foreground hover:text-foreground">
                                        {repo.url} <ExternalLink className="size-3 shrink-0" />
                                    </a>
                                </div>
                                <div className="flex gap-1">
                                    <Button
                                        size="icon"
                                        variant="ghost"
                                        aria-label="Repository aktualisieren"
                                        disabled={busy === repo.id}
                                        onClick={() => void refreshRepo(repo)}>
                                        <RefreshCw className={`size-4 ${busy === repo.id ? "animate-spin" : ""}`} />
                                    </Button>
                                    <Button
                                        size="icon"
                                        variant="ghost"
                                        aria-label="Repository entfernen"
                                        disabled={busy === repo.id}
                                        onClick={() => void remove(repo)}>
                                        <Trash2 className="size-4 text-destructive" />
                                    </Button>
                                </div>
                            </div>
                            <div className="divide-y rounded-md border">
                                {repo.providers.map((provider) => (
                                    <div key={provider.id} className="flex items-center justify-between gap-3 p-3">
                                        <div className="min-w-0">
                                            <div className="flex flex-wrap items-center gap-2">
                                                <span className="truncate text-sm font-medium">{provider.name}</span>
                                                {provider.version && (
                                                    <Badge variant="outline">v{provider.version}</Badge>
                                                )}
                                                <Badge variant={provider.enabled ? "default" : "secondary"}>
                                                    {provider.enabled ? "Aktiv" : "Aus"}
                                                </Badge>
                                            </div>
                                            <p className="mt-0.5 text-xs text-muted-foreground">
                                                {provider.description || provider.id}
                                            </p>
                                            <p className="mt-0.5 text-xs text-muted-foreground">
                                                {(provider.supportedTypes || []).join(", ")}
                                                {provider.contentLanguage?.length
                                                    ? ` · ${provider.contentLanguage.join(", ")}`
                                                    : ""}
                                            </p>
                                        </div>
                                        <Button
                                            size="sm"
                                            variant="outline"
                                            disabled={busy === `${repo.id}:${provider.id}`}
                                            onClick={() => void toggle(repo, provider)}>
                                            <Power className="mr-1.5 size-3.5" />{" "}
                                            {provider.enabled ? "Deaktivieren" : "Aktivieren"}
                                        </Button>
                                    </div>
                                ))}
                            </div>
                        </div>
                    ))
                )}
            </section>

            <div className="rounded-lg border p-4 space-y-2">
                <div className="flex items-center gap-2 text-sm font-medium">
                    <ShieldCheck className="size-4 text-muted-foreground" /> Sicherheit und Kompatibilität
                </div>
                <p className="text-sm text-muted-foreground">
                    Provider-JavaScript läuft isoliert in QuickJS – ohne Zugriff auf Node.js, Dateien oder
                    Umgebungsvariablen. Netzwerkzugriffe sind auf HTTP(S)-Ziele mit öffentlichen IPv4-Adressen
                    beschränkt; private Netzwerke werden blockiert. Manche Provider mit zusätzlichen Laufzeit-
                    Abhängigkeiten können inkompatibel sein. Benötigte Stream-Header werden übernommen, aber nicht
                    jeder externe Player unterstützt sie. Akzeptiert werden nur HTTPS-Repositories von GitHub,
                    GitLab und Codeberg.
                </p>
            </div>
        </div>
    );
}
