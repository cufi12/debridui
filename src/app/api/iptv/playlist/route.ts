// Public country M3U files from IPTV-org. Each country code is a separate source:
// "al" is Albania and "xk" is Kosovo; both intentionally share one DebridUI group.
const PLAYLIST_SOURCES = [
    { country: "Deutschland", code: "de" },
    { country: "Schweiz", code: "ch" },
    { country: "Österreich", code: "at" },
    { country: "Albanien / Kosovo", code: "al" },
    { country: "Albanien / Kosovo", code: "xk" },
    { country: "Türkei", code: "tr" },
] as const;

export const runtime = "nodejs";
export const revalidate = 21600;

function assignGroup(metadata: string, group: string): string {
    const safeGroup = group.replace(/["\r\n]/g, " ");
    if (/\bgroup-title="/i.test(metadata)) {
        return metadata.replace(/\bgroup-title="[^"]*"/i, 'group-title="' + safeGroup + '"');
    }
    return metadata.replace(/^#EXTINF:([^ ]*)/, '#EXTINF:$1 group-title="' + safeGroup + '"');
}

async function fetchCountryPlaylist(country: string, code: string): Promise<string[]> {
    const response = await fetch("https://iptv-org.github.io/iptv/countries/" + code + ".m3u", {
        headers: { Accept: "application/x-mpegURL, text/plain;q=0.9, */*;q=0.8" },
        next: { revalidate: 21600 },
        signal: AbortSignal.timeout(20000),
    });
    if (!response.ok) {
        throw new Error("HTTP " + response.status);
    }

    const source = await response.text();
    if (source.length > 8 * 1024 * 1024) {
        throw new Error("Source exceeds 8 MB");
    }

    const lines = source.replace(/^\uFEFF/, "").split(/\r?\n/);
    const output: string[] = [];
    let metadata = "";

    for (const raw of lines) {
        const line = raw.trim();
        if (!line) continue;
        if (line.startsWith("#EXTM3U")) continue;
        if (line.startsWith("#EXTINF:")) {
            metadata = assignGroup(line, country);
            continue;
        }
        if (line.startsWith("#")) {
            if (metadata) output.push(line);
            continue;
        }
        if (/^https?:\/\//i.test(line) && metadata) {
            output.push(metadata, line);
        }
        metadata = "";
    }

    return output;
}

export async function GET() {
    const results = await Promise.allSettled(
        PLAYLIST_SOURCES.map(({ country, code }) => fetchCountryPlaylist(country, code))
    );

    const sections: string[][] = [];
    const failedSources: string[] = [];
    results.forEach((result, index) => {
        if (result.status === "fulfilled") {
            sections.push(result.value);
        } else {
            const code = PLAYLIST_SOURCES[index].code;
            failedSources.push(code);
            console.warn("IPTV playlist source " + code.toUpperCase() + " could not be loaded.");
        }
    });

    const entryCount = sections.reduce((total, section) => total + section.length, 0);
    if (entryCount === 0) {
        return Response.json(
            { error: "Keine Länder-Playlist konnte geladen werden. Bitte später erneut versuchen." },
            { status: 503 }
        );
    }

    const playlist = ["#EXTM3U", ...sections.flat()].join("\n") + "\n";
    if (Buffer.byteLength(playlist, "utf8") > 20 * 1024 * 1024) {
        return Response.json({ error: "Die zusammengeführte Playlist ist grösser als 20 MB." }, { status: 413 });
    }

    return new Response(playlist, {
        headers: {
            "Content-Type": "audio/x-mpegurl; charset=utf-8",
            "Content-Disposition": 'inline; filename="debridui-countries.m3u"',
            "Cache-Control": "public, s-maxage=21600, stale-while-revalidate=3600",
            "X-Content-Type-Options": "nosniff",
            "X-IPTV-Sources-Loaded": String(PLAYLIST_SOURCES.length - failedSources.length),
            "X-IPTV-Sources-Failed": String(failedSources.length),
        },
    });
}
