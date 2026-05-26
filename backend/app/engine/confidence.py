from app.models.mood import ConfidenceLevel, CONFIDENCE_DISPLAY


def calculate_confidence(score: float) -> ConfidenceLevel:
    if score >= 0.75:
        return ConfidenceLevel.HIGH
    elif score >= 0.60:
        return ConfidenceLevel.STRONG
    else:
        return ConfidenceLevel.MODERATE


def confidence_label(level: ConfidenceLevel) -> str:
    return CONFIDENCE_DISPLAY[level]
