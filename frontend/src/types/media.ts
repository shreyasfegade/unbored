export type MediaSource = "tmdb_movie" | "tmdb_tv" | "anilist";
export type MediaType = "movie" | "tv" | "anime";

export interface MediaItem {
  id: string;
  source: MediaSource;
  tmdb_id?: number;
  anilist_id?: number;
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
  status: string;
  popularity: number;
  cast: string[];
  director: string | null;
  studio: string | null;
  release_date: string | null;
  year: number | null;
  episode_count: number | null;
  source_api: string;
}

export interface YouTubeChannelSignal {
  channel_name: string;
  watch_count: number;
  inferred_genres: string[];
}

export interface YouTubeImportResult {
  total_videos_parsed: number;
  videos_with_signals: number;
  top_channels: YouTubeChannelSignal[];
  extracted_genres: Record<string, number>;
  extracted_keywords: Record<string, number>;
  animation_affinity_delta: number;
  success: boolean;
  error: string | null;
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
