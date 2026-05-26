import pytest
from unittest.mock import patch

from app.engine.mood_modifiers import (
    load_mood_config,
    get_mood_modifier,
    normalize_genre,
    expand_candidate_genres,
    get_time_of_day_modifier,
    BOOST_MULTIPLIER,
    PENALIZE_MULTIPLIER,
    TimeOfDayModifier,
)
from app.models.mood import MoodModifier, MoodType


class TestMoodConfigLoading:
    def test_all_seven_moods_present(self):
        config = load_mood_config()
        assert len(config) == 7
        for mood in MoodType:
            assert mood in config

    def test_boost_genres_are_strings(self):
        config = load_mood_config()
        for mood, modifier in config.items():
            assert all(isinstance(g, str) for g in modifier.boost_genres)

    def test_penalize_genres_are_strings(self):
        config = load_mood_config()
        for mood, modifier in config.items():
            assert all(isinstance(g, str) for g in modifier.penalize_genres)

    def test_emotional_intensity_in_range(self):
        config = load_mood_config()
        for mood, modifier in config.items():
            assert -0.3 <= modifier.emotional_intensity_modifier <= 0.3

    def test_darkness_modifier_in_range(self):
        config = load_mood_config()
        for mood, modifier in config.items():
            assert -0.3 <= modifier.darkness_modifier <= 0.3

    def test_pacing_modifier_valid(self):
        config = load_mood_config()
        for mood, modifier in config.items():
            assert modifier.pacing_modifier in ("fast", "slow", None)

    def test_load_mood_config_is_cached(self):
        cache_info_before = load_mood_config.cache_info()
        load_mood_config()
        load_mood_config()
        cache_info_after = load_mood_config.cache_info()
        assert cache_info_after.hits >= 2

    def test_load_mood_config_raises_on_missing_mood(self, tmp_path):
        import json
        bad_path = tmp_path / "mood_translation.json"
        bad_path.write_text(json.dumps({
            "happy_energetic": {
                "boost_genres": [], "penalize_genres": [],
                "boost_keywords": [], "penalize_keywords": [],
                "emotional_intensity_modifier": 0.0,
                "pacing_modifier": None,
                "darkness_modifier": 0.0,
            }
        }))

        with patch("app.engine.mood_modifiers._CONFIG_PATH", bad_path):
            load_mood_config.cache_clear()
            with pytest.raises(ValueError, match="missing moods"):
                load_mood_config()


class TestGetMoodModifier:
    def test_happy_energetic(self):
        mod = get_mood_modifier(MoodType.HAPPY_ENERGETIC)
        assert isinstance(mod, MoodModifier)
        assert "Comedy" in mod.boost_genres
        assert "Drama" in mod.penalize_genres
        assert mod.emotional_intensity_modifier == -0.2
        assert mod.pacing_modifier == "fast"
        assert mod.darkness_modifier == -0.3

    def test_tired_low(self):
        mod = get_mood_modifier(MoodType.TIRED_LOW)
        assert mod.pacing_modifier == "slow"
        assert "Action" in mod.penalize_genres

    def test_anxious(self):
        mod = get_mood_modifier(MoodType.ANXIOUS)
        assert mod.emotional_intensity_modifier == -0.3
        assert mod.darkness_modifier == -0.3

    def test_want_to_cry(self):
        mod = get_mood_modifier(MoodType.WANT_TO_CRY)
        assert "Drama" in mod.boost_genres
        assert mod.emotional_intensity_modifier == 0.3

    def test_mindblown_curious(self):
        mod = get_mood_modifier(MoodType.MINDBLOWN_CURIOUS)
        assert "Science Fiction" in mod.boost_genres
        assert mod.pacing_modifier is None

    def test_want_to_laugh(self):
        mod = get_mood_modifier(MoodType.WANT_TO_LAUGH)
        assert "Comedy" in mod.boost_genres
        assert "Drama" in mod.penalize_genres

    def test_thrilled(self):
        mod = get_mood_modifier(MoodType.THRILLED)
        assert "Thriller" in mod.boost_genres
        assert mod.emotional_intensity_modifier == 0.2


class TestGenreNormalization:
    def test_simple_genre(self):
        assert normalize_genre("Comedy") == ["Comedy"]

    def test_action_adventure(self):
        assert normalize_genre("Action & Adventure") == ["Action", "Adventure"]

    def test_sci_fi_fantasy(self):
        assert normalize_genre("Sci-Fi & Fantasy") == ["Science Fiction", "Fantasy"]

    def test_war_and_politics(self):
        assert normalize_genre("War & Politics") == ["War"]

    def test_expand_candidate_genres_simple(self):
        genres = ["Comedy", "Drama"]
        expanded = expand_candidate_genres(genres)
        assert expanded == {"Comedy", "Drama"}

    def test_expand_candidate_genres_compound(self):
        genres = ["Action & Adventure", "Comedy"]
        expanded = expand_candidate_genres(genres)
        assert expanded == {"Action", "Adventure", "Comedy"}

    def test_expand_candidate_genres_mixed(self):
        genres = ["Sci-Fi & Fantasy", "Thriller", "War & Politics"]
        expanded = expand_candidate_genres(genres)
        assert expanded == {"Science Fiction", "Fantasy", "Thriller", "War"}

    def test_expand_candidate_genres_empty(self):
        assert expand_candidate_genres([]) == set()


class TestTimeOfDayModifier:
    def test_late_night_has_genre_boost(self):
        mod = get_time_of_day_modifier("late_night", MoodType.HAPPY_ENERGETIC)
        assert mod.genre_boost_amount == 0.1
        assert len(mod.genre_boost_targets) > 0
        assert mod.emotional_intensity_bonus == -0.05
        assert mod.darkness_bonus == 0.05

    def test_morning_modifiers(self):
        mod = get_time_of_day_modifier("morning", MoodType.THRILLED)
        assert mod.genre_boost_amount == 0.1
        assert "Comedy" in mod.genre_boost_targets
        assert mod.emotional_intensity_bonus == -0.05
        assert mod.darkness_bonus == -0.05

    def test_afternoon_is_neutral(self):
        mod = get_time_of_day_modifier("afternoon", MoodType.HAPPY_ENERGETIC)
        assert mod.genre_boost_amount == 0.0
        assert mod.emotional_intensity_bonus == 0.0
        assert mod.darkness_bonus == 0.0
        assert mod.genre_boost_targets == []

    def test_evening_is_neutral(self):
        mod = get_time_of_day_modifier("evening", MoodType.ANXIOUS)
        assert mod.genre_boost_amount == 0.0
        assert mod.emotional_intensity_bonus == 0.0

    def test_unknown_time_defaults_to_neutral(self):
        mod = get_time_of_day_modifier("unknown", MoodType.THRILLED)
        assert mod.genre_boost_amount == 0.0
        assert mod.emotional_intensity_bonus == 0.0
        assert mod.darkness_bonus == 0.0

    def test_each_time_of_day_has_modifier(self):
        for tod in ("morning", "afternoon", "evening", "late_night"):
            mod = get_time_of_day_modifier(tod, MoodType.HAPPY_ENERGETIC)
            assert isinstance(mod, TimeOfDayModifier)


class TestMultiplierConstants:
    def test_boost_multiplier(self):
        assert BOOST_MULTIPLIER == 1.3

    def test_penalize_multiplier(self):
        assert PENALIZE_MULTIPLIER == 0.7


class TestConfigValidationIntegration:
    def test_config_loads_without_error(self):
        config = load_mood_config()
        assert len(config) == 7

    def test_all_moods_have_non_empty_boost_keywords(self):
        config = load_mood_config()
        for mood, modifier in config.items():
            assert len(modifier.boost_keywords) > 0, f"{mood} has empty boost_keywords"

    def test_all_moods_have_non_empty_penalize_keywords(self):
        config = load_mood_config()
        for mood, modifier in config.items():
            assert len(modifier.penalize_keywords) > 0, f"{mood} has empty penalize_keywords"

    def test_no_overlap_between_boost_and_penalize_genres(self):
        config = load_mood_config()
        for mood, modifier in config.items():
            boost_set = set(modifier.boost_genres)
            penalize_set = set(modifier.penalize_genres)
            overlap = boost_set & penalize_set
            assert not overlap, f"{mood} has overlap: {overlap}"
