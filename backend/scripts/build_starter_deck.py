"""Generate the frontend's bundled starter deck.

The backend sleeps on the free tier and can take ~50s to wake. The wake screen
fills that time by letting the visitor swipe titles — which only works if those
titles ship with the frontend, since the API is by definition unavailable. Poster
images come from the public TMDB/AniList CDNs, so the deck renders fully with the
backend still down.

Run from the backend directory:  python scripts/build_starter_deck.py
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.models.media import MediaType  # noqa: E402
from app.services.catalog import load_catalog  # noqa: E402

OUT = (
    Path(__file__).resolve().parents[2]
    / "frontend" / "src" / "data" / "starter-deck.json"
)

SIZE = 60
# Recognisable titles judge fastest, but a deck of one genre reads as broken.
QUOTAS = {MediaType.MOVIE: 28, MediaType.TV: 16, MediaType.ANIME: 16}
MAX_PER_GENRE = 8


def build() -> list[dict]:
    catalog = [c for c in load_catalog() if c.poster_path]
    catalog.sort(key=lambda c: c.popularity, reverse=True)

    picked: list[dict] = []
    per_type: dict[MediaType, int] = {t: 0 for t in QUOTAS}
    per_genre: dict[str, int] = {}

    for item in catalog:
        if len(picked) >= SIZE:
            break
        mt = item.media_type
        if per_type.get(mt, 0) >= QUOTAS.get(mt, 0):
            continue
        lead = (item.genres[0].lower() if item.genres else "other")
        if per_genre.get(lead, 0) >= MAX_PER_GENRE:
            continue
        per_type[mt] += 1
        per_genre[lead] = per_genre.get(lead, 0) + 1
        picked.append(
            {
                "id": item.id,
                "title": item.title,
                "poster_path": item.poster_path,
                "genres": item.genres[:2],
                "release_year": item.release_year or item.year,
                "media_type": mt.value,
            }
        )

    return picked


def main() -> None:
    deck = build()
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(deck, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"Wrote {len(deck)} titles to {OUT.relative_to(OUT.parents[3])}")


if __name__ == "__main__":
    main()
