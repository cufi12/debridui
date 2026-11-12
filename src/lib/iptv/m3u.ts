export type IPTVChannel = {
    id: string;
    name: string;
    url: string;
    group: string;
    logo?: string;
    tvgId?: string;
};

export function parseM3U(source: string): IPTVChannel[] {
    const lines = source.replace(/^\\uFEFF/, "").split(/\\r?\\n/);
    const channels: IPTVChannel[] = [];
    let metadata = "";
    let explicitGroup = "";

    for (const raw of lines) {
        const line = raw.trim();
        if (!line) continue;
        if (line.startsWith("#EXTINF")) {
            metadata = line;
            explicitGroup = "";
            continue;
        }
        if (line.startsWith("#EXTGRP:")) {
            explicitGroup = line.slice(8).trim();
            continue;
        }
        if (line.startsWith("#") || !/^https?:\\/\\//i.test(line)) continue;

        const name = metadata.match(/,(.*)$/)?.[1]?.trim() || new URL(line).hostname;
        const attr = (key: string) => metadata.match(new RegExp("(?:^|\\\\s)" + key + '="([^"]*)"', "i"))?.[1];
        const group = attr("group-title") || attr("tvg-group") || explicitGroup || "Weitere Sender";
        channels.push({
            id: attr("tvg-id") || line,
            name,
            url: line,
            group,
            logo: attr("tvg-logo"),
            tvgId: attr("tvg-id"),
        });
        metadata = "";
        explicitGroup = "";
    }
    return channels;
}
