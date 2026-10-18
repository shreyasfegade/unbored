import type { MediaItem, WatchProvider } from "../../types/media";

/** The region Unbored shows availability for. */
export const WATCH_REGION = "IN";
export const REGION_NAME = "India";

export type WatchOptions =
  /** TMDB / JustWatch availability for the region. */
  | { kind: "providers"; link: string | null; stream: WatchProvider[]; rent: WatchProvider[]; buy: WatchProvider[] }
  /** AniList streaming links, with no region information. */
  | { kind: "links"; links: Array<{ name: string; url: string }> }
  /** Checked: not available in the region. */
  | { kind: "none" }
  /** No availability data for this title (catalog built before it was collected). */
  | { kind: "unchecked" };

export function watchOptions(media: Pick<MediaItem, "watch">): WatchOptions {
  const watch = media.watch;
  if (!watch) return { kind: "unchecked" };
  const region = watch[WATCH_REGION];
  if (region) {
    // Rent and buy usually list the same stores; show each store once, rent first.
    const rent = region.rent ?? [];
    const rentIds = new Set(rent.map((p) => p.id));
    const buy = (region.buy ?? []).filter((p) => !rentIds.has(p.id));
    const stream = region.flatrate ?? [];
    if (stream.length || rent.length || buy.length) {
      return { kind: "providers", link: region.link ?? null, stream, rent, buy };
    }
  }
  const links = watch.any?.links ?? [];
  if (links.length) return { kind: "links", links };
  return { kind: "none" };
}

/** A web search for the title, for when there's nothing better to link. */
export function searchUrl(media: Pick<MediaItem, "title" | "release_year">): string | null {
  if (!media.title) return null;
  return `https://www.google.com/search?q=${encodeURIComponent(`watch ${media.title} ${media.release_year ?? ""}`.trim())}`;
}

/** Where the main "Where to watch" button goes. */
export function primaryWatchUrl(media: Pick<MediaItem, "title" | "release_year" | "watch">): string | null {
  const opts = watchOptions(media);
  if (opts.kind === "providers" && opts.link) return opts.link;
  if (opts.kind === "links") return opts.links[0].url;
  return searchUrl(media);
}

export const logoUrl = (path: string | null) => (path ? `https://image.tmdb.org/t/p/w92${path}` : null);
