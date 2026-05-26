"""YouTube Takeout history parser and taste signal extractor.

Parses watch-history.json (JSON) or watch-history.html (HTML) files
exported from Google Takeout, extracting genre and keyword taste signals
to blend into the user's taste vector at 30% weight.
"""

from __future__ import annotations
import json
import logging
import re
from collections import Counter
from datetime import datetime
from typing import Optional

from app.models.media import (
    YouTubeChannelSignal,
    YouTubeImportResult,
    YouTubeTasteSignals,
    YouTubeVideoEntry,
)

logger = logging.getLogger(__name__)

MAX_VIDEOS = 500

STOPWORDS: set[str] = {
    "the", "is", "in", "it", "of", "and", "to", "a", "for", "on",
    "with", "as", "at", "by", "an", "be", "or", "not", "this",
    "that", "from", "but", "are", "was", "were", "we", "you",
    "i", "my", "me", "he", "she", "they", "his", "her", "its",
    "your", "our", "their", "all", "so", "if", "no", "up",
    "do", "can", "will", "just", "about", "has", "been", "had",
    "what", "which", "who", "how", "when", "where", "why",
    "than", "then", "there", "here", "out", "some", "one", "two",
    "new", "also", "get", "make", "like", "more", "only", "very",
    "been", "into", "over", "after", "back", "know", "see", "use",
    "way", "good", "first", "even", "much", "our", "too",
    "trailer", "official", "video", "clip", "part", "episode",
    "season", "full", "best", "song", "vs", "top", "music",
    "chapter", "review", "explained", "ending", "live", "hd",
    "movie", "4k", "1080p", "2020", "2021", "2022", "2023", "2024", "2025", "2026",
}

ANIME_KEYWORDS: set[str] = {
    "anime", "manga", "naruto", "one piece", "attack on titan",
    "demon slayer", "jujutsu kaisen", "dragon ball", "my hero academia",
    "chainsaw man", "spy x family", "bleach", "tokyo ghoul",
    "sword art online", "fullmetal alchemist", "death note",
    "hunter x hunter", "one punch man", "re zero", "code geass",
    "steins gate", "violet evergarden", "kimi no na wa",
    "your name", "ghibli", "studio ghibli", "aot", "evangelion",
    "gundam", "fate", "isekai",
}

GENRE_KEYWORD_MAP: dict[str, str] = {
    "action": "action",
    "adventure": "adventure",
    "comedy": "comedy",
    "funny": "comedy",
    "laugh": "comedy",
    "drama": "drama",
    "romance": "romance",
    "love story": "romance",
    "horror": "horror",
    "scary": "horror",
    "thriller": "thriller",
    "suspense": "thriller",
    "mystery": "mystery",
    "sci fi": "science fiction",
    "science fiction": "science fiction",
    "scifi": "science fiction",
    "fantasy": "fantasy",
    "documentary": "documentary",
    "crime": "crime",
    "true crime": "crime",
    "war": "war",
    "historical": "history",
    "history": "history",
    "western": "western",
    "musical": "music",
    "music": "music",
    "superhero": "action",
    "marvel": "action",
    "dc comics": "action",
}


def _slugify(text: str) -> str:
    return re.sub(r"[^a-z0-9]+", " ", text.lower()).strip()


def _extract_tokens(title: str) -> list[str]:
    tokens = re.findall(r"[a-z]+", title.lower())
    return [t for t in tokens if t not in STOPWORDS and len(t) > 1]


def parse_json_history(content: str) -> list[YouTubeVideoEntry]:
    try:
        data = json.loads(content)
    except (json.JSONDecodeError, ValueError):
        return []
    entries: list[YouTubeVideoEntry] = []

    if isinstance(data, dict):
        # Top-level key is often hidden
        items = data if isinstance(data, list) else data.get("items", [])
        if items:
            data = items

    if not isinstance(data, list):
        return []

    seen_titles: set[str] = set()

    for item in data:
        if not isinstance(item, dict):
            continue

        title = item.get("title") or item.get("titleUrl") or ""
        if not title:
            continue

        if "Watched a video that has been removed" in title:
            title = title.replace("Watched a video that has been removed: ", "")

        # Extract from subtitles if present
        subtitles = item.get("subtitles", [])
        channel_name = ""
        for sub in subtitles:
            name = sub.get("name", "")
            if name:
                channel_name = name
                break

        if not channel_name:
            header = item.get("header") or ""
            channel_name = header

        time_str = item.get("time") or ""
        watch_date = time_str[:10] if time_str else None

        key = title.lower().strip()
        if key in seen_titles:
            continue
        seen_titles.add(key)

        entries.append(YouTubeVideoEntry(
            title=title,
            channel_name=channel_name,
            watch_date=watch_date,
        ))

        if len(entries) >= MAX_VIDEOS:
            break

    return entries


def parse_html_history(content: str) -> list[YouTubeVideoEntry]:
    try:
        from bs4 import BeautifulSoup
    except ImportError:
        raise ImportError(
            "BeautifulSoup4 is required for HTML parsing. "
            "Install with: pip install beautifulsoup4"
        )

    soup = BeautifulSoup(content, "html.parser")
    entries: list[YouTubeVideoEntry] = []
    seen_titles: set[str] = set()

    cells = soup.select("div.content-cell")
    if not cells:
        cells = soup.find_all("div", class_="mdl-grid") or []

    for cell in cells:
        text = cell.get_text("\n", strip=True)
        lines = [l.strip() for l in text.split("\n") if l.strip()]

        if len(lines) < 2:
            continue

        title = ""
        channel_name = ""
        watch_date = None

        # First line is usually the title
        for line in lines:
            if "Watched" not in line and "https://" not in line:
                title = line
                break

        if not title:
            title = lines[0]

        if "Watched" in title:
            title = title.replace("Watched", "").strip()

        # Try to extract channel and date
        for line in lines:
            for ch_prefix in ["Channel:", "channel:"]:
                if ch_prefix in line:
                    channel_name = line.split(ch_prefix, 1)[1].strip()
            if not channel_name and ":" not in line and line != title:
                channel_name = line

        # Try to extract date
        date_match = re.search(r"(\d{1,2}\s+\w+\s+\d{4})", text)
        if date_match:
            try:
                dt = datetime.strptime(date_match.group(1), "%d %b %Y")
                watch_date = dt.strftime("%Y-%m-%d")
            except ValueError:
                pass

        key = title.lower().strip()
        if key in seen_titles:
            continue
        seen_titles.add(key)

        entries.append(YouTubeVideoEntry(
            title=title,
            channel_name=channel_name,
            watch_date=watch_date,
        ))

        if len(entries) >= MAX_VIDEOS:
            break

    return entries


def extract_taste_signals(entries: list[YouTubeVideoEntry]) -> YouTubeTasteSignals:
    all_tokens: list[str] = []
    all_titles: list[str] = []
    channel_counter: Counter = Counter()
    anime_count = 0

    for entry in entries:
        tokens = _extract_tokens(entry.title)
        all_tokens.extend(tokens)
        all_titles.append(entry.title.lower())
        if entry.channel_name:
            channel_counter[entry.channel_name] += 1

    # Anime detection
    for title in all_titles:
        for ak in ANIME_KEYWORDS:
            if ak in title:
                anime_count += 1
                break

    anime_ratio = anime_count / max(len(entries), 1)
    animation_affinity_delta = min(anime_ratio * 2.0, 1.0)

    # Genre extraction from titles
    title_text = " ".join(all_titles)
    genre_counts: dict[str, int] = {}
    for keyword, genre in GENRE_KEYWORD_MAP.items():
        count = title_text.count(keyword)
        if count > 0:
            genre_counts[genre] = genre_counts.get(genre, 0) + count

    total_genre_hits = sum(genre_counts.values()) or 1
    genres_extracted: dict[str, float] = {}
    for genre, count in genre_counts.items():
        genres_extracted[genre] = round(count / total_genre_hits, 2)

    # Keyword extraction from tokens (frequency)
    token_counts = Counter(all_tokens)
    top_tokens = token_counts.most_common(40)
    total_tokens = len(all_tokens) or 1

    keywords_extracted: dict[str, float] = {}
    for token, count in top_tokens:
        if token not in STOPWORDS and len(token) > 2:
            keywords_extracted[_slugify(token)] = round(count / total_tokens, 4)

    # Top channels
    top_channels = [
        YouTubeChannelSignal(channel_name=name, watch_count=count)
        for name, count in channel_counter.most_common(20)
    ]

    videos_with_signals = sum(
        1 for title in all_titles
        if any(kw in title for kw in GENRE_KEYWORD_MAP)
    )

    return YouTubeTasteSignals(
        genres_extracted=genres_extracted,
        keywords_extracted=keywords_extracted,
        animation_affinity_delta=animation_affinity_delta,
        top_channels=top_channels,
        total_videos_parsed=len(entries),
        videos_with_signals=videos_with_signals,
    )
