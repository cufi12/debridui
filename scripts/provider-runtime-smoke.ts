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
