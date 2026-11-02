"use client";

import { Calendar, Film, Sparkles, Ticket, TrendingUp } from "lucide-react";
import dynamic from "next/dynamic";
import { memo, useCallback, useState } from "react";
import { ContinueWatching } from "@/features/media/components/continue-watching";
import { HeroCarouselSkeleton } from "@/features/media/components/hero-carousel-skeleton";
import { MediaFooter } from "@/features/media/components/media-footer";
import { MediaSection } from "@/features/media/components/media-section";
import {
    useTraktAnticipatedMovies,
    useTraktAnticipatedShows,
    useTraktBoxOfficeMovies,
    useTraktMostWatchedMovies,
    useTraktMostWatchedShows,
    useTraktPopularMovies,
    useTraktPopularShows,
    useTraktTrendingMovies,
    useTraktTrendingShows,
} from "@/features/media/hooks/use-trakt";
import { SearchDialog } from "@/features/search/components/search-dialog";
import { AddonCatalogs } from "./_components/addon-catalogs";
import { ContentSection } from "./_components/content-section";
import { WelcomeSection } from "./_components/welcome-section";

const HeroCarousel = dynamic(
    () => import("@/features/media/components/hero-carousel").then((m) => ({ default: m.HeroCarousel })),
    {
        loading: () => <HeroCarouselSkeleton />,
        ssr: false,
    }
);

const DashboardPage = memo(function DashboardPage() {
    const [searchOpen, setSearchOpen] = useState(false);
    const openSearch = useCallback(() => setSearchOpen(true), []);

    const trendingMovies = useTraktTrendingMovies(20);
    const trendingShows = useTraktTrendingShows(20);
    const popularMovies = useTraktPopularMovies(20);
    const popularShows = useTraktPopularShows(20);
    const mostWatchedMovies = useTraktMostWatchedMovies("weekly", 20);
    const mostWatchedShows = useTraktMostWatchedShows("weekly", 20);
    const anticipatedMovies = useTraktAnticipatedMovies(20);
    const anticipatedShows = useTraktAnticipatedShows(20);
    const boxOffice = useTraktBoxOfficeMovies();

    return (
        <div className="pb-12">
            {/* Hero Carousel */}
            <HeroCarousel autoFocus />

            {/* Continue Watching */}
            <ContinueWatching />

            {/* Welcome Section */}
            <WelcomeSection onSearchClick={openSearch} />

            <SearchDialog open={searchOpen} onOpenChange={setSearchOpen} />

            {/* Content Sections with lazy loading */}
            <div className="lg:px-6 space-y-16">
                {/* Addon Catalogs */}
                <AddonCatalogs />

                {/* Trending */}
                <ContentSection label="Trending Now" icon={TrendingUp} delay={0}>
                    <MediaSection
                        title="Movies"
                        items={trendingMovies.data}
                        isLoading={trendingMovies.isLoading}
                        error={trendingMovies.error}
                        showRank
                    />
                    <MediaSection
                        title="TV Shows"
                        items={trendingShows.data}
                        isLoading={trendingShows.isLoading}
                        error={trendingShows.error}
                        showRank
                    />
                </ContentSection>

                {/* Popular */}
                <ContentSection label="Popular" icon={Sparkles} delay={100}>
                    <MediaSection
                        title="Movies"
                        items={popularMovies.data}
                        isLoading={popularMovies.isLoading}
                        error={popularMovies.error}
                    />
                    <MediaSection
                        title="TV Shows"
                        items={popularShows.data}
                        isLoading={popularShows.isLoading}
                        error={popularShows.error}
                    />
                </ContentSection>

                {/* Box Office */}
                <ContentSection label="Box Office" icon={Ticket} delay={200}>
                    <MediaSection
                        title="Top Grossing"
                        items={boxOffice.data}
                        isLoading={boxOffice.isLoading}
                        error={boxOffice.error}
                    />
                </ContentSection>

                {/* Most Watched */}
                <ContentSection label="Most Watched This Week" icon={Film} delay={300}>
                    <MediaSection
                        title="Movies"
                        items={mostWatchedMovies.data}
                        isLoading={mostWatchedMovies.isLoading}
                        error={mostWatchedMovies.error}
                    />
                    <MediaSection
                        title="TV Shows"
                        items={mostWatchedShows.data}
                        isLoading={mostWatchedShows.isLoading}
                        error={mostWatchedShows.error}
                    />
                </ContentSection>

                {/* Coming Soon */}
                <ContentSection label="Coming Soon" icon={Calendar} delay={400}>
                    <MediaSection
                        title="Movies"
                        items={anticipatedMovies.data}
                        isLoading={anticipatedMovies.isLoading}
                        error={anticipatedMovies.error}
                    />
                    <MediaSection
                        title="TV Shows"
                        items={anticipatedShows.data}
                        isLoading={anticipatedShows.isLoading}
                        error={anticipatedShows.error}
                    />
                </ContentSection>

                {/* Footer */}
                <MediaFooter className="pt-10 border-t border-border/50" />
            </div>
        </div>
    );
});

export default DashboardPage;
