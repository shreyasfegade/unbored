from pydantic_settings import BaseSettings

class Settings(BaseSettings):
    tmdb_api_key: str
    tmdb_base_url: str = "https://api.themoviedb.org/3"
    anilist_base_url: str = "https://graphql.anilist.co"
    gemini_api_key: str = ""
    gemini_model: str = "gemini-2.0-flash"
    gemini_base_url: str = "https://generativelanguage.googleapis.com/v1beta"
    gemini_timeout_seconds: float = 5.0
    gemini_cache_ttl_seconds: int = 3600
    storage_dir: str = "./data"
    cors_origins: str = "http://localhost:5173"
    log_level: str = "INFO"
    candidate_pool_size: int = 500
    pool_refresh_hours: int = 6

    class Config:
        env_file = ".env"
        env_file_encoding = "utf-8"

settings = Settings()
