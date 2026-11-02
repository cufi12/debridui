"use client";

import { useState } from "react";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { SectionDivider } from "@/components/layout/section-divider";
import { Button } from "@/components/ui/button";
import { useClearPlaybackHistory } from "@/features/media/hooks/use-playback-history";
import { useClearSearchHistory } from "@/features/search/hooks/use-search-history";

export function DataSection() {
    const { mutate: clearPlayback } = useClearPlaybackHistory();
    const { mutate: clearSearch } = useClearSearchHistory();
    const [confirmClearPlayback, setConfirmClearPlayback] = useState(false);
    const [confirmClearSearch, setConfirmClearSearch] = useState(false);

    return (
        <>
            <section className="space-y-4">
                <SectionDivider label="Data" />

                <div className="space-y-2">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between rounded-sm border border-border/50 p-3">
                        <div>
                            <p className="text-sm">Playback History</p>
                            <p className="text-xs text-muted-foreground">
                                Remove every entry from your Continue Watching list
                            </p>
                        </div>
                        <Button variant="outline" onClick={() => setConfirmClearPlayback(true)}>
                            Clear History
                        </Button>
                    </div>

                    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between rounded-sm border border-border/50 p-3">
                        <div>
                            <p className="text-sm">Search History</p>
                            <p className="text-xs text-muted-foreground">
                                Remove every recent pick from your search history
                            </p>
                        </div>
                        <Button variant="outline" onClick={() => setConfirmClearSearch(true)}>
                            Clear History
                        </Button>
                    </div>
                </div>
            </section>

            <ConfirmDialog
                open={confirmClearPlayback}
                onOpenChange={setConfirmClearPlayback}
                title="Clear playback history?"
                description="This will remove every title from Continue Watching. This action cannot be undone."
                confirmText="Clear all"
                variant="destructive"
                onConfirm={() => clearPlayback()}
            />
            <ConfirmDialog
                open={confirmClearSearch}
                onOpenChange={setConfirmClearSearch}
                title="Clear search history?"
                description="This will remove every entry from your recent searches. This action cannot be undone."
                confirmText="Clear all"
                variant="destructive"
                onConfirm={() => clearSearch({})}
            />
        </>
    );
}
