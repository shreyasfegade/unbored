def calculate_diversity_score(
    candidate_genres: list[str],
    recent_primary_genres: list[str],
) -> float:
    if not candidate_genres or not recent_primary_genres:
        return 1.0

    candidate_primary = candidate_genres[0].lower().strip()
    penalty = 0.0

    for recent_genre in recent_primary_genres:
        if candidate_primary == recent_genre.lower().strip():
            penalty += 0.5

    score = 1.0 - penalty
    return max(0.0, min(1.0, score))
