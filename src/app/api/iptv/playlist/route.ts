const PLAYLIST_SOURCES = [
    { country: "Deutschland", code: "de" },
    { country: "Schweiz", code: "ch" },
    { country: "Österreich", code: "at" },
    { country: "Albanien / Kosovo", code: "al" },
    { country: "Albanien / Kosovo", code: "xk" },
    { country: "Albanien / Kosovo", code: "xk" },
    { country: "Türkei", code: "tr" },
] as const;

export const runtime = "nodejs";
export const revalidate = 21600;

function assignGroup(metadata: string, group: string): string {
    const safeGroup = group.replace(/["\r\n]/g, " ");
    if (/\bgroup-title="/i.test(metadata)) {
        return metadata.replace(/\bgroup-title="[^"]*"/i, `group-title="${safeGroup}"`);
    }
    return metadata.replace(/^#EXTINF:([^ ]*)/, `#EXTINF:$1 group-title="${safeGroup}"`);
}

export async function GET() {
    const sections = await Promise.all(
        PLAYLIST_SOURCES.map(async ({ country, code }) => {
            const response = await fetch(`https://iptv-org.github.io/iptv/countries/${code}.m3u`, {
                headers: { Accept: "application/x-mpegURL, text/plain;q=0.9, */*;q=0.8" },
                next: { revalidate: 21600 },
                signal: AbortSignal.timeout(20000),
            });
            if (!response.ok) {
                throw new Error(`Playlist-Quelle ${code.toUpperCase()} antwortet mit HTTP ${response.status}.`);
            }
            const source = await response.text();
            if (source.length > 8 * 1024 * 1024) {
                throw new Error(`Playlist-Quelle ${code.toUpperCase()} ist zu gross.`);
            }
            const lines = source.replace(/^\uFEFF/, "").split(/\r?\n/);
            const output: string[] = [];
            let metadata = "";
            for (const raw of lines) {
                const line = raw.trim();
                if (!line) continue;
                if (line.startsWith("#EXTM3U")) {
                    if (!output.length) output.push("#EXTM3U");
                    continue;
                }
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
            return output.slice(output[0] === "#EXTM3U" ? 1 : 0);
        })
    );

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
        },
    });
}
