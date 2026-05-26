"""Unit tests for YouTube service parsing and signal extraction."""

import pytest

from app.models.taste import EnrichmentSource, UserTasteVector
from app.services.taste_builder import merge_youtube_signals
from app.services.youtube_service import (
    extract_taste_signals,
    parse_html_history,
    parse_json_history,
)

JSON_FIXTURE = """
[{
  "title": "Watched Top 10 Action Movies of 2024",
  "titleUrl": "https://www.youtube.com/watch?v=abc123",
  "subtitles": [{"name": "Screen Rant"}],
  "time": "2024-05-15T12:00:00Z"
}]
"""

JSON_FIXTURE_ALT = """
[{
  "header": "Action",
  "title": "Best Action Adventure Movies Compilation",
  "time": "2024-03-10T08:00:00Z"
}]
"""

HTML_FIXTURE = """
<div class="content-cell mdl-cell mdl-cell--6-col mdl-typography--body-1">
Watched<br>
Inception - Best Scenes<br>
<a href="https://www.youtube.com/watch?v=xyz">YouTube</a><br>
MovieClips<br>
15 May 2024
</div>
"""


class TestParseJsonHistory:

    def test_parse_valid_json(self):
        entries = parse_json_history(JSON_FIXTURE)
        assert len(entries) == 1
        assert "Top 10 Action Movies" in entries[0].title
        assert entries[0].channel_name == "Screen Rant"
        assert entries[0].watch_date == "2024-05-15"

    def test_parse_json_with_header_fallback(self):
        entries = parse_json_history(JSON_FIXTURE_ALT)
        assert len(entries) == 1
        assert entries[0].channel_name == "Action"
        assert entries[0].title == "Best Action Adventure Movies Compilation"

    def test_deduplicate_by_title(self):
        content = """[{"title": "A", "subtitles": [{"name": "C1"}]}, {"title": "A", "subtitles": [{"name": "C2"}]}]"""
        entries = parse_json_history(content)
        assert len(entries) == 1

    def test_cap_at_500(self):
        import json
        items = [{"title": f"Video {i}", "subtitles": [{"name": f"Chan {i}"}]} for i in range(1000)]
        entries = parse_json_history(json.dumps(items))
        assert len(entries) == 500

    def test_parse_invalid_json(self):
        entries = parse_json_history("not json")
        assert entries == []


class TestParseHtmlHistory:

    def test_parse_html(self):
        entries = parse_html_history(HTML_FIXTURE)
        assert len(entries) == 1
        assert "Inception" in entries[0].title


class TestExtractTasteSignals:

    def test_genre_detection(self):
        from app.models.media import YouTubeVideoEntry
        entries = [
            YouTubeVideoEntry(title="Top Action Movies", channel_name="C1"),
            YouTubeVideoEntry(title="Best Comedy of 2024", channel_name="C2"),
            YouTubeVideoEntry(title="Romantic Drama Scenes", channel_name="C3"),
        ]
        signals = extract_taste_signals(entries)
        assert signals.genres_extracted.get("action", 0) > 0
        assert signals.genres_extracted.get("comedy", 0) > 0
        assert signals.genres_extracted.get("drama", 0) > 0

    def test_anime_detection(self):
        from app.models.media import YouTubeVideoEntry
        entries = [
            YouTubeVideoEntry(title="Naruto Best Moments", channel_name="C1"),
            YouTubeVideoEntry(title="Attack on Titan Review", channel_name="C2"),
            YouTubeVideoEntry(title="Demon Slayer Ep 1", channel_name="C3"),
            YouTubeVideoEntry(title="Regular Movie", channel_name="C4"),
        ]
        signals = extract_taste_signals(entries)
        assert signals.animation_affinity_delta > 0.0

    def test_keywords_extracted(self):
        from app.models.media import YouTubeVideoEntry
        entries = [
            YouTubeVideoEntry(title="Inception Ending Explained", channel_name="C1"),
            YouTubeVideoEntry(title="Interstellar Black Hole Scene", channel_name="C2"),
            YouTubeVideoEntry(title="The Batman Story Breakdown", channel_name="C3"),
        ]
        signals = extract_taste_signals(entries)
        assert len(signals.keywords_extracted) > 0

    def test_top_channels(self):
        from app.models.media import YouTubeVideoEntry
        entries = [
            YouTubeVideoEntry(title="Video 1", channel_name="Channel A"),
            YouTubeVideoEntry(title="Video 2", channel_name="Channel A"),
            YouTubeVideoEntry(title="Video 3", channel_name="Channel B"),
        ]
        signals = extract_taste_signals(entries)
        assert len(signals.top_channels) == 2
        assert signals.top_channels[0].channel_name == "Channel A"
        assert signals.top_channels[0].watch_count == 2

    def test_videos_with_signals_count(self):
        from app.models.media import YouTubeVideoEntry
        entries = [
            YouTubeVideoEntry(title="Action Movie Compilation", channel_name="C1"),
            YouTubeVideoEntry(title="Just a random video", channel_name="C2"),
        ]
        signals = extract_taste_signals(entries)
        assert signals.videos_with_signals >= 1


class TestMergeYouTubeSignals:

    def test_blend_genres_at_30_pct(self):
        from app.models.media import YouTubeTasteSignals
        vector = UserTasteVector(
            id="test123",
            genres={"action": 0.5},
        )
        signals = YouTubeTasteSignals(
            genres_extracted={"action": 0.8},
            keywords_extracted={},
        )
        merge_youtube_signals(vector, signals)
        # 0.5 * 0.7 + 0.8 * 0.3 = 0.35 + 0.24 = 0.59
        assert vector.genres["action"] == pytest.approx(0.59)

    def test_adds_enrichment_source(self):
        from app.models.media import YouTubeTasteSignals
        vector = UserTasteVector(id="test456")
        signals = YouTubeTasteSignals()
        merge_youtube_signals(vector, signals)
        assert EnrichmentSource.YOUTUBE_IMPORT.value in vector.enrichment_sources

    def test_animation_affinity_updated(self):
        from app.models.media import YouTubeTasteSignals
        vector = UserTasteVector(id="test789", animation_affinity=0.2)
        signals = YouTubeTasteSignals(animation_affinity_delta=0.8)
        merge_youtube_signals(vector, signals)
        # 0.2 * 0.7 + 0.8 * 0.3 = 0.14 + 0.24 = 0.38
        assert vector.animation_affinity == pytest.approx(0.38)
