import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { and, eq } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db/drizzle";
import { userAccounts } from "@/lib/db/schema";
import { AccountType } from "@/lib/schemas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const execFileAsync = promisify(execFile);
const REAL_DEBRID_API = "https://api.real-debrid.com/rest/1.0";
const VIDEO_EXTENSIONS = /\.(mkv|mp4|m4v|avi|mov|webm|ts|m2ts)$/i;
const HASH_PATTERN = /^[a-f0-9]{40}$/i;

interface TorrentListItem {
    id: string;
    hash: string;
    status: string;
}

interface TorrentInfo extends TorrentListItem {
    filename: string;
    files: Array<{ id: number; path: string; bytes: number; selected: 0 | 1 }>;
    links: string[];
}

interface UnrestrictedLink {
    download: string;
    filename: string;
}

interface ProbeResult {
    streams?: Array<{
        index: number;
        codec_type?: string;
        codec_name?: string;
        tags?: { language?: string; title?: string };
    }>;
}

async function rdRequest<T>(path: string, token: string, init: RequestInit = {}): Promise<T> {
    const response = await fetch(`${REAL_DEBRID_API}${path}`, {
        ...init,
        headers: {
            Authorization: `Bearer ${token}`,
            ...(init.headers || {}),
        },
        cache: "no-store",
        signal: AbortSignal.timeout(20000),
    });

    if (!response.ok) {
        throw new Error(response.status === 404 ? "Datei bei Real-Debrid nicht gefunden." : `Real-Debrid antwortete mit HTTP ${response.status}.`);
    }
    return response.json() as Promise<T>;
}

export async function POST(request: NextRequest) {
    const session = await auth.api.getSession({ headers: request.headers });
    if (!session) {
        return NextResponse.json({ error: "Anmeldung erforderlich." }, { status: 401 });
    }

    let body: { accountId?: string; hash?: string; fileIndex?: number };
    try {
        body = await request.json();
    } catch {
        return NextResponse.json({ error: "Ungültige Anfrage." }, { status: 400 });
    }

    const accountId = typeof body.accountId === "string" ? body.accountId : "";
    const hash = typeof body.hash === "string" ? body.hash.toLowerCase() : "";
    const fileIndex = body.fileIndex;

    if (!/^[0-9a-f-]{36}$/i.test(accountId) || !HASH_PATTERN.test(hash)) {
        return NextResponse.json({ error: "Konto oder Torrent-Hash ist ungültig." }, { status: 400 });
    }
    if (fileIndex !== undefined && (!Number.isInteger(fileIndex) || fileIndex < 0 || fileIndex > 500)) {
        return NextResponse.json({ error: "Dateiindex ist ungültig." }, { status: 400 });
    }

    const [account] = await db
        .select({ apiKey: userAccounts.apiKey })
        .from(userAccounts)
        .where(and(
            eq(userAccounts.id, accountId),
            eq(userAccounts.userId, session.user.id),
            eq(userAccounts.type, AccountType.REALDEBRID)
        ))
        .limit(1);

    if (!account) {
        return NextResponse.json({ error: "Real-Debrid-Konto nicht gefunden." }, { status: 404 });
    }

    try {
        const torrents = await rdRequest<TorrentListItem[]>("/torrents?limit=100&page=1", account.apiKey);
        const torrent = torrents.find((item) => item.hash?.toLowerCase() === hash);
        if (!torrent) {
            return NextResponse.json({ error: "Dieser Torrent liegt nicht in deinem Real-Debrid-Konto." }, { status: 404 });
        }
        if (torrent.status !== "downloaded") {
            return NextResponse.json({ error: "Die Datei ist bei Real-Debrid noch nicht vollständig verfügbar." }, { status: 409 });
        }

        const info = await rdRequest<TorrentInfo>(`/torrents/info/${encodeURIComponent(torrent.id)}`, account.apiKey);
        const selectedFiles = info.files.filter((file) => file.selected === 1);
        const candidateFiles = selectedFiles.filter((file) => VIDEO_EXTENSIONS.test(file.path));
        const chosenIndex = fileIndex ?? 0;
        const chosenFile = candidateFiles[chosenIndex];

        if (!chosenFile) {
            return NextResponse.json({ error: "Keine passende Videodatei gefunden." }, { status: 404 });
        }

        const selectedIndex = selectedFiles.findIndex((file) => file.id === chosenFile.id);
        let linkIndex = selectedIndex;
        if (info.links.length === 1) linkIndex = 0;
        if (linkIndex < 0 || linkIndex >= info.links.length) {
            return NextResponse.json({ error: "Real-Debrid konnte die Videodatei nicht eindeutig zuordnen." }, { status: 409 });
        }

        const form = new URLSearchParams({ link: info.links[linkIndex] });
        const unrestricted = await rdRequest<UnrestrictedLink>("/unrestrict/link", account.apiKey, {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: form.toString(),
        });

        // The signed download URL stays on the server and is never returned to the browser.
        const ffprobePath = require("ffprobe-static") as string;
        const { stdout } = await execFileAsync(ffprobePath, [
            "-v", "error",
            "-show_entries", "stream=index,codec_type,codec_name:stream_tags=language,title",
            "-of", "json",
            unrestricted.download,
        ], { timeout: 30000, maxBuffer: 1024 * 1024 });

        const probe = JSON.parse(stdout) as ProbeResult;
        const audioTracks = (probe.streams || [])
            .filter((stream) => stream.codec_type === "audio")
            .map((stream) => ({
                index: stream.index,
                codec: stream.codec_name || "unbekannt",
                language: stream.tags?.language || null,
                title: stream.tags?.title || null,
            }));

        return NextResponse.json({
            verified: true,
            fileName: chosenFile.path.split("/").pop() || unrestricted.filename,
            audioTracks,
        }, { headers: { "Cache-Control": "no-store" } });
    } catch (error) {
        const message = error instanceof Error && error.message.includes("ffprobe-static")
            ? "Der Medien-Analyzer ist auf dem Server nicht installiert."
            : error instanceof Error && error.name === "TimeoutError"
                ? "Die Tonspur-Prüfung hat zu lange gedauert."
                : error instanceof Error
                    ? error.message
                    : "Tonspur-Prüfung fehlgeschlagen.";
        return NextResponse.json({ error: message }, { status: 502 });
    }
}
