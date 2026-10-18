"""Build-time enrichments pulled out of raw TMDB / AniList responses.

Pure functions over the JSON the APIs return, so the catalog builder can attach
where-to-watch, a trailer and an IMDb id without extra requests (TMDB detail
calls ask for them through append_to_response) and the tests need no network.
"""

from __future__ import annotations

from typing import Any

WATCH_REGIONS = ("IN",)
_KINDS = ("flatrate", "rent", "buy")


def _provider(p: dict[str, Any]) -> dict[str, Any] | None:
    pid, name = p.get("provider_id"), p.get("provider_name")
    if pid is None or not name:
        return None
    return {"id": pid, "name": name, "logo": p.get("logo_path")}


def tmdb_watch(data: dict[str, Any], regions: tuple[str, ...] = WATCH_REGIONS) -> dict | None:
    """`watch/providers` (appended to a detail call) → {region: {link, flatrate, rent, buy}}.

    Only the regions we show are kept. A region with no providers at all is
    dropped, so "no entry" always means "not streaming there"."""
    results = ((data.get("watch/providers") or {}).get("results")) or {}
    out: dict[str, Any] = {}
    for region in regions:
        r = results.get(region)
        if not r:
            continue
        entry: dict[str, Any] = {"link": r.get("link")}
        for kind in _KINDS:
            ranked = sorted(r.get(kind) or [], key=lambda p: p.get("display_priority", 999))
            provs = [x for x in (_provider(p) for p in ranked) if x]
            if provs:
                entry[kind] = provs
        if any(k in entry for k in _KINDS):
            out[region] = entry
    return out or None


def tmdb_trailer(data: dict[str, Any]) -> dict | None:
    """The best YouTube trailer from appended `videos`: official trailers first,
    then any trailer, then a teaser."""
    vids = [
        v for v in ((data.get("videos") or {}).get("results") or [])
        if v.get("site") == "YouTube" and v.get("key") and v.get("type") in ("Trailer", "Teaser")
    ]
    if not vids:
        return None
    # Newest first, then the stable sort keeps that order among equal ranks.
    vids.sort(key=lambda v: v.get("published_at", ""), reverse=True)
    vids.sort(key=lambda v: (v["type"] != "Trailer", not v.get("official")))
    best = vids[0]
    return {"site": "youtube", "key": best["key"]}


def tmdb_imdb_id(data: dict[str, Any]) -> str | None:
    """The IMDb id from appended `external_ids` (movies also carry it top-level)."""
    raw = (data.get("external_ids") or {}).get("imdb_id") or data.get("imdb_id")
    return raw if isinstance(raw, str) and raw.startswith("tt") else None


def anilist_trailer(media: dict[str, Any]) -> dict | None:
    t = media.get("trailer") or {}
    if (t.get("site") or "").lower() == "youtube" and t.get("id"):
        return {"site": "youtube", "key": t["id"]}
    return None


def anilist_watch(media: dict[str, Any]) -> dict | None:
    """AniList's STREAMING links. AniList doesn't say which countries a link
    works in, so it's stored as region "any" and the UI labels it unchecked."""
    links = []
    seen: set[str] = set()
    for link in media.get("externalLinks") or []:
        if link.get("type") != "STREAMING" or not link.get("url") or not link.get("site"):
            continue
        if link["site"] in seen:
            continue
        seen.add(link["site"])
        links.append({"name": link["site"], "url": link["url"]})
    return {"any": {"links": links}} if links else None
