from pydantic import BaseModel, Field

class TMDBGenre(BaseModel):
    id: int
    name: str

class TMDBKeyword(BaseModel):
    id: int
    name: str

class TMDBCastMember(BaseModel):
    id: int
    name: str
    character: str = ""
    known_for_department: str = ""
    order: int = 0

class TMDBCrewMember(BaseModel):
    id: int
    name: str
    job: str = ""
    department: str = ""

class TMDBCredits(BaseModel):
    cast: list[TMDBCastMember] = Field(default_factory=list)
    crew: list[TMDBCrewMember] = Field(default_factory=list)

class TMDBProductionCompany(BaseModel):
    id: int
    name: str
    origin_country: str = ""

class TMDBNetwork(BaseModel):
    id: int
    name: str
    origin_country: str = ""

class TMDBMovieListItem(BaseModel):
    id: int
    title: str
    overview: str = ""
    poster_path: str | None = None
    backdrop_path: str | None = None
    genre_ids: list[int] = Field(default_factory=list)
    vote_average: float = 0.0
    vote_count: int = 0
    release_date: str = ""
    popularity: float = 0.0

class TMDBTVListItem(BaseModel):
    id: int
    name: str
    overview: str = ""
    poster_path: str | None = None
    backdrop_path: str | None = None
    genre_ids: list[int] = Field(default_factory=list)
    vote_average: float = 0.0
    vote_count: int = 0
    first_air_date: str = ""
    popularity: float = 0.0

class TMDBMovieListResponse(BaseModel):
    page: int
    results: list[TMDBMovieListItem]
    total_pages: int
    total_results: int

class TMDBTVListResponse(BaseModel):
    page: int
    results: list[TMDBTVListItem]
    total_pages: int
    total_results: int

class TMDBMovieKeywords(BaseModel):
    keywords: list[TMDBKeyword] = Field(default_factory=list)

class TMDBMovieDetail(BaseModel):
    id: int
    title: str
    overview: str = ""
    poster_path: str | None = None
    backdrop_path: str | None = None
    genres: list[TMDBGenre] = Field(default_factory=list)
    vote_average: float = 0.0
    vote_count: int = 0
    release_date: str = ""
    popularity: float = 0.0
    runtime: int | None = None
    status: str = ""
    keywords: TMDBMovieKeywords = Field(default_factory=TMDBMovieKeywords)
    credits: TMDBCredits = Field(default_factory=TMDBCredits)
    production_companies: list[TMDBProductionCompany] = Field(default_factory=list)

class TMDBTVKeywords(BaseModel):
    results: list[TMDBKeyword] = Field(default_factory=list)

class TMDBTVDetail(BaseModel):
    id: int
    name: str
    overview: str = ""
    poster_path: str | None = None
    backdrop_path: str | None = None
    genres: list[TMDBGenre] = Field(default_factory=list)
    vote_average: float = 0.0
    vote_count: int = 0
    first_air_date: str = ""
    popularity: float = 0.0
    episode_run_time: list[int] = Field(default_factory=list)
    status: str = ""
    keywords: TMDBTVKeywords = Field(default_factory=TMDBTVKeywords)
    credits: TMDBCredits = Field(default_factory=TMDBCredits)
    production_companies: list[TMDBProductionCompany] = Field(default_factory=list)
    networks: list[TMDBNetwork] = Field(default_factory=list)
    number_of_episodes: int | None = None

class TMDBSearchResultItem(BaseModel):
    id: int
    media_type: str
    title: str | None = None
    name: str | None = None
    release_date: str | None = None
    first_air_date: str | None = None
    overview: str = ""
    poster_path: str | None = None
    backdrop_path: str | None = None
    genre_ids: list[int] = Field(default_factory=list)
    vote_average: float = 0.0
    vote_count: int = 0
    popularity: float = 0.0

class TMDBSearchMultiResponse(BaseModel):
    page: int
    results: list[TMDBSearchResultItem]
    total_pages: int
    total_results: int

class TMDBMovieKeywordsResponse(BaseModel):
    id: int
    keywords: list[TMDBKeyword] = Field(default_factory=list)

class TMDBTVKeywordsResponse(BaseModel):
    id: int
    results: list[TMDBKeyword] = Field(default_factory=list)

class TMDBGenreListResponse(BaseModel):
    genres: list[TMDBGenre]
