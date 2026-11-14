import { readFile } from "node:fs/promises";
import { sanitizeStreamHeaders } from "../src/lib/addons/parser";
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

const sanitizedHeaders = sanitizeStreamHeaders({
    Referer: "https://provider.example/watch/film",
    Origin: "https://provider.example",
    "User-Agent": "Mozilla/5.0",
    Accept: "video/mp4",
    "X-Unsafe": "line\\nbreak",
});
if (
    sanitizedHeaders?.Referer !== "https://provider.example/watch/film" ||
    sanitizedHeaders.Origin !== "https://provider.example" ||
    sanitizedHeaders["User-Agent"] !== "Mozilla/5.0" ||
    sanitizedHeaders.Accept !== "video/mp4" ||
    Object.keys(sanitizedHeaders).length !== 4
) {
    throw new Error("Provider header sanitization smoke test failed.");
}
if (sanitizeStreamHeaders({ Referer: "https://provider.example/\\r\\nInjected: yes" }) !== undefined) {
    throw new Error("Provider header control-character validation smoke test failed.");
}
console.log("Provider header sanitization smoke test passed.");

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

const compatibilityResult = await executeNuvioProvider(
    `var cheerio = require("cheerio");
    var CryptoJS = require("crypto-js");
    module.exports = {
        getStreams: async () => {
            var html = cheerio.load('<div class="result"><a class="play" href="https://cdn.example/video.mp4">Play Film</a><a href="https://cdn.example/second.mp4">Second</a></div>');
            var links = html(".result").find("a.play").toArray().map((element) => html(element));
            var first = html(".result a").first();
            var second = html(".result a").eq(1);
            var visited = [];
            html(".result a").each((index, element) => visited.push(html(element).text().trim()));
            var key = CryptoJS.enc.Utf8.parse("kiemtienmua911ca");
            var iv = CryptoJS.enc.Utf8.parse("0123456789abcdef");
            var decoded = CryptoJS.AES.decrypt(
                CryptoJS.lib.CipherParams.create({
                    ciphertext: CryptoJS.enc.Hex.parse("7c9ecfa61621c67c3c303f993096a16fa2549279236cbeb59b67299f4b5a52c6")
                }),
                key,
                { iv: iv, mode: CryptoJS.mode.CBC, padding: CryptoJS.pad.Pkcs7 }
            ).toString(CryptoJS.enc.Latin1);
            return [{
                name: links[0].text().trim() + "|" + first.text().trim() + "|" + second.attr("href") + "|" + visited.join(","),
                url: links[0].attr("href"),
                title: decoded
            }];
        }
    };`,
    { tmdbId: 12345, mediaType: "movie" }
);
const compatibilityStream = Array.isArray(compatibilityResult)
    ? (compatibilityResult[0] as { name?: string; url?: string; title?: string })
    : undefined;
if (
    compatibilityStream?.name !== "Play Film|Play Film|https://cdn.example/second.mp4|Play Film,Second" ||
    compatibilityStream.url !== "https://cdn.example/video.mp4" ||
    compatibilityStream.title !== "decoded-provider-url"
) {
    throw new Error("QuickJS Cheerio/CryptoJS compatibility smoke test failed.");
}
console.log("QuickJS Cheerio/CryptoJS compatibility smoke test passed.");

// These upstream bundles are pinned to invalidpandaa/nuvio-german-providers@1114046a836741728ab33d4bb90a2bd1833fbf99.
// Override getStreams after module initialization so the test exercises their real top-level imports
// without making requests to third-party streaming sites.
for (const providerFile of ["flixitv.fixture", "serienstream.fixture", "aniworld.fixture"]) {
    const providerSource = await readFile(
        new URL("./fixtures/nuvio-german-providers/" + providerFile, import.meta.url),
        "utf8"
    );
    const loadedProvider = await executeNuvioProvider(
        providerSource + "\nmodule.exports.getStreams = async () => [];",
        { tmdbId: 12345, mediaType: "movie" }
    );
    if (!Array.isArray(loadedProvider) || loadedProvider.length !== 0) {
        throw new Error("German Nuvio provider module-load smoke test failed: " + providerFile);
    }
    console.log("German Nuvio provider module-load smoke test passed: " + providerFile);
}

let unsupportedModuleBlocked = false;
try {
    await executeNuvioProvider('var fs = require("fs"); module.exports = { getStreams: async () => [] };', {
        tmdbId: 12345,
        mediaType: "movie",
    });
} catch (error) {
    unsupportedModuleBlocked =
        error instanceof Error && error.message.includes('Provider module "fs" is not supported.');
}
if (!unsupportedModuleBlocked) throw new Error("QuickJS unsupported CommonJS module restriction smoke test failed.");
console.log("QuickJS unsupported CommonJS module restriction smoke test passed.");
