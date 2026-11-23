import { getResolutionIndex, getSourceQualityIndex } from "@/lib/addons/parser";
import type { AddonSource } from "@/lib/addons/types";
import { getActiveRange, type QualityRange, type StreamingSettings } from "@/stores/settings";

function matchesResolutionRange(source: AddonSource, range: QualityRange): boolean {
    if (!source.resolution) return true; // Unknown resolution passes

    const sourceIndex = getResolutionIndex(source.resolution);
    // Lower index = better resolution
    const minIndex = range.maxResolution === "any" ? 0 : getResolutionIndex(range.maxResolution);
    const maxIndex = range.minResolution === "any" ? Infinity : getResolutionIndex(range.minResolution);

    return sourceIndex >= minIndex && sourceIndex <= maxIndex;
}

function matchesSourceQualityRange(source: AddonSource, range: QualityRange): boolean {
    if (!source.quality) return true; // Unknown quality passes

    const sourceIndex = getSourceQualityIndex(source.quality);
    // Lower index = better quality
    const minIndex = range.maxSourceQuality === "any" ? 0 : getSourceQualityIndex(range.maxSourceQuality);
    const maxIndex = range.minSourceQuality === "any" ? Infinity : getSourceQualityIndex(range.minSourceQuality);

    return sourceIndex >= minIndex && sourceIndex <= maxIndex;
}

export interface SelectionResult {
    source: AddonSource | null;
    isCached: boolean;
    hasMatches: boolean;
    cachedMatches: AddonSource[];
    uncachedMatches: AddonSource[];
}

export function selectBestSource(
    sources: AddonSource[],
    settings: StreamingSettings,
    _germanReleaseNames: string[] = []
): SelectionResult {
    const range = getActiveRange(settings);

    // Only consider sources that positively indicate German audio. Unknown-language
    // and explicitly non-German releases must never be used as an automatic fallback.
    const normalizeReleaseName = (value: string) =>
        value.toLowerCase().replace(/[^a-z0-9]+/g, "");

    const germanNames = _germanReleaseNames.map(normalizeReleaseName).filter((name) => name.length >= 8);
    const hasGermanAudio = (source: AddonSource): boolean => {
        const metadata = `${source.title} ${source.description || ""}`;
        const germanTag =
            /(?:^|[^A-Z0-9])(?:GER|GERMAN|DEU|DEUTSCH(?:E|ER|ES)?|DE)(?=$|[^A-Z0-9])|🇩🇪|AUDIO\\s*[:=]?\\s*DE\\b/i.test(
                metadata
            );
        if (germanTag) return true;

        const normalizedMetadata = normalizeReleaseName(metadata);
        return germanNames.some((name) => normalizedMetadata.includes(name));
    };

    // Apply the language requirement before cache and quality fallback logic.
    const germanSources = sources.filter((source) => source.url && hasGermanAudio(source));
    const matchingSources = germanSources.filter(
        (source) => matchesResolutionRange(source, range) && matchesSourceQualityRange(source, range)
    );

    // If none of those sources is cached, fall back to any cached playable source.
    // This allows a cached 720p release to beat an uncached 1080p release instead
    // of showing "Not cached" when a lower-resolution cached option exists.
    const cachedPreferred = matchingSources.some((source) => source.isCached)
        ? matchingSources.filter((source) => source.isCached)
        : sources.filter((source) => source.url && source.isCached);
    const candidates = cachedPreferred.length > 0 ? cachedPreferred : matchingSources;

    // Rank only a single, unambiguous language indication.
    const getLanguagePriority = (source: AddonSource): number => {
        const metadata = source.title + " " + (source.description || "");
        const flags = [
            /(?:^|[^A-Z0-9])(?:GER|GERMAN|DEU|DEUTSCH(?:E|ER|ES)?|DE)(?=$|[^A-Z0-9])|🇩🇪|AUDIO\s*[:=]?\s*DE\b/i.test(
                metadata
            ),
            /(?:^|[^A-Z0-9])(?:ENG|ENGLISH|EN)(?=$|[^A-Z0-9])|🇬🇧|🇺🇸|AUDIO\s*[:=]?\s*EN\b/i.test(metadata),
            /(?:^|[^A-Z0-9])(?:SPA|SPANISH|ESPANOL|ESPAÑOL|CASTELLANO|ESP)(?=$|[^A-Z0-9])|🇪🇸|AUDIO\s*[:=]?\s*ES\b/i.test(
                metadata
            ),
            /(?:^|[^A-Z0-9])(?:ITA|ITALIAN|ITALIANO|IT)(?=$|[^A-Z0-9])|🇮🇹|AUDIO\s*[:=]?\s*IT\b/i.test(metadata),
        ];
        if (flags.filter(Boolean).length !== 1) return 2;
        if (flags[0]) return 0;
        if (flags[1]) return 1;
        if (flags[2]) return 3;
        return 4;
    };

    const sortByPriority = (a: AddonSource, b: AddonSource) => {
        const languageDiff = getLanguagePriority(a) - getLanguagePriority(b);
        if (languageDiff !== 0) return languageDiff;

        const resolutionDiff = getResolutionIndex(a.resolution) - getResolutionIndex(b.resolution);
        if (resolutionDiff !== 0) return resolutionDiff;

        return getSourceQualityIndex(a.quality) - getSourceQualityIndex(b.quality);
    };

    const sortedMatches = [...candidates].sort(sortByPriority);
    const cachedMatches = sortedMatches.filter((source) => source.isCached);
    const uncachedMatches = sortedMatches.filter((source) => !source.isCached);

    if (sortedMatches.length > 0) {
        return {
            source: sortedMatches[0],
            isCached: Boolean(sortedMatches[0].isCached),
            hasMatches: true,
            cachedMatches,
            uncachedMatches,
        };
    }

    return {
        source: null,
        isCached: false,
        hasMatches: false,
        cachedMatches: [],
        uncachedMatches: [],
    };
}
