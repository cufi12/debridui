export type IPTVChannel = {
    id: string;
    name: string;
    url: string;
    group: string;
    logo?: string;
    tvgId?: string;
};

export function parseM3U(source: string): IPTVChannel[] {
    const lines = source.replace(/^\uFEFF/, "").split(/\r?\n/);
    const channels: IPTVChannel[] = [];
    let metadata = "";
    for (const raw of lines) {
        const line = raw.trim();
        if (!line) continue;
        if (line.startsWith("#EXTINF")) {
            metadata = line;
            continue;
        }
        if (line.startsWith("#") || !/^https?:\/\//i.test(line)) continue;
        const name = metadata.match(/,(.*)$/)?.[1]?.trim() || new URL(line).hostname;
        const attr = (key: string) => metadata.match(new RegExp(key + '="([^"]*)"', "i"))?.[1];
        channels.push({
            id: attr("tvg-id") || line,
            name,
            url: line,
            group: attr("group-title") || "Weitere Sender",
            logo: attr("tvg-logo"),
            tvgId: attr("tvg-id"),
        });
        metadata = "";
    }
    return channels;
}
