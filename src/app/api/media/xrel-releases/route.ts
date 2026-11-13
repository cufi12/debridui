import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const RELEASE_API_HOSTS = ["https://api.xrel.to", "https://api-alternate.xrel.top"];
const GERMAN_RELEASE = /(?:GERMAN|GER|DEUTSCH|\\bDE\\b|\\bDL\\b)/i;

interface XrelRelease {
    dirname?: string;
    audio_type?: string;
    video_type?: string;
    ext_info?: { title?: string };
}
interface XrelSearchResponse {
    results?: XrelRelease[];
    p2p_results?: XrelRelease[];
}

export async function GET(request: NextRequest) {
    const title = request.nextUrl.searchParams.get("title")?.trim().slice(0, 160) || "";
    const type = request.nextUrl.searchParams.get("type") === "show" ? "show" : "movie";
    if (title.length < 2) return NextResponse.json({ releases: [] });

    const query = type === "show" ? title.replace(/\\s+S\\d{1,2}E\\d{1,2}.*$/i, "") : title;
    const params = new URLSearchParams({ q: query, scene: "true", p2p: "true", limit: "25" });
    let lastStatus = 0;

    for (const host of RELEASE_API_HOSTS) {
        try {
            const response = await fetch(`${host}/v2/search/releases.json?${params.toString()}`, {
                headers: { Accept: "application/json", "User-Agent": "DebridUI/1.0" },
                next: { revalidate: 21600 },
                signal: AbortSignal.timeout(7000),
            });
            lastStatus = response.status;
            if (!response.ok) continue;
            const data = (await response.json()) as XrelSearchResponse;
            const releases = [...(data.results || []), ...(data.p2p_results || [])]
                .filter((item) => typeof item.dirname === "string" && GERMAN_RELEASE.test(item.dirname))
                .map((item) => item.dirname as string)
                .slice(0, 20);
            return NextResponse.json({ releases }, { headers: { "Cache-Control": "public, s-maxage=21600, stale-while-revalidate=86400" } });
        } catch {
            // Try the documented alternate API host if the primary is unavailable.
        }
    }

    return NextResponse.json({ releases: [], unavailable: true, status: lastStatus }, { status: 200 });
}
