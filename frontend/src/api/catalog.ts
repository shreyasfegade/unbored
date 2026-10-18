/**
 * Shared helpers for the catalog-backed API functions: everything here reads
 * the browser data pack, so it works offline once the pack is cached.
 */
import { loadCatalog, type Catalog } from "../engine/pack";
import type { Card } from "../engine/types";
import type { MediaItem } from "../types/media";
import { apiError, toApiError } from "./client";

/** A card without the engine-only fields, as the UI and stores expect it. */
export function toMedia(card: Card): MediaItem {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { tone, quality, ...media } = card;
  return media;
}

export async function withCatalog<T>(fn: (catalog: Catalog) => T): Promise<{ data: T }> {
  let catalog: Catalog;
  try {
    catalog = await loadCatalog();
  } catch (err) {
    throw toApiError(err);
  }
  return { data: fn(catalog) };
}

export const notFound = (what: string) => apiError("NOT_FOUND", `${what} isn't in the catalog.`, 404);

export const TYPE_FILTER = new Set(["movie", "tv", "anime"]);

export const typeFilter = (mediaType?: string | null) =>
  mediaType && TYPE_FILTER.has(mediaType.toLowerCase()) ? mediaType.toLowerCase() : null;
