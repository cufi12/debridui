"use server";

import { eq } from "drizzle-orm";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { db, upsertUserSettings } from "@/lib/db/drizzle";
import { userSettings } from "@/lib/db/schema";

const providerSchema = z
    .object({
        id: z.string().min(1).max(100),
        name: z.string().min(1).max(100),
        description: z.string().max(500).optional().default(""),
        version: z.string().max(40).optional().default(""),
        author: z.string().max(100).optional().default(""),
        filename: z.string().min(1).max(300),
        supportedTypes: z
            .array(z.enum(["movie", "tv", "series"]))
            .max(5)
            .default(["movie", "tv"]),
        enabled: z.boolean().optional().default(false),
        logo: z.string().url().optional(),
        contentLanguage: z.array(z.string().max(12)).max(30).optional().default([]),
    })
    .passthrough();

const repositoryManifestSchema = z
    .object({
        name: z.string().min(1).max(120),
        description: z.string().max(500).optional().default(""),
        version: z.string().max(40).optional().default(""),
        // Nuvio repositories use either "providers" or the older "scrapers" key.
        providers: z.array(providerSchema).max(300).optional(),
        scrapers: z.array(providerSchema).max(300).optional(),
    })
    .passthrough()
    .refine((manifest) => manifest.providers !== undefined || manifest.scrapers !== undefined, {
        message: "Manifest must contain providers or scrapers",
    })
    .refine(
        (manifest) => {
            const providers = manifest.providers ?? manifest.scrapers ?? [];
            return new Set(providers.map((provider) => provider.id)).size === providers.length;
        },
        {
            message: "Provider IDs must be unique within a repository",
        }
    );

type Provider = z.infer<typeof providerSchema> & { enabled: boolean };
type Repository = {
    id: string;
    url: string;
    name: string;
    version: string;
    providers: Provider[];
    updatedAt: string;
};

async function currentUserId() {
    const session = await auth.api.getSession({ headers: await headers() });
    if (!session) redirect("/login");
    return session.user.id;
}

function validateRepositoryUrl(value: string) {
    const url = new URL(z.string().url().parse(value));
    const allowed = ["raw.githubusercontent.com", "github.io", "gitlab.com", "gitlab.io", "codeberg.org"];
    if (
        url.protocol !== "https:" ||
        !allowed.some((host) => url.hostname === host || url.hostname.endsWith(`.${host}`))
    ) {
        throw new Error("Erlaubt sind HTTPS-Manifest-URLs von GitHub, GitLab oder Codeberg.");
    }
    if (!url.pathname.toLowerCase().endsWith("manifest.json")) {
        throw new Error("Die Repository-URL muss auf manifest.json enden.");
    }
    return url.toString();
}

async function readLimitedText(response: Response, maxBytes = 1_000_000): Promise<string> {
    const declaredLength = Number(response.headers.get("content-length") || 0);
    if (declaredLength > maxBytes) throw new Error("Datei ist zu groß (maximal 1 MB).");
    if (!response.body) throw new Error("Leere Serverantwort.");

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let totalBytes = 0;
    let result = "";
    try {
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            totalBytes += value.byteLength;
            if (totalBytes > maxBytes) {
                await reader.cancel();
                throw new Error("Datei ist zu groß (maximal 1 MB).");
            }
            result += decoder.decode(value, { stream: true });
        }
        return result + decoder.decode();
    } finally {
        reader.releaseLock();
    }
}

async function loadManifest(url: string) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12_000);
    try {
        const response = await fetch(url, {
            headers: { accept: "application/json" },
            cache: "no-store",
            redirect: "error",
            signal: controller.signal,
        });
        if (!response.ok) throw new Error(`Repository antwortet mit HTTP ${response.status}.`);
        const text = await readLimitedText(response);
        const parsed = repositoryManifestSchema.parse(JSON.parse(text));
        const base = new URL(".", url);
        const providers = (parsed.providers ?? parsed.scrapers ?? []).map((provider) => {
            const file = new URL(provider.filename, base);
            if (
                file.protocol !== "https:" ||
                file.origin !== base.origin ||
                !file.pathname.startsWith(base.pathname.replace(/[^/]*$/, ""))
            ) {
                throw new Error(`Ungültiger Provider-Pfad bei ${provider.name}.`);
            }
            return { ...provider, enabled: false };
        });
        return { name: parsed.name, version: parsed.version, providers };
    } catch (error) {
        if (error instanceof z.ZodError) throw new Error("Das Manifest hat kein unterstütztes Nuvio-Format.");
        if (error instanceof SyntaxError) throw new Error("Die URL liefert kein gültiges JSON.");
        throw error;
    } finally {
        clearTimeout(timeout);
    }
}

async function readRepositories(userId: string): Promise<Repository[]> {
    const [row] = await db
        .select({ settings: userSettings.settings })
        .from(userSettings)
        .where(eq(userSettings.userId, userId))
        .limit(1);
    const settings = row?.settings && typeof row.settings === "object" ? (row.settings as Record<string, unknown>) : {};
    const parsed = z.array(z.any()).max(20).safeParse(settings.pluginRepositories);
    return parsed.success ? (parsed.data as Repository[]) : [];
}

async function writeRepositories(userId: string, repositories: Repository[]) {
    await upsertUserSettings(db, userId, { pluginRepositories: repositories });
}

export async function getPluginRepositories() {
    return readRepositories(await currentUserId());
}

/** Return only explicitly enabled providers for stream discovery. */
export async function getEnabledRepositoryProviders(mediaType?: "movie" | "tv") {
    const repositories = await readRepositories(await currentUserId());
    return repositories
        .flatMap((repository) =>
            repository.providers
                .filter((provider) => provider.enabled)
                .filter(
                    (provider) =>
                        !mediaType ||
                        (mediaType === "movie"
                            ? provider.supportedTypes.includes("movie")
                            : provider.supportedTypes.includes("tv") || provider.supportedTypes.includes("series"))
                )
                .map((provider) => ({
                    repositoryId: repository.id,
                    repositoryName: repository.name,
                    providerId: provider.id,
                    providerName: provider.name,
                    filename: provider.filename,
                    supportedTypes: provider.supportedTypes,
                }))
        )
        .slice(0, 100);
}

export async function addPluginRepository(rawUrl: string) {
    const userId = await currentUserId();
    const url = validateRepositoryUrl(rawUrl.trim());
    const existing = await readRepositories(userId);
    if (existing.some((repo) => repo.url === url)) throw new Error("Dieses Repository ist bereits hinzugefügt.");
    if (existing.length >= 20) throw new Error("Maximal 20 Repositories sind möglich.");
    const manifest = await loadManifest(url);
    const repository: Repository = {
        id: crypto.randomUUID(),
        url,
        ...manifest,
        providers: manifest.providers.map((provider) => ({ ...provider, enabled: false })),
        updatedAt: new Date().toISOString(),
    };
    await writeRepositories(userId, [...existing, repository]);
    return repository;
}

export async function refreshPluginRepository(repositoryId: string) {
    const userId = await currentUserId();
    const repositories = await readRepositories(userId);
    const current = repositories.find((repo) => repo.id === repositoryId);
    if (!current) throw new Error("Repository nicht gefunden.");
    const manifest = await loadManifest(current.url);
    const providers = manifest.providers.map((provider) => ({
        ...provider,
        enabled: current.providers.find((old) => old.id === provider.id)?.enabled ?? false,
    }));
    const updated = { ...current, ...manifest, providers, updatedAt: new Date().toISOString() };
    await writeRepositories(
        userId,
        repositories.map((repo) => (repo.id === repositoryId ? updated : repo))
    );
    return updated;
}

export async function setRepositoryProviderEnabled(repositoryId: string, providerId: string, enabled: boolean) {
    const userId = await currentUserId();
    const repos = await readRepositories(userId);
    const repo = repos.find((item) => item.id === repositoryId);
    if (!repo) throw new Error("Repository nicht gefunden.");
    if (!repo.providers.some((provider) => provider.id === providerId)) throw new Error("Provider nicht gefunden.");
    const updated = repos.map((item) =>
        item.id !== repositoryId
            ? item
            : {
                  ...item,
                  providers: item.providers.map((provider) =>
                      provider.id === providerId ? { ...provider, enabled: z.boolean().parse(enabled) } : provider
                  ),
              }
    );
    await writeRepositories(userId, updated);
    return { success: true };
}

export async function removePluginRepository(repositoryId: string) {
    const userId = await currentUserId();
    const repos = await readRepositories(userId);
    await writeRepositories(
        userId,
        repos.filter((repo) => repo.id !== repositoryId)
    );
    return { success: true };
}

/**
 * Fetch one opted-in provider module without executing it on the server.
 * The source is returned to the client-side sandbox layer; callers must never
 * evaluate it in the application realm.
 */
/** Fetch a bounded batch of enabled provider modules for the isolated runtime. */
export async function getEnabledRepositoryProviderSources(mediaType: "movie" | "tv") {
    const userId = await currentUserId();
    const repositories = await readRepositories(userId);
    const providers = repositories
        .flatMap((repository) =>
            repository.providers
                .filter((provider) => provider.enabled)
                .filter((provider) =>
                    mediaType === "movie"
                        ? provider.supportedTypes.includes("movie")
                        : provider.supportedTypes.includes("tv") || provider.supportedTypes.includes("series")
                )
                .map((provider) => ({ repository, provider }))
        )
        .slice(0, 100);

    const output: Array<{
        repositoryId: string;
        repositoryName: string;
        providerId: string;
        providerName: string;
        source?: string;
        error?: string;
    }> = [];
    let totalBytes = 0;
    console.info("[repository-providers] Loading enabled provider files:", {
        mediaType,
        enabledProviders: providers.length,
    });

    for (let index = 0; index < providers.length; index += 4) {
        const batch = await Promise.all(
            providers.slice(index, index + 4).map(async ({ repository, provider }) => {
                try {
                    const base = new URL(".", validateRepositoryUrl(repository.url));
                    const file = new URL(provider.filename, base);
                    const folder = base.pathname.replace(/[^/]*$/, "");
                    if (
                        file.protocol !== "https:" ||
                        file.origin !== base.origin ||
                        !file.pathname.startsWith(folder)
                    ) {
                        throw new Error("Ungültiger Provider-Pfad.");
                    }
                    const controller = new AbortController();
                    const timeout = setTimeout(() => controller.abort(), 12_000);
                    try {
                        const response = await fetch(file, {
                            headers: { accept: "text/javascript, application/javascript, text/plain" },
                            cache: "no-store",
                            redirect: "error",
                            signal: controller.signal,
                        });
                        if (!response.ok) throw new Error(`HTTP ${response.status}`);
                        const source = await readLimitedText(response, 500_000);
                        const bytes = new TextEncoder().encode(source).byteLength;
                        console.info("[repository-providers] Provider file loaded:", {
                            providerId: provider.id,
                            httpStatus: response.status,
                            bytes,
                        });
                        return {
                            repositoryId: repository.id,
                            repositoryName: repository.name,
                            providerId: provider.id,
                            providerName: provider.name,
                            source,
                            bytes,
                        };
                    } finally {
                        clearTimeout(timeout);
                    }
                } catch (error) {
                    console.warn("[repository-providers] Provider file load failed:", {
                        providerId: provider.id,
                        error: error instanceof Error ? error.message : String(error),
                    });
                    return {
                        repositoryId: repository.id,
                        repositoryName: repository.name,
                        providerId: provider.id,
                        providerName: provider.name,
                        error: "Provider-Quelldatei konnte nicht geladen werden.",
                        bytes: 0,
                    };
                }
            })
        );
        for (const item of batch) {
            if (item.source) {
                if (totalBytes + item.bytes > 3_000_000) {
                    output.push({
                        repositoryId: item.repositoryId,
                        repositoryName: item.repositoryName,
                        providerId: item.providerId,
                        providerName: item.providerName,
                        error: "Gesamtlimit für Provider-Code erreicht.",
                    });
                    continue;
                }
                totalBytes += item.bytes;
            }
            const { bytes: _bytes, ...publicItem } = item;
            output.push(publicItem);
        }
    }
    console.info("[repository-providers] Provider file loading finished:", {
        returnedProviders: output.length,
        loadedProviders: output.filter((item) => Boolean(item.source)).length,
        failedProviders: output.filter((item) => Boolean(item.error)).length,
        totalBytes,
    });
    return output;
}

/** Check enabled provider files without executing their code. */
export async function getRepositoryProviderFileStatuses() {
    const userId = await currentUserId();
    const repositories = await readRepositories(userId);
    const providers = repositories
        .flatMap((repository) =>
            repository.providers.filter((provider) => provider.enabled).map((provider) => ({ repository, provider }))
        )
        .slice(0, 100);

    const statuses: Array<{
        repositoryId: string;
        providerId: string;
        status: "ok" | "empty" | "error";
        bytes: number;
        message: string;
    }> = [];

    for (let index = 0; index < providers.length; index += 4) {
        const batch = await Promise.all(
            providers.slice(index, index + 4).map(async ({ repository, provider }) => {
                const controller = new AbortController();
                const timeout = setTimeout(() => controller.abort(), 12_000);
                try {
                    const base = new URL(".", validateRepositoryUrl(repository.url));
                    const file = new URL(provider.filename, base);
                    const folder = base.pathname.replace(/[^/]*$/, "");
                    if (
                        file.protocol !== "https:" ||
                        file.origin !== base.origin ||
                        !file.pathname.startsWith(folder)
                    ) {
                        throw new Error("Ungültiger Provider-Pfad.");
                    }
                    const response = await fetch(file, {
                        headers: { accept: "text/javascript, application/javascript, text/plain" },
                        cache: "no-store",
                        redirect: "error",
                        signal: controller.signal,
                    });
                    if (!response.ok) throw new Error(`HTTP ${response.status}`);
                    const source = await readLimitedText(response, 500_000);
                    const bytes = new TextEncoder().encode(source).byteLength;
                    const trimmed = source.trim();
                    const looksLikeHtml = /^(<!doctype\\s+html|<html[\\s>])/i.test(trimmed);
                    if (!trimmed || looksLikeHtml) {
                        return {
                            repositoryId: repository.id,
                            providerId: provider.id,
                            status: "empty" as const,
                            bytes,
                            message: looksLikeHtml
                                ? "Server liefert HTML statt Provider-Code."
                                : "Quelldatei ist leer.",
                        };
                    }
                    return {
                        repositoryId: repository.id,
                        providerId: provider.id,
                        status: "ok" as const,
                        bytes,
                        message: "Quelldatei erreichbar und nicht leer.",
                    };
                } catch (error) {
                    return {
                        repositoryId: repository.id,
                        providerId: provider.id,
                        status: "error" as const,
                        bytes: 0,
                        message: error instanceof Error ? error.message : "Datei konnte nicht geprüft werden.",
                    };
                } finally {
                    clearTimeout(timeout);
                }
            })
        );
        statuses.push(...batch);
    }
    return statuses;
}

export async function getRepositoryProviderSource(repositoryId: string, providerId: string) {
    const userId = await currentUserId();
    const repositories = await readRepositories(userId);
    const repository = repositories.find((item) => item.id === repositoryId);
    if (!repository) throw new Error("Repository nicht gefunden.");

    const provider = repository.providers.find((item) => item.id === providerId);
    if (!provider) throw new Error("Provider nicht gefunden.");
    if (!provider.enabled) throw new Error("Provider ist deaktiviert.");

    const manifestUrl = validateRepositoryUrl(repository.url);
    const base = new URL(".", manifestUrl);
    const file = new URL(provider.filename, base);
    const folder = base.pathname.replace(/[^/]*$/, "");
    if (file.protocol !== "https:" || file.origin !== base.origin || !file.pathname.startsWith(folder)) {
        throw new Error("Ungültiger Provider-Pfad.");
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12_000);
    try {
        const response = await fetch(file, {
            headers: { accept: "text/javascript, application/javascript, text/plain" },
            cache: "no-store",
            redirect: "error",
            signal: controller.signal,
        });
        if (!response.ok) throw new Error(`Provider antwortet mit HTTP ${response.status}.`);
        const source = await readLimitedText(response);
        return { providerId: provider.id, providerName: provider.name, source };
    } finally {
        clearTimeout(timeout);
    }
}
