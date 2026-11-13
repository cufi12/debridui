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
    if (!invocation) return [];

    const modules = await getEnabledRepositoryProviderSources(invocation.mediaType);
    const enabled = modules
        .filter((module): module is typeof module & { source: string } => Boolean(module.source))
        .slice(0, 8);
    const sources: AddonSource[] = [];

    for (let index = 0; index < enabled.length; index += 4) {
        const batch = await Promise.all(
            enabled.slice(index, index + 4).map(async (module) => {
                try {
                    const result = await executeNuvioProvider(module.source, invocation);
                    return parseRepositoryProviderStreams(
                        result,
                        module.repositoryId,
                        module.providerId,
                        module.providerName
                    );
                } catch (error) {
                    console.warn(`Repository provider ${module.providerId} failed:`, error);
                    return [];
                }
            })
        );
        sources.push(...batch.flat());
        if (sources.length >= 100) return sources.slice(0, 100);
    }

    return sources;
}
