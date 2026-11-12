export type XMLTVProgram = {
    channelId: string;
    title: string;
    description?: string;
    start: number;
    stop: number;
};

function parseXmltvDate(value: string | null): number {
    if (!value) return 0;
    const match = value.match(/^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})(?:\s*([+-])(\d{2})(\d{2}))?/);
    if (!match) return Date.parse(value) || 0;
    const [, y, mo, d, h, mi, s, sign, oh, om] = match;
    const utc = Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(s));
    const offset = sign ? (Number(oh) * 60 + Number(om)) * 60_000 * (sign === "+" ? 1 : -1) : 0;
    return utc - offset;
}

export function parseXMLTV(source: string): XMLTVProgram[] {
    const document = new DOMParser().parseFromString(source, "application/xml");
    if (document.querySelector("parsererror")) throw new Error("Die XMLTV-Datei ist ungültig.");
    return Array.from(document.querySelectorAll("programme")).map((node) => {
        const title = node.querySelector("title")?.textContent?.trim() || "";
        return {
            channelId: node.getAttribute("channel") || "",
            title,
            description: node.querySelector("desc")?.textContent?.trim() || undefined,
            start: parseXmltvDate(node.getAttribute("start")),
            stop: parseXmltvDate(node.getAttribute("stop")),
        };
    }).filter((program) => program.channelId && program.title && program.start && program.stop);
}
