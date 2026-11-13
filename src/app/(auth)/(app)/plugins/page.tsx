"use client";

import { Blocks, Captions, CirclePlay, Info, Library, Tv } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

const plannedPlugins = [
    {
        name: "Untertitel",
        description: "Untertitel-Anbieter suchen und Untertitel beim Abspielen auswählen.",
        icon: Captions,
    },
    {
        name: "Player-Erweiterungen",
        description: "Zusätzliche Wiedergabeziele und Player-Integrationen.",
        icon: CirclePlay,
    },
    {
        name: "Medienbibliothek",
        description: "Bibliotheken und Dienste wie Trakt mit DebridUI verbinden.",
        icon: Library,
    },
    {
        name: "IPTV-Erweiterungen",
        description: "Zusätzliche Werkzeuge und Datenquellen für IPTV.",
        icon: Tv,
    },
];

export default function PluginsPage() {
    return (
        <div className="mx-auto w-full max-w-4xl space-y-4 sm:space-y-6 lg:space-y-8 pb-16">
            <PageHeader
                icon={Blocks}
                title="Plugins"
                description="Erweitere DebridUI mit zusätzlichen Funktionen – getrennt von Stremio-Add-ons."
            />

            <Card>
                <CardHeader>
                    <div className="flex items-center gap-2">
                        <Info className="size-4 text-muted-foreground" />
                        <CardTitle className="text-base">Plugin-System</CardTitle>
                        <Badge variant="secondary">In Vorbereitung</Badge>
                    </div>
                    <CardDescription>
                        Die Plugin-Verwaltung ist jetzt als eigener Bereich angelegt. Das sichere Installieren,
                        Aktivieren und Aktualisieren von Erweiterungen wird als nächster Schritt ergänzt.
                    </CardDescription>
                </CardHeader>
                <CardContent className="text-sm text-muted-foreground">
                    Plugins sollen nur freigegebene DebridUI-Schnittstellen verwenden. Fremder Plugin-Code
                    erhält keinen direkten Zugriff auf deine Zugangsdaten.
                </CardContent>
            </Card>

            <section className="space-y-3">
                <div>
                    <h2 className="text-sm font-medium">Geplante Erweiterungen</h2>
                    <p className="text-sm text-muted-foreground">
                        Diese Plugin-Arten sind für den ersten Ausbau vorgesehen.
                    </p>
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                    {plannedPlugins.map((plugin) => {
                        const Icon = plugin.icon;
                        return (
                            <Card key={plugin.name}>
                                <CardHeader className="space-y-2">
                                    <div className="flex items-center justify-between gap-2">
                                        <Icon className="size-5 text-muted-foreground" />
                                        <Badge variant="outline">Geplant</Badge>
                                    </div>
                                    <CardTitle className="text-base">{plugin.name}</CardTitle>
                                    <CardDescription>{plugin.description}</CardDescription>
                                </CardHeader>
                            </Card>
                        );
                    })}
                </div>
            </section>
        </div>
    );
}
