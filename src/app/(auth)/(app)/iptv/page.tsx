"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Hls from "hls.js";
import { get as idbGet, set as idbSet } from "idb-keyval";
import { Heart, Play, RefreshCw, Tv, X, CalendarDays, Maximize } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { parseM3U, type IPTVChannel } from "@/lib/iptv/m3u";
import { parseXMLTV, type XMLTVProgram } from "@/lib/iptv/xmltv";

const STORAGE_KEY = "debridui-iptv-config";
const FAVORITES_KEY = "debridui-iptv-favorites";
const EPG_CACHE_KEY = "debridui-iptv-epg";
const PLAYLIST_CACHE_KEY = "debridui-iptv-playlist";
const EPG_CACHE_TTL = 6 * 60 * 60 * 1000;

type IPTVConfig = { playlistUrl?: string; epgUrl?: string; playerMode?: "auto" | "native" | "external"; externalPlayer?: "vlc" | "mx" | "just" | "kodi"; autoplay?: boolean; startMuted?: boolean };

function getProxiedStreamUrl(url: string): string {
    return `/api/iptv/stream?url=${encodeURIComponent(url)}`;
}

function isHlsStream(url: string): boolean {
    try { return /\.m3u8$/i.test(new URL(url).pathname); } catch { return /\.m3u8(?:$|[?#])/i.test(url); }
}

async function fetchIPTVText(url: string): Promise<string> {
    const response = await fetch(`/api/iptv/proxy?url=${encodeURIComponent(url)}`, {
        method: "GET",
        cache: "no-store",
    });
    if (!response.ok) {
        let message = `IPTV-Abruf fehlgeschlagen (HTTP ${response.status}).`;
        try {
            const data = await response.json() as { error?: string };
            if (data.error) message = data.error;
        } catch {
            // Keep the HTTP status message when the response is not JSON.
        }
        throw new Error(message);
    }
    return await response.text();
}

function getNowNext(channel: IPTVChannel, programs: XMLTVProgram[]) {
    const matching = programs.filter((program) => program.channelId === channel.tvgId).sort((a, b) => a.start - b.start);
    const now = Date.now();
    return {
        current: matching.find((program) => program.start <= now && program.stop > now),
        next: matching.find((program) => program.start > now),
    };
}

export default function IPTVPage() {
    const [playlistUrl, setPlaylistUrl] = useState("");
    const [epgUrl, setEpgUrl] = useState("");
    const [playerAutoplay, setPlayerAutoplay] = useState(true);
    const [playerMuted, setPlayerMuted] = useState(false);
    const [playerMode, setPlayerMode] = useState<"auto" | "native" | "external">("auto");
    const [externalPlayer, setExternalPlayer] = useState<"vlc" | "mx" | "just" | "kodi">("vlc");
    const [playerError, setPlayerError] = useState("");
    const [channels, setChannels] = useState<IPTVChannel[]>([]);
    const [programs, setPrograms] = useState<XMLTVProgram[]>([]);
    const [favorites, setFavorites] = useState<string[]>([]);
    const [selected, setSelected] = useState<IPTVChannel | null>(null);
    const [filter, setFilter] = useState("Alle");
    const [channelSearch, setChannelSearch] = useState("");
    const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({});
    const [loading, setLoading] = useState(false);
    const [epgLoading, setEpgLoading] = useState(false);
    const [error, setError] = useState("");
    const [epgMessage, setEpgMessage] = useState("");
    const [configReady, setConfigReady] = useState(false);
    const autoLoadUrlRef = useRef("");
    const playerContainerRef = useRef<HTMLDivElement>(null);
    const videoRef = useRef<HTMLVideoElement>(null);

    useEffect(() => {
        try {
            const config = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}") as IPTVConfig;
            setPlaylistUrl(config.playlistUrl || "");
            setEpgUrl(config.epgUrl || "");
            setPlayerAutoplay(config.autoplay ?? true);
            setPlayerMuted(config.startMuted ?? false);
            setPlayerMode(config.playerMode === "external" || config.playerMode === "native" ? config.playerMode : "auto");
            setExternalPlayer(config.externalPlayer || "vlc");
            autoLoadUrlRef.current = config.playlistUrl || "";
            const localCache = JSON.parse(localStorage.getItem(PLAYLIST_CACHE_KEY) || "null") as { url?: string; channels?: IPTVChannel[] } | null;
            if (localCache?.url === config.playlistUrl && Array.isArray(localCache?.channels) && localCache.channels.length) {
                setChannels(localCache.channels);
            }
            setFavorites(JSON.parse(localStorage.getItem(FAVORITES_KEY) || "[]"));
            const cached = JSON.parse(localStorage.getItem(EPG_CACHE_KEY) || "null");
            if (cached?.savedAt && Date.now() - cached.savedAt < EPG_CACHE_TTL && Array.isArray(cached.programs)) setPrograms(cached.programs);
        } catch {
            setFavorites([]);
        } finally {
            setConfigReady(true);
        }
    }, []);

    useEffect(() => {
        const savedUrl = autoLoadUrlRef.current.trim();
        if (!configReady || !savedUrl) return;
        let cancelled = false;
        setLoading(true);
        setError("");
        Promise.all([
            idbGet<{ url?: string; channels?: IPTVChannel[] }>(PLAYLIST_CACHE_KEY).catch(() => null),
            Promise.resolve().then(() => {
                try {
                    return JSON.parse(localStorage.getItem(PLAYLIST_CACHE_KEY) || "null") as { url?: string; channels?: IPTVChannel[] } | null;
                } catch {
                    return null;
                }
            }),
        ]).then(([idbCache, localCache]) => {
            const cached = idbCache?.url === savedUrl ? idbCache : localCache;
            if (cached?.url === savedUrl && Array.isArray(cached.channels) && cached.channels.length) {
                if (!cancelled) setChannels(cached.channels);
                return null;
            }
            return fetchIPTVText(savedUrl);
        }).then((source) => {
            if (!source || cancelled) return;
            if (cancelled) return;
            const parsed = parseM3U(source);
            if (!parsed.length) throw new Error("Keine Sender gefunden. Bitte M3U-Format und URL prüfen.");
            setChannels(parsed);
            void idbSet(PLAYLIST_CACHE_KEY, { url: savedUrl, channels: parsed });
            try { localStorage.setItem(PLAYLIST_CACHE_KEY, JSON.stringify({ url: savedUrl, channels: parsed })); } catch { /* IndexedDB remains the durable cache. */ }
            const embeddedEpg = source.match(/(?:url-tvg|x-tvg-url)="([^"]+)"/i)?.[1];
            if (embeddedEpg && !epgUrl) setEpgUrl(embeddedEpg);
            saveConfig(savedUrl, epgUrl || embeddedEpg || "");
        }).catch((cause) => {
            if (!cancelled) setError(cause instanceof Error ? cause.message : "Gespeicherte Playlist konnte nicht geladen werden.");
        }).finally(() => {
            if (!cancelled) setLoading(false);
        });
        return () => { cancelled = true; };
    }, [configReady]);

    const visible = useMemo(() => {
        const query = channelSearch.trim().toLocaleLowerCase("de");
        return channels.filter((channel) => {
            const matchesFavorite = filter !== "Favoriten" || favorites.includes(channel.id);
            const searchable = [channel.name, channel.group || "", channel.tvgId || ""].join(" ").toLocaleLowerCase("de");
            return matchesFavorite && (!query || searchable.includes(query));
        });
    }, [channels, filter, favorites, channelSearch]);
    const groupedChannels = useMemo(() => {
        const labels = [
            { name: "Albanisch", terms: ["alban", "shqip"] },
            { name: "German", terms: ["german", "deutsch", "germany", "deu"] },
            { name: "Schweiz", terms: ["schweiz", "swiss", "suisse", "svizzera", "swi"] },
            { name: "Austria", terms: ["austria", "österreich", "osterreich", "aut"] },
            { name: "Turkish", terms: ["turk", "türk", "turkiye", "türkiye"] },
        ];
        const groups = new Map<string, IPTVChannel[]>();
        for (const label of labels) groups.set(label.name, []);
        const other: IPTVChannel[] = [];
        for (const channel of visible) {
            const sourceGroup = (channel.group || "").toLocaleLowerCase("de");
            const match = labels.find((label) => label.terms.some((term) => sourceGroup.includes(term)));
            if (match) groups.get(match.name)?.push(channel);
            else other.push(channel);
        }
        if (other.length) groups.set("Weitere Sender", other);
        return Array.from(groups.entries()).filter(([, items]) => items.length > 0);
    }, [visible]);

    function saveConfig(nextPlaylist = playlistUrl, nextEpg = epgUrl) {
        const current = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}") as IPTVConfig;
        localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...current, playlistUrl: nextPlaylist, epgUrl: nextEpg }));
    }

    async function loadPlaylist() {
        if (!/^https?:\/\//i.test(playlistUrl.trim())) {
            setError("Bitte eine gültige M3U-URL eingeben.");
            return;
        }
        setLoading(true);
        setError("");
        setSelected(null);
        try {
            const source = await fetchIPTVText(playlistUrl.trim());
            const parsed = parseM3U(source);
            if (!parsed.length) throw new Error("Keine Sender gefunden. Bitte M3U-Format und URL prüfen.");
            setChannels(parsed);
            void idbSet(PLAYLIST_CACHE_KEY, { url: playlistUrl.trim(), channels: parsed });
            try { localStorage.setItem(PLAYLIST_CACHE_KEY, JSON.stringify({ url: playlistUrl.trim(), channels: parsed })); } catch { /* IndexedDB remains the durable cache. */ }
            const embeddedEpg = source.match(/(?:url-tvg|x-tvg-url)="([^"]+)"/i)?.[1];
            if (embeddedEpg && !epgUrl) setEpgUrl(embeddedEpg);
            saveConfig(playlistUrl.trim(), epgUrl || embeddedEpg || "");
        } catch (cause) {
            setError(cause instanceof Error ? cause.message : "Playlist konnte nicht geladen werden. Möglicherweise blockiert CORS den Zugriff.");
        } finally {
            setLoading(false);
        }
    }

    async function loadEpg() {
        if (!/^https?:\/\//i.test(epgUrl.trim())) {
            setEpgMessage("Bitte zuerst eine gültige XMLTV-URL eintragen.");
            return;
        }
        setEpgLoading(true);
        setEpgMessage("");
        try {
            const source = await fetchIPTVText(epgUrl.trim());
            const parsed = parseXMLTV(source);
            if (!parsed.length) throw new Error("Keine Programmdaten in der XMLTV-Datei gefunden.");
            setPrograms(parsed);
            localStorage.setItem(EPG_CACHE_KEY, JSON.stringify({ savedAt: Date.now(), programs: parsed }));
            saveConfig();
            setEpgMessage(`${parsed.length.toLocaleString("de-CH")} Sendungen geladen.`);
        } catch (cause) {
            setEpgMessage(cause instanceof Error ? cause.message : "EPG konnte nicht geladen werden. Eventuell blockiert CORS den Zugriff.");
        } finally {
            setEpgLoading(false);
        }
    }

    function playChannel(channel: IPTVChannel) {
        setPlayerError("");
        if (playerMode === "external") {
            const packages = { vlc: "org.videolan.vlc", mx: "com.mxtech.videoplayer.ad", just: "com.brouken.player", kodi: "org.xbmc.kodi" };
            const stream = getProxiedStreamUrl(channel.url);
            const intent = `intent://${window.location.host}${stream}#Intent;scheme=${window.location.protocol.slice(0, -1)};package=${packages[externalPlayer]};type=video/*;S.browser_fallback_url=${encodeURIComponent(window.location.origin + stream)};end`;
            window.location.href = intent;
            return;
        }
        setSelected(channel);
    }

    function toggleFavorite(id: string) {
        setFavorites((current) => {
            const next = current.includes(id) ? current.filter((item) => item !== id) : [...current, id];
            localStorage.setItem(FAVORITES_KEY, JSON.stringify(next));
            return next;
        });
    }

    const nowNext = selected ? getNowNext(selected, programs) : null;

    useEffect(() => {
        const video = videoRef.current;
        if (!selected || !video || playerMode === "external") return;
        const streamUrl = selected.url;
        const isHls = isHlsStream(streamUrl);
        const proxiedStreamUrl = getProxiedStreamUrl(streamUrl);
        let hls: Hls | null = null;
        setPlayerError("");

        if (isHls && playerMode !== "native" && Hls.isSupported()) {
            hls = new Hls({ enableWorker: true, lowLatencyMode: true });
            hls.loadSource(proxiedStreamUrl);
            hls.attachMedia(video);
            if (playerAutoplay) {
                hls.on(Hls.Events.MANIFEST_PARSED, () => {
                    void video.play().catch(() => setPlayerError("Der Browser hat die automatische Wiedergabe blockiert. Bitte im Player auf Play drücken."));
                });
            }
            hls.on(Hls.Events.ERROR, (_event, data) => {
                if (data.fatal) {
                    setPlayerError(data.type === Hls.ErrorTypes.NETWORK_ERROR
                        ? `HLS-Netzwerkfehler (${data.details}${data.response?.code ? `, HTTP ${data.response.code}` : ""}): Playlist oder Videosegmente sind nicht erreichbar.`
                        : `HLS-Wiedergabefehler (${data.details}): Stream oder Codec konnte nicht verarbeitet werden.`);
                    hls?.destroy();
                    hls = null;
                }
            });
        } else {
            video.src = proxiedStreamUrl;
            if (isHls && !video.canPlayType("application/vnd.apple.mpegurl")) {
                setPlayerError("HLS wird nativ nicht unterstützt. Bitte in den Einstellungen „Automatisch (HLS.js)“ wählen.");
            }
        }

        if (playerAutoplay && !isHls) {
            const attempt = video.play();
            if (attempt) attempt.catch(() => {
                setPlayerError("Der Browser hat die automatische Wiedergabe blockiert. Bitte im Player auf Play drücken.");
            });
        }
        return () => {
            if (hls) hls.destroy();
            video.pause();
            video.removeAttribute("src");
            video.load();
        };
    }, [selected, playerMode, playerAutoplay]);


    useEffect(() => {
        function handleRemoteKey(event: KeyboardEvent) {
            const target = event.target as HTMLElement | null;
            if (target?.closest("input, textarea, select")) return;
            if (event.key === "Escape") {
                if (document.fullscreenElement) void document.exitFullscreen();
                else if (selected) setSelected(null);
                return;
            }
            const channelKey = event.key === "ChannelUp" || event.key === "ChannelDown";
            const fullscreenArrow = Boolean(document.fullscreenElement) && (event.key === "ArrowUp" || event.key === "ArrowDown");
            if (!visible.length || (!channelKey && !fullscreenArrow)) return;
            event.preventDefault();
            const currentIndex = selected ? visible.findIndex((channel) => channel.id === selected.id) : -1;
            const direction = event.key === "ArrowUp" || event.key === "ChannelUp" ? -1 : 1;
            const nextIndex = currentIndex < 0 ? 0 : (currentIndex + direction + visible.length) % visible.length;
            setSelected(visible[nextIndex]);
        }
        window.addEventListener("keydown", handleRemoteKey);
        return () => window.removeEventListener("keydown", handleRemoteKey);
    }, [visible, selected]);

    return (
        <div className="mx-auto w-full max-w-6xl space-y-4 pb-16">
            <PageHeader icon={Tv} title="IPTV" description="Live-TV aus deiner M3U-Playlist" />
            {!channels.length && (
                <section className="rounded-lg border border-border/60 p-4 space-y-3">
                    <h2 className="font-medium">Playlist verbinden</h2>
                    <p className="text-sm text-muted-foreground">Playlist- und EPG-Adressen werden nur lokal in diesem Browser gespeichert.</p>
                    <Input type="url" value={playlistUrl} onChange={(event) => { setPlaylistUrl(event.target.value); saveConfig(event.target.value, epgUrl); }} placeholder="M3U-URL" aria-label="M3U-Playlist-URL" />
                    <Input type="url" value={epgUrl} onChange={(event) => { setEpgUrl(event.target.value); saveConfig(playlistUrl, event.target.value); }} placeholder="XMLTV-EPG-URL (optional)" aria-label="XMLTV-EPG-URL" />
                    <Button onClick={loadPlaylist} disabled={loading || !playlistUrl.trim()} className="w-full">
                        <RefreshCw className={loading ? "size-4 animate-spin" : "size-4"} /> {loading ? "Lädt…" : "Playlist laden"}
                    </Button>
                    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
                </section>
            )}
            {channels.length > 0 && (
                <>
                    <div className="flex flex-wrap items-center gap-2">
                        <Button size="sm" variant={filter === "Alle" ? "default" : "outline"} onClick={() => setFilter("Alle")}>Alle Sender</Button>
                        <Button size="sm" variant={filter === "Favoriten" ? "default" : "outline"} onClick={() => setFilter("Favoriten")}><Heart className="size-4" /> Favoriten</Button>
                        <Button size="sm" variant="outline" onClick={() => { setChannels([]); setSelected(null); }}><RefreshCw className="size-4" /> Playlist ändern</Button>
                        <span className="ml-auto text-xs text-muted-foreground">{visible.length} Sender</span>
                    </div>
                    <Input
                        type="search"
                        value={channelSearch}
                        onChange={(event) => setChannelSearch(event.target.value)}
                        placeholder="Sender, Gruppe oder TVG-ID suchen…"
                        aria-label="Sender suchen"
                    />
                    <section className="rounded-lg border border-border/60 p-3 space-y-3">
                        <div className="flex flex-col sm:flex-row gap-2">
                            <Input type="url" value={epgUrl} onChange={(event) => { setEpgUrl(event.target.value); saveConfig(playlistUrl, event.target.value); }} placeholder="XMLTV-EPG-URL" aria-label="XMLTV-EPG-URL" />
                            <Button onClick={loadEpg} disabled={epgLoading || !epgUrl.trim()} variant="outline" className="shrink-0">
                                <CalendarDays className="size-4" /> {epgLoading ? "Lädt…" : "EPG laden"}
                            </Button>
                        </div>
                        {epgMessage && <p className="text-xs text-muted-foreground" role="status">{epgMessage}</p>}
                        {programs.length > 0 && <p className="text-xs text-muted-foreground">EPG gespeichert · {programs.length.toLocaleString("de-CH")} Sendungen · Cache: 6 Stunden</p>}
                    </section>
                    <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_minmax(280px,360px)] gap-4">
                        <section className="min-w-0 space-y-3">
                            {selected ? (
                                <div className="space-y-2">
                                    <div ref={playerContainerRef} className="aspect-video overflow-hidden rounded-lg bg-black">
                                        <video ref={videoRef} key={selected.url} controls muted={playerMuted} playsInline className="h-full w-full" onError={() => setPlayerError("Stream konnte nicht geladen werden. Prüfe die Stream-Adresse, den Anbieter-Zugriff und das Stream-Format.")} />
                                    </div>
                                    {playerError && <p role="alert" className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">{playerError} Prüfe die Player-Einstellungen oder teste den Sender in einem kompatiblen IPTV-Player.</p>}
                                    <div className="flex flex-wrap justify-end gap-2">
                                        <Button size="sm" variant="outline" onClick={() => {
                                            if (selected?.url) window.open(getProxiedStreamUrl(selected.url), "_blank", "noopener,noreferrer");
                                        }}>
                                            <Play className="size-4" /> Im Browser-Player öffnen
                                        </Button>
                                        <Button size="sm" variant="outline" onClick={() => {
                                            const container = playerContainerRef.current;
                                            if (container?.requestFullscreen) void container.requestFullscreen();
                                        }}>
                                            <Maximize className="size-4" /> Vollbild
                                        </Button>
                                    </div>
                                    <div className="flex items-center justify-between gap-2">
                                        <h2 className="truncate font-medium">{selected.name}</h2>
                                        <Button size="icon" variant="ghost" onClick={() => setSelected(null)} aria-label="Player schließen"><X className="size-4" /></Button>
                                    </div>
                                    {nowNext?.current && <div className="rounded-md bg-muted/40 p-3 text-sm"><p className="text-xs text-muted-foreground">JETZT</p><p className="font-medium">{nowNext.current.title}</p>{nowNext.current.description && <p className="mt-1 text-xs text-muted-foreground">{nowNext.current.description}</p>}</div>}
                                    {nowNext?.next && <div className="rounded-md border border-border/60 p-3 text-sm"><p className="text-xs text-muted-foreground">DANACH</p><p className="font-medium">{nowNext.next.title}</p><p className="text-xs text-muted-foreground">{new Date(nowNext.next.start).toLocaleTimeString("de-CH", { hour: "2-digit", minute: "2-digit" })}</p></div>}
                                    {programs.length > 0 && !nowNext?.current && !nowNext?.next && <p className="text-xs text-muted-foreground">Für diesen Sender wurden keine passenden EPG-Daten gefunden. Prüfe die tvg-id-Zuordnung.</p>}
                                </div>
                            ) : (
                                <div className="flex aspect-video flex-col items-center justify-center gap-2 rounded-lg border border-border/60 bg-muted/20 text-muted-foreground"><Tv className="size-10" /><span className="text-sm">Sender auswählen</span></div>
                            )}
                            <div className="space-y-2">
                                {groupedChannels.map(([groupName, groupChannels], groupIndex) => {
                                    const isExpanded = expandedGroups[groupName] ?? groupIndex === 0;
                                    return (
                                    <section key={groupName} className="overflow-hidden rounded-lg border border-border/60">
                                        <button
                                            type="button"
                                            aria-expanded={isExpanded}
                                            onClick={() => setExpandedGroups((current) => ({ ...current, [groupName]: !isExpanded }))}
                                            className="flex min-h-12 w-full touch-manipulation items-center justify-between gap-3 bg-muted/30 px-3 py-2 text-left font-medium hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                                        >
                                            <span className="truncate">{groupName}</span>
                                            <span className="flex shrink-0 items-center gap-2 text-xs text-muted-foreground">{groupChannels.length} Sender <span aria-hidden="true">{isExpanded ? "−" : "+"}</span></span>
                                        </button>
                                        {isExpanded && <div className="grid grid-cols-1 gap-1 p-2 sm:grid-cols-2">
                                            {groupChannels.map((channel) => (
                                                <div key={channel.id} className="flex min-w-0 items-center gap-2 rounded-md border border-border/60 p-2">
                                                    <button type="button" onClick={() => playChannel(channel)} className="flex min-h-11 min-w-0 flex-1 touch-manipulation items-center gap-2 rounded text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                                                        {channel.logo ? <img src={channel.logo} alt="" className="size-9 shrink-0 object-contain" loading="lazy" /> : <Tv className="size-8 shrink-0 text-muted-foreground" />}
                                                        <span className="truncate text-sm">{channel.name}</span>
                                                    </button>
                                                    <Button size="icon" variant="ghost" className="size-8 shrink-0" onClick={() => toggleFavorite(channel.id)} aria-label="Favorit umschalten"><Heart className={favorites.includes(channel.id) ? "size-4 fill-current text-red-500" : "size-4"} /></Button>
                                                </div>
                                            ))}
                                        </div>}
                                    </section>
                                    );
                                })}
                            </div>
                            {!visible.length && <p className="py-6 text-center text-sm text-muted-foreground">Keine Sender in dieser Auswahl.</p>}
                        </section>
                        <aside className="hidden space-y-2 rounded-lg border border-border/60 p-3 lg:block">
                            <h2 className="text-sm font-medium">Senderliste</h2>
                            <div className="max-h-[65vh] space-y-1 overflow-y-auto">
                                {visible.map((channel, index) => (
                                    <button key={channel.id} type="button" onClick={() => playChannel(channel)} className={"relative z-10 flex min-h-11 w-full touch-manipulation items-center gap-2 rounded-md p-2 text-left text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring " + (selected?.id === channel.id ? "bg-accent" : "hover:bg-muted/60")}>
                                        <span className="w-6 text-right text-xs text-muted-foreground">{index + 1}</span><span className="flex-1 truncate">{channel.name}</span><Play className="size-3 shrink-0" />
                                    </button>
                                ))}
                            </div>
                        </aside>
                    </div>
                    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
                </>
            )}
            {!channels.length && <p className="text-xs text-muted-foreground">Hinweis: Wiedergabe hängt vom Streamformat und den Browser-Fähigkeiten ab. Mit Hoch/Runter wechselst du Sender; Escape schließt Player oder Vollbild. HLS hängt weiterhin vom TV-Browser ab.</p>}
        </div>
    );
}
