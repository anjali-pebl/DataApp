import { Skeleton } from '@/components/ui/skeleton';
import { Database, ArrowLeft } from 'lucide-react';

export default function Loading() {
  return (
    <div className="h-screen flex flex-col bg-background">
      {/* Header Skeleton */}
      <header className="flex-shrink-0 border-b border-border bg-background px-6 py-4">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1 text-muted-foreground">
              <ArrowLeft className="h-4 w-4" />
              <span className="text-sm">Back to Map</span>
            </div>
            <div className="h-6 w-px bg-border" />
            <div className="flex items-center gap-1.5">
              <Database className="h-4 w-4 text-muted-foreground" />
              <span className="font-semibold text-base">Project Data Files</span>
              <span className="text-muted-foreground font-normal">·</span>
              <Skeleton className="h-4 w-32" />
            </div>
          </div>
          <Skeleton className="h-8 w-24" />
        </div>
      </header>

      {/* Filters Skeleton */}
      <div className="px-6 py-3">
        <div className="bg-muted/10 rounded p-3 border border-border/20">
          <div className="flex items-center gap-3 flex-wrap">
            <Skeleton className="h-6 w-20" />
            <Skeleton className="h-6 w-24" />
            <Skeleton className="h-6 w-16" />
            <Skeleton className="h-6 w-28" />
            <Skeleton className="h-6 w-20" />
            <Skeleton className="h-6 w-32" />
          </div>
        </div>
      </div>

      {/* Content Skeleton */}
      <main className="flex-1 overflow-y-auto p-6 space-y-4">
        {/* Source Tile Skeletons */}
        {[1, 2, 3].map(i => (
          <div key={i} className="border border-border rounded-lg overflow-hidden">
            <div className="bg-teal-700/50 px-4 py-3">
              <div className="flex items-center justify-between">
                <Skeleton className="h-5 w-32 bg-white/20" />
                <div className="flex items-center gap-2">
                  <Skeleton className="h-6 w-24 bg-white/20" />
                  <Skeleton className="h-6 w-16 bg-white/20" />
                </div>
              </div>
            </div>
            <div className="p-4 space-y-3">
              <Skeleton className="h-8 w-full" />
              <Skeleton className="h-8 w-full" />
              <Skeleton className="h-8 w-3/4" />
            </div>
          </div>
        ))}
      </main>
    </div>
  );
}
