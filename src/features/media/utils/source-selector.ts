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

export function selectBestSource(sources: AddonSource[], settings: StreamingSettings): SelectionResult {
    const range = getActiveRange(settings);

    // Filter sources that match preferences
    const matchingSources = sources.filter(
        (source) =>
            source.url && // Must have a playable URL
            matchesResolutionRange(source, range) &&
            matchesSourceQualityRange(source, range)
    );

    // Prefer audio language in this order: German, English, Italian.
    // Addon metadata is best-effort; untagged streams remain available as fallback.
    const getLanguagePriority = (source: AddonSource): number => {
        const metadata = `${source.title} ${source.description || ""}`;
        if (/(?:\\bGER(?:MAN)?\\b|\\bDEUTSCH(?:E|ER|ES)?\\b|\\bDEU\\b|\\bAUDIO\\s*[:=]?\\s*DE\\b)/i.test(metadata)) return 0;
        if (/(?:\\bENG(?:LISH)?\\b|\\bAUDIO\\s*[:=]?\\s*EN\\b)/i.test(metadata)) return 1;
        if (/(?:\\bITA(?:LIAN)?\\b|\\bITALIANO\\b|\\bAUDIO\\s*[:=]?\\s*IT\\b)/i.test(metadata)) return 2;
        return 3;
    };

    const sortByPriority = (a: AddonSource, b: AddonSource) => {
        const languageDiff = getLanguagePriority(a) - getLanguagePriority(b);
        if (languageDiff !== 0) return languageDiff;

        // Within the same language, prefer cached sources, then resolution and source quality.
        const cacheDiff = Number(Boolean(b.isCached)) - Number(Boolean(a.isCached));
        if (cacheDiff !== 0) return cacheDiff;

        const resolutionDiff = getResolutionIndex(a.resolution) - getResolutionIndex(b.resolution);
        if (resolutionDiff !== 0) return resolutionDiff;

        return getSourceQualityIndex(a.quality) - getSourceQualityIndex(b.quality);
    };

    const sortedMatches = [...matchingSources].sort(sortByPriority);
    const cachedMatches = sortedMatches.filter((s) => s.isCached);
    const uncachedMatches = sortedMatches.filter((s) => !s.isCached);

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
