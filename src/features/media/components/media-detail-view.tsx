"use client";

import { memo, Suspense } from "react";
import { SectionDivider } from "@/components/layout/section-divider";
import { useTraktMedia } from "@/features/media/hooks/use-trakt";
import type { TraktIdType, TraktMedia } from "@/lib/trakt";
import { MediaFooter } from "./media-footer";
import { MediaHeader, MediaHeaderSkeleton } from "./media-header";
import { PeopleSection } from "./people-section";
import { ShowDetails } from "./show-details";
import { Sources } from "./sources";

interface MediaDetailViewProps {
    id: string;
    type?: "movie" | "show";
    idType?: TraktIdType;
}

// Shared detail page body for all media routes (/movies, /shows, /title).
export function MediaDetailView({ id, type, idType }: MediaDetailViewProps) {
    const { media, type: resolvedType, error } = useTraktMedia({ id, type, idType });

    return (
        <div className="w-full lg:px-6 max-w-6xl mx-auto">
            <Suspense fallback={null}>
                <MediaDetails media={media} mediaId={id} type={resolvedType} error={error} />
            </Suspense>
            <MediaFooter className="py-12 mt-8 border-t border-border/50" />
        </div>
    );
}

interface MediaDetailsProps {
    media?: TraktMedia;
    mediaId: string;
    type?: "movie" | "show";
    error?: Error | null;
}

const MediaDetails = memo(function MediaDetails({ media, mediaId, type, error }: MediaDetailsProps) {
    if (error) {
        return (
            <div className="flex items-center justify-center min-h-[50vh]">
                <div className="text-center space-y-3">
                    <div className="text-xs tracking-widest uppercase text-muted-foreground">Error</div>
                    <p className="text-xl font-light">Failed to load details</p>
                    <p className="text-sm text-muted-foreground">{error.message}</p>
                </div>
            </div>
        );
    }

    // Type still resolving (external-id lookup): no layout to anchor yet.
    if (!type) {
        return <MediaHeaderSkeleton />;
    }

    // Type known: render the real layout immediately (with the #seasons anchor),
    // letting the detail component show its own skeletons until `media` arrives.
    return type === "movie" ? (
        <MovieDetails media={media} mediaId={mediaId} />
    ) : (
        <ShowDetails media={media} mediaId={mediaId} />
    );
});

interface MovieDetailsProps {
    media?: TraktMedia;
    mediaId: string;
}

const MovieDetails = memo(function MovieDetails({ media, mediaId }: MovieDetailsProps) {
    return (
        <div className="space-y-12">
            {media ? <MediaHeader media={media} mediaId={mediaId} type="movie" /> : <MediaHeaderSkeleton />}

            {media?.ids?.imdb && (
                <section className="space-y-6">
                    <SectionDivider label="Available Sources" />
                    <div id="sources" className="-mx-4 sm:mx-0">
                        <Sources
                            request={{ imdbId: media.ids.imdb, type: "movie", media }}
                            className="border-x-0 sm:border-x rounded-none sm:rounded-sm"
                        />
                    </div>
                </section>
            )}

            <section className="space-y-6">
                <SectionDivider label="Cast & Crew" />
                <PeopleSection mediaId={mediaId} type="movies" />
            </section>
        </div>
    );
});
