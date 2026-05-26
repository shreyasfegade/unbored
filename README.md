# Unbored

**The decision paralysis killer.** One button. One perfect pick. Right now.

![React](https://img.shields.io/badge/React_19-61DAFB?style=flat-square&logo=react&logoColor=black)
![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?style=flat-square&logo=typescript&logoColor=white)
![FastAPI](https://img.shields.io/badge/FastAPI-009688?style=flat-square&logo=fastapi&logoColor=white)
![Vite](https://img.shields.io/badge/Vite-646CFF?style=flat-square&logo=vite&logoColor=white)
![License](https://img.shields.io/badge/License-MIT-green?style=flat-square)

![Unbored Mood Selector](screenshots/hero.png)

---

## The Problem

You're bored. You open Netflix, YouTube, Prime. Nothing feels worth starting.
You spend 20 minutes scrolling and give up.

## The Solution

Open Unbored. Pick your mood. Tap one button.
It tells you exactly what to watch — right now.

No scrolling. No deciding. No paralysis.

---

## Features

- **One-tap recommendations** — mood + time available → one confident pick
- **Cross-platform taste profile** — movies, shows, anime, built from your favourites
- **Cinematic reveal** — 2-3 second scanning animation before the recommendation appears
- **"Why now?" intelligence** — one sentence explaining why this content fits your current context
- **Confidence scoring** — "High confidence pick" / "Unusually strong match tonight"
- **Mood-aware scoring** — each mood applies concrete multipliers to the recommendation engine
- **"Not feeling it" regeneration** — tap to get a new pick instantly

---

## Architecture

```text
React Frontend ──→ FastAPI Backend ──→ TMDB API (movies/shows)
   (Vite + TS)       (Python)          AniList API (anime)
        ↑                │              Gemini API ("Why now?")
        │                ▼
        └──── Recommendation ←── UserTasteVector
               Scoring Engine      (genre weights, keywords,
                                    pacing, darkness, humor)
```

## Tech Stack

**Frontend:** React 19, Vite, TypeScript, CSS Modules, Framer Motion, Zustand
**Backend:** Python, FastAPI, Uvicorn
**APIs:** TMDB (movies/shows), AniList (anime), Gemini (natural language)
**Design:** Custom CSS variables, dark cinematic palette, glassmorphism

---

## Quick Start

### Prerequisites
- Python 3.11+
- Node.js 18+
- API keys: [TMDB](https://www.themoviedb.org/settings/api), [Gemini](https://ai.google.dev/) (both free tier)

### Backend
```bash
cd backend
cp .env.example .env        # Add your API keys
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
python -m uvicorn app.main:app --reload --port 8000
```

### Frontend
```bash
cd frontend
npm install
npm run dev                  # Opens at http://localhost:5173
```

---

## Current Status

Experimental prototype — core recommendation loop is functional.

**Implemented:**
- TMDB and AniList integration with full metadata
- UserTasteVector data model and scoring engine
- Mood → scoring translation layer (7 moods with boost/penalize rules)
- Onboarding flow (pick favourites → instant first recommendation)
- Gemini-powered "Why now?" sentence generation
- Core button UI with reveal animation

**In Progress:**
- YouTube Takeout import for taste signal extraction
- Cold start fallbacks for new users
- Recommendation diversity enforcement

**Planned:**
- Feedback loop (rate recommendations to improve future picks)
- Watch history tracking
- Mobile-optimized layout

---

## Architecture

```
┌─────────────────┐         ┌─────────────────┐         ┌─────────────────┐
│   USER INPUT    │         │  SCORING ENGINE │         │     REVEAL      │
│                 │         │                 │         │                 │
│ • Mood Select   │────────►│ • TMDB Fetch    │────────►│ • Framer Motion │
│ • Taste Profile │  mood   │ • AniList Fetch │ scored  │ • "Why Now?"    │
│ • Runtime Pref  │  + faves│ • Score Matrix  │ pick    │ • Gemini Gen.   │
│                 │         │ • Mood Multiply │         │ • Poster + Info │
└─────────────────┘         └─────────────────┘         └─────────────────┘
```

### Data Flow

```
1. Mood selected + taste profile loaded
   ↓
2. TMDB candidates fetched ────────────── ~400ms (genre + keyword search)
   ↓
3. AniList candidates fetched ─────────── ~300ms (parallel API call)
   ↓
4. Multi-factor scoring ───────────────── ~50ms (genre 25% + keyword 30% +
                                                  mood 20% + runtime 15% +
                                                  rating 5% + diversity 5%)
   ↓
5. Top pick selected ──────────────────── ~5ms (highest composite score)
   ↓
6. "Why now?" generated ───────────────── ~2s (Gemini with prompt constraints)
   ↓
7. Cinematic reveal played ────────────── ~800ms (Framer Motion sequence)

Total: ~3.5s from mood selection to recommendation reveal
```

Mood isn't decorative — each selection applies concrete boosts and penalties. "Anxious" boosts feel-good/comedy and penalizes thriller/horror, defined in a config table rather than hardcoded. The "Why now?" sentence uses strict prompt constraints to stay observational ("this pairs well with your taste for...") and avoid psychoanalysis ("you seem lonely tonight").

## Limitations

- Requires free API keys for TMDB, AniList, and Gemini
- Recommendation quality depends heavily on the initial taste profile — more favourites = better picks
- "Why now?" sentence quality varies with Gemini model performance
- No streaming platform integration — recommends what to watch, not where to watch it
- Cold start problem: first-time users with few favourites get less personalized results

## What This Project Taught Me

- How recommendation systems work: scoring matrices, diversity penalties, and confidence calibration.
- React state management patterns with Zustand for complex multi-step flows.
- API orchestration across multiple data sources (TMDB, AniList, Gemini) and handling their inconsistencies.
- Prompt engineering with strict output constraints for natural-language generation.
- Framer Motion animation orchestration for cinematic UI reveals.

## Development Note

**Built with AI-assisted development.** I directed the product vision, designed the recommendation logic, and made the UX decisions. AI tools accelerated the implementation.

My contributions:
- The core idea: a "decision paralysis killer" that gives you one confident pick instead of infinite scrolling.
- UX direction: the "Ambient Cinema Oracle" metaphor driving all design decisions.
- Recommendation scoring architecture and the mood-to-score translation system.
- Prompt engineering constraints for the "Why now?" sentence.
- Interaction design for the cinematic reveal sequence.

## License

MIT — see [LICENSE](LICENSE) for details.
