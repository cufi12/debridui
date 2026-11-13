import { parseStreams, sanitizeStreamHeaders } from "@/lib/addons/parser";
import type { AddonSource, AddonStream, TvSearchParams } from "@/lib/addons/types";
import type { Media } from "@/lib/trakt";

/** Check a repository provider's declared media compatibility. */
export function providerSupportsMediaType(supportedTypes: readonly string[], mediaType: "movie" | "tv"): boolean {
    return mediaType === "movie"
        ? supportedTypes.includes("movie")
        : supportedTypes.includes("tv") || supportedTypes.includes("series");
}

/** Arguments exposed to a Nuvio-compatible provider's getStreams function. */
export interface ProviderInvocation {
    tmdbId: number;
    mediaType: "movie" | "tv";
    season?: number;
    episode?: number;
}

export function createProviderInvocation(
    media: Media,
    type: "movie" | "show",
    tvParams?: TvSearchParams
): ProviderInvocation | null {
    const tmdbId = media.ids?.tmdb;
    if (!Number.isSafeInteger(tmdbId) || !tmdbId || tmdbId < 1) return null;

    if (type === "show") {
        if (!tvParams || !Number.isInteger(tvParams.season) || !Number.isInteger(tvParams.episode)) return null;
        return { tmdbId, mediaType: "tv", season: tvParams.season, episode: tvParams.episode };
    }

    return { tmdbId, mediaType: "movie" };
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Convert untrusted provider output into the shared Stremio-like stream shape.
 * Execution/sandboxing is deliberately handled by a separate runtime layer.
 */
export function normalizeProviderStreams(result: unknown, providerId: string, providerName: string): AddonStream[] {
    const candidate = Array.isArray(result)
        ? result
        : isRecord(result) && Array.isArray(result.streams)
          ? result.streams
          : [];

    return candidate.slice(0, 100).flatMap((item): AddonStream[] => {
        if (!isRecord(item)) return [];
        const rawUrl = typeof item.url === "string" ? item.url : typeof item.link === "string" ? item.link : "";
        let parsedUrl: URL | undefined;
        if (rawUrl) {
            try {
                parsedUrl = new URL(rawUrl);
            } catch {
                return [];
            }
            if (parsedUrl.protocol !== "https:" && parsedUrl.protocol !== "http:") return [];
        }

        const rawHash =
            typeof item.infoHash === "string"
                ? item.infoHash
                : typeof item.magnet === "string"
                  ? item.magnet.match(/urn:btih:([a-f0-9]{40}|[a-z2-7]{32})/i)?.[1]
                  : undefined;
        const infoHash = rawHash && /^(?:[a-f0-9]{40}|[a-z2-7]{32})$/i.test(rawHash) ? rawHash : undefined;
        if (!parsedUrl && !infoHash) return [];

        const rawName = typeof item.name === "string" ? item.name.slice(0, 300) : providerName;
        const resolution = typeof item.resolution === "string" ? item.resolution.slice(0, 20) : "";
        const quality = typeof item.quality === "string" ? item.quality.slice(0, 80) : "";
        const size = typeof item.size === "string" ? item.size.slice(0, 40) : "";
        const name = [rawName || providerName, resolution, quality].filter(Boolean).join(" · ");
        const title = typeof item.title === "string" ? item.title.slice(0, 500) : undefined;
        const details = [
            typeof item.description === "string" ? item.description.slice(0, 1500) : "",
            size ? `Size: ${size}` : "",
            quality && !name.includes(quality) ? quality : "",
        ].filter(Boolean);
        const description = [`[${providerId}]`, ...details].join(" · ").slice(0, 2000);

        return [
            {
                name,
                title,
                description: description || `Provider: ${providerName}`,
                ...(parsedUrl ? { url: parsedUrl.toString() } : {}),
                ...(infoHash ? { infoHash } : {}),
                headers: sanitizeStreamHeaders(item.headers),
            },
        ];
    });
}

/** Convert normalized repository-provider results into DebridUI's shared source model. */
export function parseRepositoryProviderStreams(
    result: unknown,
    repositoryId: string,
    providerId: string,
    providerName: string
): AddonSource[] {
    const streams = normalizeProviderStreams(result, providerId, providerName);
    // Namespaced IDs prevent providers with the same manifest ID in different
    // repositories from colliding with each other or with Stremio add-ons.
    const sourceId = `repository:${repositoryId}:${providerId}`;
    return parseStreams(streams, sourceId, providerName);
}

export interface RepositoryProviderModule {
    repositoryId: string;
    repositoryName: string;
    providerId: string;
    providerName: string;
    source: string;
}

export type RepositoryProviderExecutor = (source: string, invocation: ProviderInvocation) => Promise<unknown>;

/**
 * Run provider modules through an injected sandbox implementation.
 * This adapter deliberately has no eval/Function fallback: callers must
 * supply the dedicated sandbox executor.
 */
export async function executeRepositoryProviderModules(
    modules: RepositoryProviderModule[],
    invocation: ProviderInvocation,
    execute: RepositoryProviderExecutor
): Promise<AddonSource[]> {
    const selected = modules.slice(0, 20);
    const sources: AddonSource[] = [];

    for (let index = 0; index < selected.length; index += 4) {
        const batch = await Promise.all(
            selected.slice(index, index + 4).map(async (module) => {
                try {
                    const result = await execute(module.source, invocation);
                    return parseRepositoryProviderStreams(
                        result,
                        module.repositoryId,
                        module.providerId,
                        module.providerName
                    );
                } catch {
                    // A broken provider must not prevent other repositories from
                    // returning usable streams.
                    return [];
                }
            })
        );
        sources.push(...batch.flat());
        if (sources.length >= 100) return sources.slice(0, 100);
    }

    return sources;
}
