import { parseStreams, sanitizeStreamHeaders } from "@/lib/addons/parser";
import type { AddonSource, AddonStream, TvSearchParams } from "@/lib/addons/types";
import type { Media } from "@/lib/trakt";

/** Check a repository provider's declared media compatibility. */
export function providerSupportsMediaType(
    supportedTypes: readonly string[],
    mediaType: "movie" | "tv"
): boolean {
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
export function normalizeProviderStreams(
    result: unknown,
    providerId: string,
    providerName: string
): AddonStream[] {
    const candidate = Array.isArray(result)
        ? result
        : isRecord(result) && Array.isArray(result.streams)
          ? result.streams
          : [];

    return candidate.slice(0, 100).flatMap((item): AddonStream[] => {
        if (!isRecord(item)) return [];
        const rawUrl = typeof item.url === "string" ? item.url : typeof item.link === "string" ? item.link : "";
        let parsedUrl: URL;
        try {
            parsedUrl = new URL(rawUrl);
        } catch {
            return [];
        }
        if (parsedUrl.protocol !== "https:" && parsedUrl.protocol !== "http:") return [];

        const name = typeof item.name === "string" ? item.name.slice(0, 300) : providerName;
        const title = typeof item.title === "string" ? item.title.slice(0, 500) : undefined;
        const description = typeof item.description === "string"
            ? item.description.slice(0, 2000)
            : typeof item.quality === "string" ? item.quality.slice(0, 100) : undefined;

        return [{
            name: name || providerName,
            title,
            description: description ? `[${providerId}] ${description}` : `Provider: ${providerName}`,
            url: parsedUrl.toString(),
            headers: sanitizeStreamHeaders(item.headers),
        }];
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
