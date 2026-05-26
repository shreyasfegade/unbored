"""TMDB API constants. Imported by tmdb_service.py. Do not hardcode these values elsewhere."""

TMDB_BASE_URL = "https://api.themoviedb.org/3"
TMDB_IMAGE_BASE_URL = "https://image.tmdb.org/t/p/"

# Image sizes used by Unbored
POSTER_SIZE_DISPLAY = "w500"
POSTER_SIZE_THUMB = "w185"
BACKDROP_SIZE_DISPLAY = "w780"
BACKDROP_SIZE_THUMB = "w342"

# Placeholder when poster_path is null
POSTER_PLACEHOLDER = "/placeholder-poster.svg"

# Cache TTLs in seconds
CACHE_TTL_POOL = 6 * 60 * 60        # 6 hours — candidate pool data
CACHE_TTL_DETAIL = 24 * 60 * 60     # 24 hours — movie/tv details
CACHE_TTL_GENRE = float("inf")      # forever — genre maps load on startup

# Rate limiting & concurrent connection limits
MAX_CONCURRENT_REQUESTS = 4          # asyncio.Semaphore capacity
MAX_RETRIES = 3
RETRY_BASE_DELAY = 1.0              # seconds, doubles on each retry

# Candidate pool pages to fetch
POPULAR_MOVIE_PAGES = 5              # 100 movies
TOP_RATED_MOVIE_PAGES = 3            # 60 movies
POPULAR_TV_PAGES = 3                 # 60 TV shows
TRENDING_MOVIE_PAGES = 1             # 20 movies
TRENDING_TV_PAGES = 1                # 20 TV shows

# Candidate rating filters
MIN_VOTE_AVERAGE = 7.0
MIN_VOTE_COUNT = 100
