"use client";

import { useMemo, useState } from "react";
import { Heart, Play, RefreshCw, Tv, X } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { parseM3U, type IPTVChannel } from "@/lib/iptv/m3u";

const STORAGE_KEY = "debridui-iptv-config";
const FAVORITES_KEY = "debridui-iptv-favorites";

export default function IPTVPage() {
    const [playlistUrl, setPlaylistUrl] = useState(() => typeof window === "undefined" ? "" : localStorage.getItem(STORAGE_KEY) || "");
    const [channels, setChannels] = useState<IPTVChannel[]>([]);
    const [favorites, setFavorites] = useState<string[]>(() => {
        if (typeof window === "undefined") return [];
        try { return JSON.parse(localStorage.getItem(FAVORITES_KEY) || "[]"); } catch { return []; }
    });
    const [selected, setSelected] = useState<IPTVChannel | null>(null);
    const [category, setCategory] = useState("Alle");
    const [filter, setFilter] = useState("Alle");
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState("");

    const categories = useMemo(() => ["Alle", ...Array.from(new Set(channels.map(c => c.group))).sort()], [channels]);
    const visible = useMemo(() => channels.filter(c =>
        (category === "Alle" || c.group === category) &&
        (filter !== "Favoriten" || favorites.includes(c.id))
    ), [channels, category, filter, favorites]);

    async function loadPlaylist() {
        if (!/^https?:\/\//i.test(playlistUrl.trim())) { setError("Bitte eine gültige M3U-URL eingeben."); return; }
        setLoading(true); setError(""); setSelected(null);
        try {
            const response = await fetch(playlistUrl.trim());
            if (!response.ok) throw new Error("Playlist konnte nicht geladen werden.");
            const parsed = parseM3U(await response.text());
            if (!parsed.length) throw new Error("Keine Sender gefunden. Bitte M3U-Format und URL prüfen.");
            setChannels(parsed);
            localStorage.setItem(STORAGE_KEY, playlistUrl.trim());
        } catch (e) {
            setError(e instanceof Error ? e.message : "Playlist konnte nicht geladen werden. Eventuell blockiert der Anbieter CORS.");
        } finally { setLoading(false); }
    }

    function toggleFavorite(id: string) {
        setFavorites(current => {
            const next = current.includes(id) ? current.filter(x => x !== id) : [...current, id];
            localStorage.setItem(FAVORITES_KEY, JSON.stringify(next));
            return next;
        });
    }

    return (
        <div className="mx-auto w-full max-w-6xl space-y-4 pb-16">
            <PageHeader icon={Tv} title="IPTV" description="Live-TV aus deiner M3U-Playlist" />
            {!channels.length && (
                <section className="rounded-lg border border-border/60 p-4 space-y-3">
                    <h2 className="font-medium">Playlist verbinden</h2>
                    <p className="text-sm text-muted-foreground">Füge die M3U-URL deines IPTV-Anbieters ein. Sie wird nur lokal in diesem Browser gespeichert.</p>
                    <Input type="url" value={playlistUrl} onChange={e => setPlaylistUrl(e.target.value)} placeholder="https://anbieter.example/playlist.m3u" />
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
                        <span className="text-xs text-muted-foreground ml-auto">{visible.length} Sender</span>
                    </div>
                    <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_minmax(280px,360px)] gap-4">
                        <section className="min-w-0 space-y-3">
                            {selected ? (
                                <div className="space-y-2">
                                    <div className="aspect-video bg-black rounded-lg overflow-hidden">
                                        <video key={selected.url} src={selected.url} controls autoPlay playsInline className="w-full h-full" />
                                    </div>
                                    <div className="flex items-center justify-between gap-2">
                                        <h2 className="font-medium truncate">{selected.name}</h2>
                                        <Button size="icon" variant="ghost" onClick={() => setSelected(null)} aria-label="Player schließen"><X className="size-4" /></Button>
                                    </div>
                                </div>
                            ) : (
                                <div className="aspect-video rounded-lg border border-border/60 bg-muted/20 flex flex-col items-center justify-center gap-2 text-muted-foreground">
                                    <Tv className="size-10" /><span className="text-sm">Sender auswählen</span>
                                </div>
                            )}
                            <div className="flex gap-2 overflow-x-auto pb-1">
                                {categories.map(c => <Button key={c} size="sm" variant={category === c ? "default" : "outline"} onClick={() => setCategory(c)} className="shrink-0">{c}</Button>)}
                            </div>
                            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                                {visible.map(channel => (
                                    <div key={channel.id} className="flex items-center gap-2 rounded-md border border-border/60 p-2 min-w-0">
                                        <button type="button" onClick={() => setSelected(channel)} className="flex items-center gap-2 min-w-0 flex-1 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded">
                                            {channel.logo ? <img src={channel.logo} alt="" className="size-9 object-contain shrink-0" loading="lazy" /> : <Tv className="size-8 shrink-0 text-muted-foreground" />}
                                            <span className="text-sm truncate">{channel.name}</span>
                                        </button>
                                        <Button size="icon" variant="ghost" className="size-8 shrink-0" onClick={() => toggleFavorite(channel.id)} aria-label="Favorit umschalten">
                                            <Heart className={favorites.includes(channel.id) ? "size-4 fill-current text-red-500" : "size-4"} />
                                        </Button>
                                    </div>
                                ))}
                            </div>
                            {!visible.length && <p className="text-sm text-muted-foreground py-6 text-center">Keine Sender in dieser Auswahl.</p>}
                        </section>
                        <aside className="rounded-lg border border-border/60 p-3 space-y-2">
                            <h2 className="font-medium text-sm">Senderliste</h2>
                            <div className="max-h-[65vh] overflow-y-auto space-y-1">
                                {visible.map((channel, index) => (
                                    <button key={channel.id} type="button" onClick={() => setSelected(channel)} className={"w-full flex items-center gap-2 rounded-md p-2 text-left text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring " + (selected?.id === channel.id ? "bg-accent" : "hover:bg-muted/60")}>
                                        <span className="text-xs text-muted-foreground w-6 text-right">{index + 1}</span>
                                        <span className="truncate flex-1">{channel.name}</span>
                                        <Play className="size-3 shrink-0" />
                                    </button>
                                ))}
                            </div>
                        </aside>
                    </div>
                    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
                </>
            )}
            {!channels.length && <p className="text-xs text-muted-foreground">Hinweis: Die Wiedergabe hängt vom Streamformat und den Browser-Fähigkeiten deines Geräts ab. HLS-Unterstützung und EPG werden als Nächstes ergänzt.</p>}
        </div>
    );
}
