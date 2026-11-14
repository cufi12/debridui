"use client";

import { Power, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { SectionDivider } from "@/components/layout/section-divider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
    getPluginRepositories,
    getRepositoryProviderFileStatuses,
    setRepositoryProviderEnabled,
} from "@/features/plugins/actions/repositories";

type Provider = {
    id: string;
    name: string;
    description: string;
    version: string;
    supportedTypes: string[];
    contentLanguage?: string[];
    enabled: boolean;
};
type ProviderHealth = { status: "ok" | "empty" | "error"; bytes: number; message: string };
type Repository = {
    id: string;
    name: string;
    providers: Provider[];
};

export function RepositoryProviderListSection() {
    const [repositories, setRepositories] = useState<Repository[]>([]);
    const [loading, setLoading] = useState(true);
    const [busy, setBusy] = useState<string | null>(null);
    const [health, setHealth] = useState<Record<string, ProviderHealth>>({});

    const refresh = useCallback(async () => {
        setLoading(true);
        try {
            const nextRepositories = await getPluginRepositories();
            setRepositories(nextRepositories);
            const checks = await getRepositoryProviderFileStatuses();
            setHealth(Object.fromEntries(checks.map((item) => [`${item.repositoryId}:${item.providerId}`, item])));
        } catch {
            toast.error("Repository-Provider konnten nicht geladen werden.");
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        void refresh();
    }, [refresh]);

    const providers = repositories.flatMap((repository) =>
        repository.providers.map((provider) => ({ repository, provider }))
    );
    const enabledCount = providers.filter(({ provider }) => provider.enabled).length;

    const toggle = async (repository: Repository, provider: Provider) => {
        const key = `${repository.id}:${provider.id}`;
        setBusy(key);
        try {
            await setRepositoryProviderEnabled(repository.id, provider.id, !provider.enabled);
            setRepositories((items) =>
                items.map((item) =>
                    item.id !== repository.id
                        ? item
                        : {
                              ...item,
                              providers: item.providers.map((entry) =>
                                  entry.id === provider.id ? { ...entry, enabled: !entry.enabled } : entry
                              ),
                          }
                )
            );
            toast.success(`${provider.name} ${provider.enabled ? "deaktiviert" : "aktiviert"}`);
            const checks = await getRepositoryProviderFileStatuses();
            setHealth(Object.fromEntries(checks.map((item) => [`${item.repositoryId}:${item.providerId}`, item])));
        } catch (error) {
            toast.error(error instanceof Error ? error.message : "Provider-Status konnte nicht geändert werden.");
        } finally {
            setBusy(null);
        }
    };

    return (
        <section className="space-y-4">
            <div className="flex items-center justify-between gap-2">
                <SectionDivider label="Repository-Provider" />
                <Button
                    onClick={() => void refresh()}
                    disabled={loading}
                    variant="ghost"
                    size="icon"
                    aria-label="Provider aktualisieren">
                    <RefreshCw className={`size-4 ${loading ? "animate-spin" : ""}`} />
                </Button>
            </div>
            <p className="text-xs text-muted-foreground">
                Alle Provider aus deinen hinzugefügten Repositories – unabhängig davon, ob sie gerade aktiviert sind.
                Diese Provider sind getrennt von klassischen Stremio-Addons.
            </p>
            {loading ? (
                <div className="rounded-lg border p-5 text-center text-sm text-muted-foreground">
                    Provider werden geladen…
                </div>
            ) : providers.length === 0 ? (
                <div className="rounded-lg border p-5 text-center">
                    <p className="text-sm font-medium">Noch keine Repository-Provider</p>
                    <p className="mt-1 text-xs text-muted-foreground">
                        Füge zuerst unter „Plugins“ ein Provider-Repository hinzu.
                    </p>
                </div>
            ) : (
                <>
                    <p className="text-xs text-muted-foreground">
                        {enabledCount} von {providers.length} Providern aktiviert
                    </p>
                    <div className="space-y-3">
                        {repositories.map((repository) =>
                            repository.providers.map((provider) => {
                                const key = `${repository.id}:${provider.id}`;
                                return (
                                    <div
                                        key={key}
                                        className="flex items-center justify-between gap-3 rounded-lg border bg-card p-3">
                                        <div className="min-w-0">
                                            <div className="flex flex-wrap items-center gap-2">
                                                <span className="text-sm font-medium">{provider.name}</span>
                                                <Badge variant={provider.enabled ? "default" : "secondary"}>
                                                    {provider.enabled ? "Aktiv" : "Aus"}
                                                </Badge>
                                            </div>
                                            <p className="mt-0.5 text-xs text-muted-foreground">
                                                {repository.name} · {provider.description || provider.id}
                                            </p>
                                            <p className="mt-0.5 text-xs text-muted-foreground">
                                                {(provider.supportedTypes || []).join(", ")}
                                                {provider.contentLanguage?.length
                                                    ? ` · ${provider.contentLanguage.join(", ")}`
                                                    : ""}
                                            </p>
                                            {provider.enabled && (
                                                <div className="mt-1 flex flex-wrap items-center gap-1.5">
                                                    {health[key] ? (
                                                        <>
                                                            <Badge
                                                                variant={
                                                                    health[key].status === "ok"
                                                                        ? "default"
                                                                        : "destructive"
                                                                }>
                                                                {health[key].status === "ok"
                                                                    ? "Datei erreichbar"
                                                                    : health[key].status === "empty"
                                                                      ? "Datei leer / falscher Inhalt"
                                                                      : "Datei nicht erreichbar"}
                                                            </Badge>
                                                            <span className="text-xs text-muted-foreground">
                                                                {health[key].bytes > 0
                                                                    ? `${Math.ceil(health[key].bytes / 1024)} KB · `
                                                                    : ""}
                                                                {health[key].message}
                                                            </span>
                                                        </>
                                                    ) : (
                                                        <span className="text-xs text-muted-foreground">
                                                            Datei wird geprüft…
                                                        </span>
                                                    )}
                                                </div>
                                            )}
                                        </div>
                                        <Button
                                            size="sm"
                                            variant="outline"
                                            disabled={busy === key}
                                            onClick={() => void toggle(repository, provider)}>
                                            <Power className="mr-1.5 size-3.5" />
                                            {provider.enabled ? "Deaktivieren" : "Aktivieren"}
                                        </Button>
                                    </div>
                                );
                            })
                        )}
                    </div>
                </>
            )}
        </section>
    );
}
