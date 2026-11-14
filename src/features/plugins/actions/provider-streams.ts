"use server";

import { getEnabledRepositoryProviderSources } from "@/features/plugins/actions/repositories";
import type { AddonSource, TvSearchParams } from "@/lib/addons/types";
import { createProviderInvocation, parseRepositoryProviderStreams } from "@/lib/plugins/provider-adapter";
import { executeNuvioProvider } from "@/lib/plugins/provider-runtime";
import type { Media } from "@/lib/trakt";

/** Execute enabled repository providers and return their normalized stream sources. */
export async function getRepositoryProviderStreams(
    media: Media,
    type: "movie" | "show",
    tvParams?: TvSearchParams
): Promise<AddonSource[]> {
    const invocation = createProviderInvocation(media, type, tvParams);
    if (!invocation) {
        console.warn(
            "[repository-providers] Search skipped: media metadata is missing a valid TMDB ID or episode parameters."
        );
        return [];
    }

    const startedAt = Date.now();
    const modules = await getEnabledRepositoryProviderSources(invocation.mediaType);
    const enabled = modules
        .filter((module): module is typeof module & { source: string } => Boolean(module.source))
        .slice(0, 100);
    const loadFailures = modules.filter((module) => !module.source);
    console.info("[repository-providers] Search started:", {
        mediaType: invocation.mediaType,
        configuredProviders: modules.length,
        loadedProviders: enabled.length,
        sourceLoadFailures: loadFailures.length,
    });
    const sources: AddonSource[] = [];

    for (let index = 0; index < enabled.length; index += 4) {
        const batch = await Promise.all(
            enabled.slice(index, index + 4).map(async (module) => {
                const providerStartedAt = Date.now();
                try {
                    const result = await executeNuvioProvider(module.source, invocation, module.providerId);
                    const parsed = parseRepositoryProviderStreams(
                        result,
                        module.repositoryId,
                        module.providerId,
                        module.providerName
                    );
                    console.info("[repository-providers] Provider completed:", {
                        providerId: module.providerId,
                        durationMs: Date.now() - providerStartedAt,
                        rawResultType: Array.isArray(result) ? "array" : typeof result,
                        rawResultCount: Array.isArray(result)
                            ? result.length
                            : result &&
                                typeof result === "object" &&
                                "streams" in result &&
                                Array.isArray(result.streams)
                              ? result.streams.length
                              : 0,
                        acceptedSources: parsed.length,
                    });
                    return parsed;
                } catch (error) {
                    console.warn("[repository-providers] Provider execution failed:", {
                        providerId: module.providerId,
                        durationMs: Date.now() - providerStartedAt,
                        error: error instanceof Error ? error.message : String(error),
                    });
                    return [];
                }
            })
        );
        sources.push(...batch.flat());
        if (sources.length >= 100) return sources.slice(0, 100);
    }

    console.info("[repository-providers] Search finished:", {
        executedProviders: enabled.length,
        totalSources: sources.length,
        durationMs: Date.now() - startedAt,
    });
    return sources;
}
