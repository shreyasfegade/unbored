/** Right-size a poster URL for its render context.
 *
 * The catalog stores full-width TMDB URLs (`/w500/…`); grid tiles are ~120px
 * wide, so serving w500 there is ~10× the pixels needed × dozens of tiles. TMDB
 * exposes narrower widths via a path segment, so this is a string swap. AniList
 * only offers one size, so those URLs pass through unchanged.
 */
type PosterSize = "thumb" | "card" | "hero";

const WIDTH: Record<PosterSize, string> = {
  thumb: "w185", // small grid / alternate tiles
  card: "w342",  // onboarding + enrich grid tiles (retina-safe)
  hero: "w500",  // the reveal poster
};

export function sizedPoster(url: string | null | undefined, size: PosterSize): string {
  if (!url) return "";
  return url.replace(/\/w\d+\//, `/${WIDTH[size]}/`);
}
