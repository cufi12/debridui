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
                await fetch("http://127.0.0.1/");
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
