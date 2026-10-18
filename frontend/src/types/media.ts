export type MediaSource = "tmdb_movie" | "tmdb_tv" | "anilist";
export type MediaType = "movie" | "tv" | "anime";

/** Where a title streams in one region (TMDB watch providers, data by JustWatch). */
export interface WatchProvider {
  provider_id: number;
  name: string;
  logo_path: string | null;
}

export interface WatchRegion {
  link?: string | null;
  flatrate?: WatchProvider[];
  rent?: WatchProvider[];
  buy?: WatchProvider[];
  /** AniList streaming links: not region-checked. */
  streaming?: Array<{ site: string; url: string }>;
}

export interface MediaItem {
  id: string;
  source: MediaSource;
  tmdb_id?: number | null;
  anilist_id?: number | null;
  imdb_id?: string | null;
  title: string;
  original_title: string;
  overview: string;
  poster_path: string | null;
  backdrop_path: string | null;
  genres: string[];
  keywords: string[];
  vote_average: number;
  vote_count: number;
  runtime_minutes: number | null;
  release_year: number | null;
  media_type: MediaType;
  popularity_norm?: number;
  franchise?: string | null;
  cast: string[];
  director: string | null;
  studio: string | null;
  episode_count: number | null;
  /** ISO date the title first entered the catalog. */
  added_at?: string | null;
  watch?: Record<string, WatchRegion> | null;
  trailer?: { site: string; key: string } | null;
  // Legacy API fields. The browser pack folds `year` into release_year and
  // drops the rest; kept optional so older payloads still type-check.
  status?: string;
  popularity?: number;
  release_date?: string | null;
  year?: number | null;
  source_api?: string;
}

export interface SearchResults {
  query: string;
  results: MediaItem[];
  total_results: number;
  sources: MediaSource[];
}

export interface TMDBMovie {
  id: number;
  title: string;
  original_title: string;
  overview: string;
  poster_path: string | null;
  backdrop_path: string | null;
  genre_ids: number[];
  genres?: Array<{ id: number; name: string }>;
  vote_average: number;
  vote_count: number;
  runtime?: number | null;
  release_date: string;
  status?: string;
  popularity: number;
  adult: boolean;
  original_language: string;
  video: boolean;
}

export interface TMDBKeywordsResponse {
  id: number;
  keywords: Array<{ id: number; name: string }>;
}

export interface TMDBTVShow {
  id: number;
  name: string;
  original_name: string;
  overview: string;
  poster_path: string | null;
  backdrop_path: string | null;
  genre_ids: number[];
  genres?: Array<{ id: number; name: string }>;
  vote_average: number;
  vote_count: number;
  episode_run_time?: number[];
  first_air_date: string;
  status?: string;
  popularity: number;
  original_language: string;
  number_of_seasons?: number;
  number_of_episodes?: number;
}

export interface TMDBTVKeywordsResponse {
  id: number;
  results: Array<{ id: number; name: string }>;
}

export interface TMDBMultiSearchResult {
  id: number;
  media_type: "movie" | "tv" | "person";
  title?: string;
  original_title?: string;
  release_date?: string;
  runtime?: number | null;
  name?: string;
  original_name?: string;
  first_air_date?: string;
  episode_run_time?: number[];
  overview?: string;
  poster_path?: string | null;
  backdrop_path?: string | null;
  genre_ids?: number[];
  vote_average?: number;
  vote_count?: number;
  popularity?: number;
  adult?: boolean;
  original_language?: string;
}

export interface AniListTitle {
  english: string | null;
  romaji: string;
  native: string | null;
}

export interface AniListCoverImage {
  large: string | null;
  extraLarge: string | null;
}

export interface AniListAnime {
  id: number;
  title: AniListTitle;
  description: string | null;
  coverImage: AniListCoverImage;
  bannerImage: string | null;
  genres: string[];
  averageScore: number | null;
  meanScore: number | null;
  popularity: number;
  favourites: number;
  duration: number | null;
  episodes: number | null;
  seasonYear: number | null;
  status: string | null;
  format: string | null;
}
