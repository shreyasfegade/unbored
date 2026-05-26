from __future__ import annotations
from enum import StrEnum
from pydantic import BaseModel, Field

class MediaSource(StrEnum):
    TMDB_MOVIE = "tmdb_movie"
    TMDB_TV = "tmdb_tv"
    ANILIST = "anilist"

class MediaType(StrEnum):
    MOVIE = "movie"
    TV = "tv"
    ANIME = "anime"

class MediaItem(BaseModel):
    id: str = Field(
        ...,
        description='Composite ID: "tmdb_<id>" or "al_<id>"',
        examples=["tmdb_550", "al_21"],
    )
    source: MediaSource
    tmdb_id: int | None = None
    anilist_id: int | None = None
    title: str
    original_title: str
    overview: str = ""
    poster_path: str | None = None
    backdrop_path: str | None = None
    genres: list[str] = Field(
        default_factory=list,
        description="Normalized genre strings (lowercase)",
    )
    keywords: list[str] = Field(
        default_factory=list,
        description="TMDB keyword slugs. Empty for AniList.",
    )
    vote_average: float = Field(
        default=0.0, ge=0.0, le=10.0,
        description="Rating on 0–10 scale",
    )
    vote_count: int = Field(default=0, ge=0)
    runtime_minutes: int | None = Field(
        default=None, ge=1,
        description="Duration in minutes. null if unknown.",
    )
    release_year: int | None = Field(
        default=None, ge=1900, le=2100,
    )
    media_type: MediaType
    status: str = ""
    popularity: float = Field(default=0.0, ge=0.0)
    cast: list[str] = Field(default_factory=list, max_length=5)
    director: str | None = None
    studio: str | None = None
    release_date: str | None = None
    year: int | None = None
    episode_count: int | None = None
    source_api: str = "tmdb"

    @property
    def inferred_emotional_intensity(self) -> float:
        genres = set(self.genres)
        score = 0.3
        if "drama" in genres:
            score += 0.2
        if "war" in genres or "history" in genres:
            score += 0.1
        if self.runtime_minutes and self.runtime_minutes > 120:
            score += 0.15
        if self.vote_average > 8.0:
            score += 0.1
        return max(0.0, min(1.0, score))

    @property
    def inferred_pacing(self) -> str:
        genres = set(self.genres)
        fast_genres = {"action", "thriller", "adventure"}
        slow_genres = {"drama", "documentary", "romance"}
        has_fast = bool(genres & fast_genres)
        has_slow = bool(genres & slow_genres)
        if has_fast and not has_slow:
            return "fast"
        if has_slow and not has_fast:
            return "slow"
        return "mixed"

    @property
    def inferred_darkness(self) -> float:
        genres = set(self.genres)
        score = 0.3
        if "horror" in genres:
            score += 0.3
        if "crime" in genres or "thriller" in genres:
            score += 0.2
        if "war" in genres:
            score += 0.1
        if "comedy" in genres or "family" in genres or "animation" in genres:
            score -= 0.15
        return max(0.0, min(1.0, score))

class SearchResults(BaseModel):
    query: str
    results: list[MediaItem] = Field(default_factory=list)
    total_results: int = Field(default=0, ge=0)
    sources: list[MediaSource] = Field(default_factory=list)


class SearchResponse(BaseModel):
    results: list[MediaItem] = Field(default_factory=list, max_length=20)
    total_results: int = Field(default=0, ge=0)
    query: str

class YouTubeChannelSignal(BaseModel):
    channel_name: str
    watch_count: int = Field(ge=1)
    inferred_genres: list[str] = Field(default_factory=list)

class YouTubeImportResult(BaseModel):
    total_videos_parsed: int = Field(ge=0)
    videos_with_signals: int = Field(ge=0)
    top_channels: list[YouTubeChannelSignal] = Field(
        default_factory=list,
        description="Top 20 channels by watch count",
    )
    genres_extracted: dict[str, float] = Field(default_factory=dict)
    keywords_extracted: dict[str, float] = Field(default_factory=dict)
    animation_affinity_delta: float = Field(
        default=0.0, ge=-1.0, le=1.0,
        description="Change to animation_affinity. Positive = increase.",
    )
    success: bool = True
    error: str | None = None


class YouTubeVideoEntry(BaseModel):
    title: str
    channel_name: str
    watch_date: str | None = None


class YouTubeTasteSignals(BaseModel):
    genres_extracted: dict[str, float] = Field(default_factory=dict)
    keywords_extracted: dict[str, float] = Field(default_factory=dict)
    animation_affinity_delta: float = Field(default=0.0, ge=-1.0, le=1.0)
    top_channels: list[YouTubeChannelSignal] = Field(default_factory=list)
    total_videos_parsed: int = 0
    videos_with_signals: int = 0

class TMDBMovie(BaseModel):
    id: int
    title: str = ""
    original_title: str = ""
    overview: str = ""
    poster_path: str | None = None
    backdrop_path: str | None = None
    genre_ids: list[int] = Field(default_factory=list)
    genres: list[dict] | None = None
    vote_average: float = 0.0
    vote_count: int = 0
    runtime: int | None = None
    release_date: str = ""
    status: str | None = None
    popularity: float = 0.0
    adult: bool = False
    original_language: str = ""
    video: bool = False

class TMDBTVShow(BaseModel):
    id: int
    name: str = ""
    original_name: str = ""
    overview: str = ""
    poster_path: str | None = None
    backdrop_path: str | None = None
    genre_ids: list[int] = Field(default_factory=list)
    genres: list[dict] | None = None
    vote_average: float = 0.0
    vote_count: int = 0
    episode_run_time: list[int] = Field(default_factory=list)
    first_air_date: str = ""
    status: str | None = None
    popularity: float = 0.0
    original_language: str = ""
    number_of_seasons: int | None = None
    number_of_episodes: int | None = None

class TMDBKeywordsResponse(BaseModel):
    id: int
    keywords: list[dict] = Field(default_factory=list)

class TMDBTVKeywordsResponse(BaseModel):
    id: int
    results: list[dict] = Field(default_factory=list)

class AniListTitle(BaseModel):
    english: str | None = None
    romaji: str
    native: str | None = None

class AniListCoverImage(BaseModel):
    large: str | None = None
    extraLarge: str | None = None

class AniListAnime(BaseModel):
    id: int
    title: AniListTitle
    description: str | None = None
    coverImage: AniListCoverImage = Field(default_factory=AniListCoverImage)
    bannerImage: str | None = None
    genres: list[str] = Field(default_factory=list)
    averageScore: int | None = None
    meanScore: int | None = None
    popularity: int = 0
    favourites: int = 0
    duration: int | None = None
    episodes: int | None = None
    seasonYear: int | None = None
    status: str | None = None
    format: str | None = None
