import { executeNuvioProvider } from "../src/lib/plugins/provider-runtime";

const result = await executeNuvioProvider(
    `module.exports = {
        getStreams: async (tmdbId, mediaType) => [{
            name: "QuickJS smoke test",
            url: "https://example.com/test.mp4",
            title: String(tmdbId) + ":" + mediaType
        }]
    };`,
    { tmdbId: 12345, mediaType: "movie" }
);

if (!Array.isArray(result) || result.length !== 1) {
    throw new Error("QuickJS provider smoke test returned an unexpected result.");
}

const stream = result[0] as { url?: string; title?: string };
if (stream.url !== "https://example.com/test.mp4" || stream.title !== "12345:movie") {
    throw new Error("QuickJS provider smoke test returned invalid stream data.");
}

console.log("QuickJS provider runtime smoke test passed.");

const blockedFetchResult = await executeNuvioProvider(
    `module.exports = {
        getStreams: async () => {
            try {
                await fetch(new URL("http://127.0.0.1/"));
                return [];
            } catch {
                return [{ name: "Blocked private network", url: "https://example.com/blocked.mp4" }];
            }
        }
    };`,
    { tmdbId: 12345, mediaType: "movie" }
);

if (!Array.isArray(blockedFetchResult) || blockedFetchResult.length !== 1) {
    throw new Error("QuickJS provider network restriction smoke test failed.");
}
console.log("QuickJS provider network restriction smoke test passed.");

const urlResult = await executeNuvioProvider(
    `module.exports = {
        getStreams: async () => {
            const url = new URL("https://example.com/watch?tmdb=123");
            url.searchParams.set("language", "de");
            return [{ name: url.searchParams.get("tmdb"), url: url.toString() }];
        }
    };`,
    { tmdbId: 12345, mediaType: "movie" }
);

if (!Array.isArray(urlResult) || urlResult.length !== 1) {
    throw new Error("QuickJS URL compatibility smoke test failed.");
}
const urlStream = urlResult[0] as { url?: string; name?: string };
if (urlStream.url !== "https://example.com/watch?tmdb=123&language=de" || urlStream.name !== "123") {
    throw new Error("QuickJS URL compatibility returned invalid values.");
}
console.log("QuickJS URL compatibility smoke test passed.");

const tmdbMetadataResult = await executeNuvioProvider(
    `module.exports = {
        getStreams: async (tmdbId, mediaType) => {
            const response = await fetch("https://api.themoviedb.org/3/movie/" + tmdbId + "?api_key=" + globalThis.TMDB_API_KEY + "&language=de-DE&append_to_response=external_ids,translations,alternative_titles");
            const metadata = await response.json();
            return [{ name: metadata.title, url: "https://example.com/metadata.mp4", title: String(metadata.id) + ":" + metadata.release_date + ":" + metadata.external_ids.imdb_id }];
        }
    };`,
    { tmdbId: 42, mediaType: "movie", title: "Beispiel Film", year: 2024, imdbId: "tt1234567" }
);
const metadataStream = Array.isArray(tmdbMetadataResult)
    ? (tmdbMetadataResult[0] as { name?: string; title?: string })
    : undefined;
if (metadataStream?.name !== "Beispiel Film" || metadataStream.title !== "42:2024-01-01:tt1234567") {
    throw new Error("QuickJS local TMDB metadata compatibility smoke test failed.");
}
console.log("QuickJS local TMDB metadata compatibility smoke test passed.");

const blockedTmdbResult = await executeNuvioProvider(
    `module.exports = {
        getStreams: async () => {
            try {
                await fetch("https://api.themoviedb.org/3/movie/999?api_key=" + globalThis.TMDB_API_KEY);
                return [];
            } catch {
                return [{ name: "Blocked unrelated TMDB ID", url: "https://example.com/blocked.mp4" }];
            }
        }
    };`,
    { tmdbId: 42, mediaType: "movie", title: "Beispiel Film", year: 2024 }
);
if (!Array.isArray(blockedTmdbResult) || blockedTmdbResult.length !== 1) {
    throw new Error("QuickJS TMDB scope restriction smoke test failed.");
}
console.log("QuickJS TMDB scope restriction smoke test passed.");
