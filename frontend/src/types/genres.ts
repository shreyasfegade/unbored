export const TMDB_MOVIE_GENRE_MAP: Record<number, string> = {
  28: "Action",
  12: "Adventure",
  16: "Animation",
  35: "Comedy",
  80: "Crime",
  99: "Documentary",
  18: "Drama",
  10751: "Family",
  14: "Fantasy",
  36: "History",
  27: "Horror",
  10402: "Music",
  9648: "Mystery",
  10749: "Romance",
  878: "Science Fiction",
  10770: "TV Movie",
  53: "Thriller",
  10752: "War",
  37: "Western",
};

export const TMDB_TV_GENRE_MAP: Record<number, string> = {
  10759: "Action & Adventure",
  16: "Animation",
  35: "Comedy",
  80: "Crime",
  99: "Documentary",
  18: "Drama",
  10751: "Family",
  10762: "Kids",
  9648: "Mystery",
  10763: "News",
  10764: "Reality",
  10765: "Sci-Fi & Fantasy",
  10766: "Soap",
  10767: "Talk",
  10768: "War & Politics",
  37: "Western",
};

export const ANILIST_GENRES = [
  "Action",
  "Adventure",
  "Comedy",
  "Drama",
  "Ecchi",
  "Fantasy",
  "Horror",
  "Mahou Shoujo",
  "Mecha",
  "Music",
  "Mystery",
  "Psychological",
  "Romance",
  "Sci-Fi",
  "Slice of Life",
  "Sports",
  "Supernatural",
  "Thriller",
] as const;

export type AniListGenre = (typeof ANILIST_GENRES)[number];

export const ALL_NORMALIZED_GENRES = [
  "action",
  "adventure",
  "animation",
  "comedy",
  "crime",
  "documentary",
  "drama",
  "ecchi",
  "family",
  "fantasy",
  "history",
  "horror",
  "kids",
  "mahou shoujo",
  "mecha",
  "music",
  "mystery",
  "news",
  "psychological",
  "reality",
  "romance",
  "sci-fi",
  "slice of life",
  "soap",
  "sports",
  "supernatural",
  "talk",
  "thriller",
  "tv movie",
  "war",
  "western",
] as const;

export type NormalizedGenre = (typeof ALL_NORMALIZED_GENRES)[number];

export function normalizeGenre(raw: string): string[] {
  const lower = raw.toLowerCase().trim();

  if (lower === "action & adventure") return ["action", "adventure"];
  if (lower === "sci-fi & fantasy") return ["sci-fi", "fantasy"];
  if (lower === "war & politics") return ["war"];

  if (lower === "science fiction") return ["sci-fi"];

  return [lower];
}
