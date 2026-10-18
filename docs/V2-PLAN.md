# Unbored V2: actionable rework plan

## Context

The October 2026 V2 guide plan (`Unbored-V2-Plan.md`) asks for dependability first: no cold start, durable Watch Together rooms, AI that works without a key, a catalog that refreshes, honest claims. New features come after that. The guide was written from the docs only. This plan checks each of its claims against the code on `claude/rework-plan-kgfxyy` (head `f6e84a3`) and turns it into ordered, verifiable steps.

**Decisions already made with the owner:**
- **Retire the Render backend entirely.** Every catalog endpoint moves into the browser. The only server code left is Vercel functions for AI. Python stays as the offline reference engine, the catalog builder and the test oracle.
- **Free-AI rate limits and the reason cache live in Supabase tables.** The Vercel function writes them with the service-role key.

**House rules carried over from the guide:**
- Keep Unbored's identity; no restyle.
- Design gate: redesign one key screen and get approval before rolling out UI.
- Not vibecoded; every state (loading, empty, error) is designed.
- Honest claims only.
- Never mention unpublished research.
- Small commits on `claude/rework-plan-kgfxyy`. No deploy or publish without the owner's go-ahead.

---

## What the code actually says (guide vs reality)

| Guide claim | Verified reality | Consequence |
|---|---|---|
| "Pure Python at runtime" | `backend/requirements.txt` ships **numpy**. `app/engine/content.py:409` and `app/services/shelves.py:24` import it. | The README claim is already untrue. It becomes moot once the engine is in the browser. |
| Cold start ~50s | The global `WakeGate` (`frontend/src/components/system/WakeGate.tsx`, mounted in `AppShell.tsx:82`) covers **every** route. `public/sw.js` serves `/api/health` stale-while-revalidate, so a cached 200 can report "ready" while Render is asleep. | Removing the backend dependency removes WakeGate, `useBackendStatus.ts` and that cache bug together. |
| Rooms in memory | `backend/app/services/rooms.py` is a process-memory `RoomStore`. The frontend polls `GET /together/rooms/:code` every 3s (`TogetherPage.tsx:125-137`), and the service worker can serve that poll from cache. | Move rooms to Supabase Realtime. |
| Catalog frozen, no refresh | `.github/workflows/refresh-catalog.yml` **already exists** but has failed on all 8 weekly runs. The cause is that the `TMDB_API_KEY` repo secret is empty (log: `TMDB_API_KEY:` blank, then "ERROR: no TMDB key"). The catalog was built `2026-08-23`: 2,420 titles (1,773 movie, 492 TV, 155 anime). | Step 1 is an owner action (add the secret), not new code. |
| AI needs a key | BYO key only. It lives in sessionStorage (`stores/llmStore.ts`) and is sent as `X-LLM-*` headers by `api/client.ts:19-27`. There are two LLM calls per pick: `query_expansion.expand` (genre boosts) and `curator.curate` (the pick plus a reason). | The free tier gets curate only (one call). BYO keeps both. |
| Test numbers disagree (146 vs 302) | The backend has **134** `def test_` functions plus 4 parametrize sites (this environment has no pytest, so I couldn't collect them). The frontend has **2** tests (`src/test/app.smoke.test.tsx`). 302 matches nothing in this repo. | Run the suites for real and publish the true numbers. The portfolio number is fixed in the portfolio repo. |
| Docs drift (`.ai-docs`) | `.ai-docs/` is **gitignored** and not in this repo. The README still says "146 tests", "pure-Python", and "~50s to wake". | Owner action locally for `.ai-docs`; README fixed here. |
| Where-to-watch | `ActionButtons.tsx:83-97` links to a generic `watchUrl`. The catalog has no provider data. | Add TMDB `watch/providers` (IN) at build time. |
| Error boundary on every route | `components/ErrorBoundary.tsx` exists but is only used app-wide (`App.tsx:97`) and around the reveal (`HomePage.tsx:229`). There is no 404 route. | Reuse it per route. |
| Bundle ~1 MB | Measured: the slimmed catalog JSON is **930 KB gzip**. int8 dense vectors (2,420×384) are **~907 KB**, and they barely compress. That is about 1.8 MB at today's size, or about 7 MB at 10k titles if nothing else changes. | A size budget plus dimensionality reduction is required before growing to 10k. |

Other facts this plan relies on:
- Supabase is used for one table, `profiles` (`hooks/useProfileSync.ts:73,90`). There are **no migrations in the repo**.
- Supabase Realtime is enabled in `supabase/config.toml`, and the CSP already allows `wss://ncyftlyosczinppprkfc.supabase.co`.
- `frontend/vercel.json` rewrites `/api/:path*` to Render.
- `engine.py:65` uses `_REF_YEAR = datetime.now().year`. It must be injectable so fixtures stay deterministic.

---

## Target architecture

```
Browser (Vercel static)                                    Vercel functions (/api/ai/*)
┌───────────────────────────────────────────┐ shortlist  ┌──────────────────────────────┐
│ data pack (hashed, SW-cached):             │ ─────────▶ │ curate: free Gemini key OR   │
│  cards.json · engine.bin · shelves.json    │            │   pass-through BYO key       │
│ Web Worker engine (TS port of engine.py)   │ ◀───────── │ expand (BYO only) · validate │
│ local search · taste profile · shelves     │ reason     │ rate limit + cache ─▶ Supabase│
│ Rooms: Supabase Realtime presence/broadcast│            └──────────────────────────────┘
└───────────────────────────────────────────┘
Offline (GitHub Actions, weekly): build_catalog.py → build_embeddings.py → build_web_pack.py
  → parity fixtures + pytest + vitest → PR
```

How the work splits between build time and run time:
- **Python precomputes everything that doesn't depend on the request:** tone vectors, the quality prior, `popularity_norm`, shelf membership, curated shortlist, deck pools, and int8 dense vectors with a per-vector scale.
- **TypeScript does only the request-dependent math:** profile, relevance, mood fit against the personalised target, runtime, recency, tuning, MMR and confidence.
- **TypeScript builds BM25 from the shipped card text at load.** This adds zero extra bytes. Shipping precomputed sparse vectors would cost about 600–900 KB.

---

## Phase 0: Housekeeping (½ day, mostly owner)

1. **Owner:** add the `TMDB_API_KEY` repo secret, then re-run "Refresh catalog" by `workflow_dispatch`. Review and merge the PR it opens.
2. Install the dev dependencies and run `python -m pytest -q` and `npm test`. Record the real counts.
3. Fix the README's test badge and the "pure-Python, no numpy" claim to match what is true today.
4. **Owner:** run `supabase db pull` so `profiles` is captured as `supabase/migrations/0001_profiles.sql`. Later migrations build on it.
5. **Owner, local:** mark `.ai-docs/` historical. Correct the portfolio's "302 tests" in the portfolio repo.

## Phase 1: Engine in the browser (the suggested first step)

The goal is that the Pick, Browse, Search, Swipe, Taste and Library pages make **zero** calls to Render.

### 1a. Build the web data pack: new `backend/scripts/build_web_pack.py`
- Read `catalog.json` and `catalog_embeddings.json`. Write to `frontend/public/data/`:
  - **`cards.json`:** display and engine fields only. Drop `popularity`, `status`, `source_api`, `release_date`, and redundant `year`. Add precomputed `tone[5]` (from `tone.tone_vector`) and `quality` (from `engine.quality_prior`).
  - **`engine.bin` plus a manifest header:** `Int8Array` vectors of 2,420×384, each with a float32 scale.
  - **`shelves.json`:** the output of `services/shelves.build_shelves()` stored as id lists, plus the curated shortlist (logic from `routers/search.py:get_curated_shortlist`) and the genre deck pools.
  - **`manifest.json`:** `{version, generated_at, count, sha256 per file, dims, ref_year}`.
- Files are content-hashed, so the service worker can cache them as immutable.
- **Size budget:** fail the script if the total gzip size exceeds **3 MB**.

### 1b. Make the Python reference read the pack
- Add `app/services/pack.py` with `load_pack_embeddings()`, which dequantizes `engine.bin`.
- Make `RecommendationEngine` accept `ref_year` (default stays `datetime.now().year`), and give `recency_fit` the same parameter.
- No behaviour change at defaults, so the existing tests stay green.

### 1c. Parity fixtures: new `backend/scripts/export_parity_fixtures.py`
- Generate about 300 seeded requests covering:
  - profiles of 0, 1, 2, 5, 20 and 100 favourites, built the way `test_engine_quality._profile_by_genre` does;
  - all 7 moods, all 3 slots, all 3 eras, the 4 media types and the time-of-day values;
  - random `tuning` values, and `excluded_ids` lists.
- Run the Python engine over the **dequantized** pack with a pinned `ref_year`.
- Write `frontend/src/engine/__fixtures__/parity.json` with the following, plus a few BM25 vector checksums per item so tokenizer drift is caught early:
  - primary id
  - alternate ids
  - confidence
  - the top 20 ids with score and breakdown
- Add a pytest that reports and asserts quantization loss: int8 vs float32 top-1 agreement ≥ 95% and top-10 overlap ≥ 0.9. The exact numbers go in the README.

### 1d. TypeScript engine: new `frontend/src/engine/`
| File | What it ports or does |
|---|---|
| `content.ts` | `content.py`: `_tokens`/`_slug`/stopwords, `_weighted_terms`, BM25 (`_K1`, `_B`), `cosine`, `_knn_centroid_score`, `relevance` with `_W_DENSE`/`_W_SPARSE`. Dense dot runs on Int8 times scale. |
| `engine.ts` | `engine.py`, constant for constant: `runtime_fit`, `recency_fit(ref_year)`, `_weights`, `_tune_weights`, `_apply_era_boost`, retrieve-then-rerank, `_genre_bonus`, `_mmr_select`, `_confidence`, `recommend`. Port the 4-dp rounding and the sort key `(score, vote_count, popularity_norm)` exactly. |
| `tone.ts` | Only `mood_target` (it reads `mood_targets.json`, which gets copied into the pack). Item tone vectors are precomputed. |
| `taste.ts` | `taste_signals.taste_dims_from_items` and `routers/taste.py` (the profile summary). |
| `rationale.ts` | `services/rationale.engine_rationale`. |
| `pipeline.ts` | `routers/recommend._run_pipeline` without the LLM: exclusion, `_fill_alternates`, `_popularity_fallback`, and the same response shape as `types/recommendation.ts`. |
| `search.ts` | `routers/search._norm` / `_match_rank`. Python's `difflib` ratio becomes a small Ratcliff/Obershelp port, checked by fixture queries. |
| `pack.ts` | Fetch and verify the manifest hash, decode `engine.bin`, build the index once. Exposes a typed error on failure. |
| `worker.ts` + `client.ts` | Run the engine in a Web Worker, called through `postMessage` request/response, so the reveal's scanning animation never janks. |

### 1e. Swap the API layer, not the pages
- Re-implement the functions in `frontend/src/api/{recommend,browse,search,taste,media}.ts` with the **same signatures**, backed by the local engine and pack. Pages, stores and hooks such as `useRecommendation.ts` stay almost untouched. Deck shuffling logic comes from `routers/browse.get_deck`.
- **Interim rule:** if a BYO key is connected, keep using the Render `/api/recommend` until Phase 2 lands. No-key users go local right away.
- Delete `WakeGate.tsx`, `useBackendStatus.ts` and `src/data/starter-deck.json` (the pack replaces it).
- Replace them with a **pack-loading state** (reuse the existing skeleton components) and a **pack-failed state** with a retry.
- `sw.js`:
  - precache the hashed pack files;
  - stop caching `/api/*` responses altogether;
  - bump the cache name.

### 1f. Tests
- `src/engine/parity.test.ts`. Acceptance:
  - every fixture's primary and alternates are identical;
  - scores and breakdowns are within 1e-4;
  - top-20 order is identical, except between items whose rounded scores tie.
- Unit tests for `search.ts` and `taste.ts`.
- Update the smoke-test mocks in `app.smoke.test.tsx`.
- CI (`ci.yml`) gets a step that runs `build_web_pack.py` and `export_parity_fixtures.py`, then fails if the committed fixtures are stale (`git diff --exit-code`).

**Done when:** a cold first visit with no key produces a pick, with no request to `onrender.com` in DevTools, and the parity test passes in CI.

## Phase 2: Free AI tier, then retire Render

### 2a. Vercel functions under `frontend/api/ai/`
- **`curate.ts`:** ports the prompt builder and parser from `services/curator.py` (`SYSTEM_PROMPT`, `build_user_prompt`, `_parse`, `_clip`).
  - The body is `{liked_titles[≤8], mood, time_available, media_type, shortlist: [{id, title, year, genres, runtime, rating, eps}] ≤8, taste_hash}`.
  - The server checks shortlist ids against a bundled id list so the function can't be used as a free general-purpose LLM proxy.
- **`expand.ts`:** ports `services/query_expansion.py`. BYO key only.
- **`validate.ts`:** ports `routers/llm.py`.
- **`_lib/providers.ts`:** ports `llm/gemini.py` (request body, `extract_text`, retry once on 5xx) and `llm/openai_compatible.py` for DeepSeek.
- **Key handling:**
  - No `X-LLM-Key` header means the server's `GEMINI_API_KEY` (free tier) is used.
  - A header present means that key is passed through with no quota applied.
  - Keys are never logged.
  - The model name comes from an env var: check at implementation time that `gemini-2.0-flash` (`config.py:41`) is still on the free tier.
- **Quota and cache (free tier):**
  - Hash the IP as sha256(ip + `IP_HASH_SALT`) and store only the hash.
  - Look up and insert in Supabase `ai_usage (ip_hash, day, count)`, for example 20 picks per IP per day plus a global daily cap.
  - The cache is `ai_reason_cache (key primary key, result jsonb, created_at)`. The key is sha256 of the provider, mood, slot, type, shortlist ids and taste hash, with a 30-day TTL.
- **Timeouts:** about 5s server-side, 6s client-side. On timeout, 429 or error, the client keeps the engine pick and rationale and sets `ai_status` to `timeout`, `limited` or `error`. `"limited"` is new: add it to the `AIStatus` type.

### 2b. Supabase migration
- `supabase/migrations/0002_ai.sql` creates both tables with RLS on and **no** anon policies, so only the service role can touch them.

### 2c. Client side
- `useRecommendation` makes the following call order; reranking goes through the worker, as Python does today:
  - **BYO key:** worker shortlist, then `expand`, then a worker rerank with `genre_boosts`, then `curate`.
  - **Free tier:** worker shortlist, then `curate`.
- Copy changes in `ConnectAI.tsx`, `AIStatusBanner.tsx` and `UpgradePrompt`: "AI picks are on (shared free tier, N left today)" vs "using your key". **Owner reviews the copy.** Be honest that free-tier requests go to Google.

### 2d. Retire Render
- Remove the Render rewrite and the `onrender.com` CSP entries from `vercel.json`. Delete `render.yaml` and `backend/Procfile`.
- Update `run.py`, `start.*` and `vite.config.ts` (drop the `/api` proxy, or point it at `vercel dev`).
- Keep the FastAPI app in the repo **only if** the tests need it as the reference harness. Otherwise mark it reference-only in the README.
- **Owner:** suspend the Render service after the deployment is verified.

**Done when:**
- a no-key visitor gets an AI reason;
- the 21st pick in a day returns `limited` with a clean engine fallback;
- killing the network to `/api/ai` still produces a pick.

## Phase 3: Durable Watch Together on Supabase Realtime

### Migration `0003_rooms.sql`
- Table `rooms (code text primary key, created_at, expires_at)`.
- RLS: anon can insert, and can select by code.
- A cron or SQL function deletes expired rows.
- This table exists only so codes are unique and expire; the live state is in Realtime.

### New `frontend/src/together/room.ts`
- Channel `room:{CODE}`.
- **Presence payload:** `{member_id (localStorage), name, favourite_ids ≤100}`.
- **Broadcast events:** `pick` (`{primary_id, alternate_ids, rationale, mood, slot}`), and later `veto`.
- Whoever presses "Pick for us" computes the blend locally in the worker. It uses the merged favourites, as `rooms.combined_favourites` does today, with `time_of_day: evening`, `media_type: surprise` and `era: any`, matching `routers/together.room_pick`. It then broadcasts the result.
- On presence join, the most recent picker re-broadcasts so late joiners catch up.
- A refresh rejoins using the code and `member_id` stored in localStorage.

### `TogetherPage.tsx`
- Replace the polling and `api/together.ts` with `room.ts`.
- Keep the legacy `/together/<encoded>` blend path working locally.
- New designed states:
  - connecting
  - reconnecting
  - room expired
  - Supabase not configured (Together off, everything else works)

### Privacy trade-off (accept explicitly)
Other members' browsers now receive your favourite ids; the UI still shows only counts. Say so in the README.

**Done when:**
- two browsers join one room;
- either refreshes and the room persists;
- a pick appears on both;
- the room still works after a redeploy.

## Phase 4: Tests and monitoring

### Playwright
- Add `frontend/e2e/` and `playwright.config.ts`, using `executablePath` from `PLAYWRIGHT_BROWSERS_PATH` in this environment.
- Run against `vite preview`, with `/api/ai/*` intercepted by `page.route`. Specs:
  1. onboarding, then pick favourites, mood and time, then the reveal, save to watchlist, and see it in the Library;
  2. try again excludes the previous pick;
  3. pack-load failure shows the error state and retry works;
  4. AI timeout falls back to the engine reason.
- Add a CI job.

### Error boundaries
- Wrap every route element in `App.tsx` with `<ErrorBoundary label=…><Suspense fallback={<RouteSkeleton/>}>`.
- Add a lazy-chunk-load retry (once, then reload).
- Add a designed 404 route.

### Sentry (free tier)
- Add `@sentry/react` init in `main.tsx`, gated on `VITE_SENTRY_DSN`.
- Call `captureException` from `ErrorBoundary.componentDidCatch`.
- Add `@sentry/node` in the functions.
- Add the ingest host to the CSP `connect-src`.
- No PII; scrub `X-LLM-Key`.

### Uptime check
- New `.github/workflows/uptime.yml`, running hourly. It GETs the site, `/data/manifest.json` and `/api/ai/health` (a new function that pings nothing paid).
- On failure it opens or updates an issue.

## Phase 5: Catalog refresh and growth

### Extend `refresh-catalog.yml`
- Add steps to run `build_web_pack.py` and `export_parity_fixtures.py`, then the parity test, and add the pack paths to `add-paths`.
- Bump the actions to Node-24-compatible versions (the logs show a deprecation warning).

### "New this week"
- `build_catalog.py` preserves `added_at` per id from the previous `catalog.json`, and new ids get the build date.
- `shelves.py` gains a `new-this-week` shelf (added within 7 days, quality-floored). It flows through `shelves.json` automatically.

### Growth to about 10k titles
- Raise the page constants in `build_catalog.py:100-103`. Add `imdb_id` (for Phase 7) through TMDB `external_ids` in the same detail fetch.
- **Gate:** stay within the 3 MB pack budget. That needs a dimensionality cut, PCA 384→128 fitted in `build_web_pack.py`. Adopt it only if the 1c quality test (vs float32) still passes. Otherwise grow only as far as the budget allows.
- Consider dropping the 8.4 MB `catalog_embeddings.json` from git in favour of the int8 pack, which stops 12 MB weekly diffs.

## Design gate (before Phases 6–8)

Redesign **one** screen first: the **reveal** (`components/reveal/*`). Every user-visible V2 feature lands there:
- where-to-watch
- trailer
- share
- "Why not X?"
- AI-tier label

Produce a mock or a branch preview in Unbored's existing dark, hand-built identity, and **get owner approval** before building 6–8.

## Phase 6: Where-to-watch (India)

- At build time, `tmdb_service` gains `get_watch_providers(kind, id)`, which reads TMDB `/{movie|tv}/{id}/watch/providers` and keeps only the `IN` result: flatrate, rent and buy, as `{provider_id, name, logo_path}`, plus the TMDB `link`.
- Anime gets AniList `externalLinks` of type STREAMING, labelled "not region-checked".
- Store this as `watch.IN` in `cards.json`.
- Add a reveal panel that replaces the generic `watchUrl` in `ActionButtons.tsx`. It shows "Data from JustWatch" attribution, as TMDB requires, and has a designed "not streaming in India" empty state.
- Add `image.tmdb.org` logos (already allowed in the CSP).

## Phase 7: Import Letterboxd and IMDb ratings (CSV, client-only)

- Add `frontend/src/import/`:
  - parse Letterboxd `ratings.csv` (Name, Year, Rating out of 5);
  - parse IMDb ratings export (Const, Your Rating out of 10, Title, Year).
- **Matching:** IMDb rows match by `imdb_id`. Letterboxd rows match by normalised title (reuse `search.ts` `_norm`) plus year ±1.
- **Mapping:**
  - ≥4/5 or ≥8/10 calls `tasteStore.addFavouriteIds`;
  - ≤2/5 or ≤4/10 adds to the library's "not for me";
  - every matched row adds to "seen".
- A designed preview screen shows matched and unmatched counts honestly before committing.
- Nothing is uploaded.
- Entry points: onboarding and Settings.
- This supersedes the YouTube Takeout idea.

## Phase 8: Trailer, share card, then "Why not X?" and veto rounds

- **Trailer:**
  - TMDB `/videos` (official YouTube trailer key) and AniList `trailer` are fetched at build time into `cards.json`.
  - The reveal embeds a muted, click-to-load `youtube-nocookie.com` player.
  - CSP: add `frame-src` for youtube-nocookie and `img-src` for `i.ytimg.com`.
- **Share card:** render client-side to canvas (poster, title, reason), then share with the Web Share API (files) or download.
  - First verify that `image.tmdb.org` sends CORS headers.
  - If it doesn't, use a `frontend/api/card/[id].ts` OG-image function, which also improves `/pick/:id` link previews.
- **"Why not X?":** add `engine.explain(id)`, which scores one arbitrary title under the current request with the rerank weights and returns its breakdown and rank vs the pick. The reveal UI searches a title and shows the per-signal comparison using the existing `ScoreBreakdown` fields.
- **Veto rounds (Together):** broadcast a 5-title shortlist. Each member vetoes up to one per round. After at most 3 rounds the highest survivor wins. State lives only in the broadcast messages and presence.

---

## Owner-only actions (secrets and accounts)

| Where | Action |
|---|---|
| GitHub repo secret | `TMDB_API_KEY` (Phase 0) |
| Supabase | `db pull` for `profiles`; apply migrations 0002 and 0003; confirm Realtime is on for the project |
| Vercel env | `GEMINI_API_KEY`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `IP_HASH_SALT`, `VITE_SENTRY_DSN`, `SENTRY_DSN` |
| Render | Suspend the service after Phase 2 is verified |
| Portfolio repo and local `.ai-docs` | Fix "302 tests"; mark docs historical |

## Verification (per phase, before each push)

- **Backend:** `cd backend && pip install -r requirements-dev.txt && python -m pytest -q`. This covers the existing suite, the quantization-loss test and the stale-fixture check.
- **Frontend:** `cd frontend && npm ci && npx tsc -b --noEmit && npx eslint . && npm test && npx vite build`. The parity test is part of `npm test`.
- **Playwright** (from Phase 4): `npx playwright test` against `vite preview`.
- **Manual:**
  - DevTools Network on a cold load shows no `onrender.com` request and the pack is served from the service worker on the second load (Phase 1);
  - a no-key AI reason appears and the quota hit falls back to the engine (Phase 2);
  - two-browser room with a refresh (Phase 3).
- **README:** the claims and badges are updated with the real test counts and parity and quantization numbers at the end of each phase.
