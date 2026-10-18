/**
 * The rating exports Unbored reads. Everything is parsed in the browser; the
 * file never leaves the device.
 *
 * - Letterboxd (Settings → Import & Export → Export your data): ratings.csv,
 *   watched.csv or diary.csv. Columns Name, Year, and Rating out of 5 where
 *   the file has one.
 * - IMDb (Your ratings → ⋯ → Export): Const, Your Rating out of 10, Title,
 *   Original Title, Year, Title Type.
 */
import { parseCsvRecords } from "./csv";

export type ImportSource = "letterboxd" | "imdb";

export interface ImportRow {
  title: string;
  originalTitle?: string;
  year: number | null;
  /** On a 10-point scale, or null when the file only says it was watched. */
  rating10: number | null;
  imdbId?: string;
  /** IMDb's title type, mapped: "movie" | "tv" | null when unknown. */
  kind: "movie" | "tv" | null;
}

export interface ParsedImport {
  source: ImportSource;
  rows: ImportRow[];
  /** Rows dropped before matching, such as single TV episodes. */
  skipped: number;
}

export class ImportFormatError extends Error {}

const num = (s: string | undefined) => {
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
};

const IMDB_TV = new Set(["tvseries", "tvminiseries", "tv series", "tv mini series", "tv mini-series"]);
const IMDB_MOVIE = new Set(["movie", "tvmovie", "tv movie", "short", "video"]);
const IMDB_SKIP = new Set(["tvepisode", "tv episode", "videogame", "video game", "podcastepisode", "podcast episode"]);

export function parseExport(text: string): ParsedImport {
  const { header, records } = parseCsvRecords(text);
  const has = (k: string) => header.includes(k);

  if (has("Const") && has("Your Rating")) {
    let skipped = 0;
    const rows: ImportRow[] = [];
    for (const r of records) {
      const type = (r["Title Type"] ?? "").toLowerCase();
      if (IMDB_SKIP.has(type) || !r.Title) {
        skipped++;
        continue;
      }
      rows.push({
        title: r.Title,
        originalTitle: r["Original Title"] || undefined,
        year: num(r.Year),
        rating10: num(r["Your Rating"]),
        imdbId: /^tt\d+$/.test(r.Const) ? r.Const : undefined,
        kind: IMDB_TV.has(type) ? "tv" : IMDB_MOVIE.has(type) ? "movie" : null,
      });
    }
    return { source: "imdb", rows, skipped };
  }

  if (has("Const") && !has("Your Rating")) {
    throw new ImportFormatError(
      "That looks like an IMDb list or watchlist. Export “Your ratings” instead, so we know what you liked.",
    );
  }

  if (has("Name") && has("Year") && (has("Letterboxd URI") || has("Date"))) {
    const rows = records
      .filter((r) => r.Name)
      .map((r): ImportRow => {
        const stars = num(r.Rating);
        return { title: r.Name, year: num(r.Year), rating10: stars === null ? null : stars * 2, kind: "movie" };
      });
    return { source: "letterboxd", rows, skipped: 0 };
  }

  throw new ImportFormatError(
    "We couldn't read that file. Use ratings.csv from a Letterboxd export, or the ratings CSV from IMDb.",
  );
}
