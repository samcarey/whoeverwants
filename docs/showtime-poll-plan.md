# "Showtime" Poll — Implementation Plan (Alamo, v1)

> **Status:** planned, not yet built. This doc is the spec the implementation session
> starts from. Scope is intentionally narrow: **single chain (Alamo Drafthouse), no
> self-healing/auto-discovery** — those are deferred. The goal is a working vertical
> slice: create a Showtime poll from real Alamo data, vote on it, compute a winner.

## What it is

A new poll category that behaves like a `time` poll but the options are **concrete
movie showtimes** instead of generated 15-minute slots. Creator flow:

1. Pick a **reference location + radius** first (like location/restaurant polls).
2. App **loads all nearby Alamo showtimes** for the next ≤3 weeks (progress indicator).
3. Creator **searches/filters a movie list** (combobox over the loaded catalog — scroll & pick).
4. On pick → the **existing calendar widget** appears with only **days that have showtimes**
   for that movie selectable.
5. Selected days render in a **per-day curation card** (same visual language as the time
   preference ballot, but the times are **actual showtimes**, not 15-min increments).
   Creator hand-selects the **viable** showtimes, then submits.

Voting: voters mark each curated showtime **want / neutral / can't-attend** (a time-preference
ballot where the **red state = "can't attend"**). Winner = **maximize attendance
(not-red), then maximize likes (want), then earliest.**

## Confirmed decisions (owner, June 2026)

1. **"Next 3 weeks" is best-effort** — whatever Alamo has on sale, capped at 3 weeks. The
   calendar marks only days the feed actually returns; a shorter window degrades gracefully.
2. **New `question_type = 'showtime'`** (not a bent `time` type).
3. **Caching is per-theatre-per-day**: upstream feeds are fetched **at most once per day**,
   so any number of users hitting the same cinema+date share a single upstream fetch.
4. **`allow_plus_ones` defaults ON** for showtime polls (group outings), like `time`.
5. **Alamo only, no self-healing** for this build.

---

## Alamo data source — the reality (this shapes the backend)

Alamo has **no official API**, but runs unauthenticated JSON feeds that back their own site.
`drafthouse.com/robots.txt` only disallows `/s/` for crawlers; the feeds are not access-gated.
This is a **tolerated public feed, not sanctioned API access** — fetch politely, cache hard,
expect it can change. (At scale: ping Alamo about their affiliate/ticketing program.)

**Two feeds must be joined, plus a static cinema directory:**

| Feed | URL | Provides | Missing |
|---|---|---|---|
| **Sessions** (legacy) | `https://feeds.drafthouse.com/adcService/showtimes.svc/market/{marketId}` | Real showtimes: `Market → Dates → Cinemas → Films → Series → Sessions`. Session fields: `SessionId`, `SessionTime`, `SessionDateTime`, `SessionStatus` (`onsale`/`past`), `SeatsLeft`, `SeatingLow`, `Attributes` (format), `SessionSalesURL` (often empty). Film: `FilmId`, `FilmName`, `FilmYear`, `FilmRating`, `FilmRuntime`, `FilmAgePolicy`, `FilmSlug`. Cinema: `CinemaId`, `CinemaName`, `CinemaSlug`, `CinemaTimeZoneATE`, `MarketName`, `MarketSlug`. | **No cinema coords**, **no posters**, **short forward window** (Austin `market/0000` returned only ~2 days — Alamo opens ticket sales ~1–2 wks out). |
| **Catalog** (modern) | `https://drafthouse.com/s/mother/v2/schedule/market/{marketSlug}` | Film metadata under `data.presentations[]`: titles, descriptions, **poster images**, certification ratings, `openingDateClt`/`openingDateDisplay`. | **No sessions/times.** |

**Static cinema directory (the "map" artifact):** `server/data/alamo_cinemas.json`, ~40 rows:
`{ cinema_id, slug, name, market_id, market_slug, lat, lng, timezone }`. Built once
(from `drafthouse.com/locations` + geocoding). This is what makes the geo/radius query
possible since **neither feed carries coordinates**, and it enumerates the market IDs to
fetch. It is also the natural seam for adding other chains later.

**Adapter join:** sessions (per cinema) + catalog (posters/runtime, joined on `FilmId`/`FilmSlug`)
+ directory (coords/tz). Resolve the in-radius cinemas first, fetch only their markets.

**Known risks to verify during Phase A:**
- The legacy sessions feed's real forward window per *populated* market (could be < 3 weeks;
  `market/0000` may be a stub). The UI must render whatever days exist, not assume 21.
- Enumerate real numeric `marketId`s (a markets-list endpoint, or hardcode the IDs into the
  directory). `…/v2/schedule/markets` and `…/v1/markets` returned 405 on naive GET — probe
  the site's own XHRs / try slug forms.
- `SessionSalesURL` is sometimes empty — derive a ticketing URL from `CinemaSlug` + `SessionId`
  if needed, or omit the link gracefully.

---

## Caching model (decision #3)

- **Upstream fetch granularity = per market, once/day.** The sessions feed is per-market, so
  one market pull covers every cinema in it. Same for the catalog feed. A daily refresh (or
  24h TTL) means N users hitting the same area pull upstream at most once/day.
- **Serving/index granularity = per (cinema_id, date).** After a market fetch, split + index
  sessions by `(cinema_id, date)` so `/api/showtimes/nearby` assembles a radius+horizon
  response from cached per-cinema-day buckets.
- **Implementation:** disk+memory TTL cache mirroring `server/routers/search.py`'s favicon
  cache (`_FAVICON_CACHE_PATH` / atomic JSON write). New `SHOWTIME_CACHE_PATH`
  (default `~/.cache/whoeverwants/showtimes_cache.json`). Cache the **raw normalized
  per-market payload keyed by `(market_id, fetch_date)`**; derive per-(cinema,date) views on read.
- Reuse `server/routers/search.py: _haversine_miles` for the radius filter against the directory.

---

## Architecture decisions

**New `question_type='showtime'`, reusing time's vote storage + winner math.**
- Each curated showtime is an `options[]` entry. Per-voter reactions store in the **existing**
  `votes.liked_slots` (= "want") / `votes.disliked_slots` (= "can't attend"). **No new vote
  columns.** No availability phase, no slot generation, no min-participants/exclusion machinery.
- **Winner reuses `algorithms/time_question.py:_pick_winner_from_reactions(options, votes)`**
  verbatim — it already does *fewest dislikes → most likes → earliest*, which **is**
  *max attendance → max likes → earliest* (attendance-max ≡ dislike-min). `vote_weight`
  (plus-ones) flows through for free.

**Option-key format reuses the time slot key** `"YYYY-MM-DD HH:MM-HH:MM"` (end = start + runtime)
so `lib/timeUtils.ts` parsers/sorters and the chronological winner tiebreak work unchanged.
Rich data lives in `options_metadata[key]` (see Data shapes). Same-cinema/same-minute/different-format
collisions are negligible for v1 (creator hand-picks specific sessions); if two picked sessions
share a key, append a numeric disambiguator.

**New `ShowtimeBubbles` component — reuse interaction, not layout.** Actual showtimes are *not*
on 15-min boundaries, so do **not** route them through `expandHourRowsToQuarters` (snaps to
:00/:15/:30/:45). New component: flex-wrap of arbitrary-minute bubbles grouped by day (and cinema),
each with a format/cinema tag + seats. **Reuse** TimeSlotBubbles' tri-state cycling, drag-to-select
range, legend, and `disabled` read-only mode (extract the gesture logic to a shared hook, or adapt).
Same component serves the creator's curation (2-state include/exclude) and the voter ballot
(3-state want/neutral/can't).

**One upfront cached load, then all client-side.** `GET /api/showtimes/nearby?lat&lng&radius&days=21`
returns the whole normalized catalog for the radius+horizon. The FE loads it once (progress
indicator), then movie-filter, calendar `allowedDays`, and per-day curation are pure client-side.

---

## Backend plan (`server/`)

### Data layer — `server/services/showtimes/`
- `alamo_cinemas.json` — static directory (the map). ~40 rows. Built once in Phase A.
- `alamo.py` — `fetch_market_sessions(market_id)`, `fetch_market_catalog(market_slug)`,
  `normalize(sessions, catalog, directory) -> list[Showtime]` joined on film id, attaching
  cinema coords/tz. Design a thin `ShowtimeSource` protocol so AMC/others slot in later
  (don't build them now).
- `cache.py` — per-(market, day) TTL/disk cache mirroring `search.py`'s favicon cache;
  per-(cinema, date) read views.

### Endpoint + routing
- New `server/routers/showtimes.py`: `GET /api/showtimes/nearby` → normalized
  `{ films: [{ film_id, name, year, rating, runtime, poster_url, sessions: [...] }] }`
  (a **dedicated router**, not under `/api/search` — it's a heavy cached catalog, not a
  per-keystroke Nominatim proxy).
- `next.config.ts`: add the 3-entry `/api/showtimes/(.*)` rewrites; add the browser-direct
  `API_ORIGIN` path (the May-2026 CORS-bypass — see CLAUDE.md). The `/preview`-style
  identity-free read needs no `X-Browser-Id`.

### Question-type plumbing (exact anchors)
- **Migration ~140** (next after 131/139): add `'showtime'` to **all three** CHECK constraints —
  `questions_question_type_check`, `votes_vote_type_check`, and `vote_structure_valid` (define
  showtime's allowed columns: liked/disliked set, `yes_no_choice IS NULL`, mirroring the `time`
  branch). **No new columns.**
- `server/models.py:9-13` — add `showtime = "showtime"` to `QuestionType`.
- `server/services/validation.py` — accept `'showtime'` wherever `time` is accepted.
- `server/routers/polls.py:_insert_question` (≈ lines 355-445) — for showtime, write
  `options` / `options_metadata` / `category` / `category_icon`; set the time-only columns
  (`day_time_windows`, `duration_window`, `min_availability_percent`, `time_min_participants`,
  `exclusion_tolerance`) to None/0; **skip `_finalize_time_slots`** (options arrive pre-finalized).
- `server/services/questions.py:_compute_results` (≈ lines 665-892) — add a `showtime` branch →
  `algorithms/showtime.py: calculate_showtime_results(votes, options)`.
- `_submit_vote_to_question` / `_edit_vote_on_question` already write `liked_slots`/`disliked_slots`;
  showtime sends those (no `voter_day_time_windows`).
- `server/algorithms/showtime.py` (new, ~30 lines):
  ```
  calculate_showtime_results(options, votes) -> dict:
      winner, like_counts, dislike_counts = _pick_winner_from_reactions(options, votes)
      total = sum(vote_weight(v) for v in non-abstain votes)
      attendance_counts = { opt: total - dislike_counts.get(opt, 0) for opt in options }
      return { winner, like_counts, dislike_counts, attendance_counts }
  ```
  (Import `_pick_winner_from_reactions` + `vote_weight`; no availability/cancel logic for v1.)
- `server/models.py` `QuestionResultsResponse` — reuse `like_counts` / `dislike_counts` / `winner`;
  optionally add `attendance_counts` (or let the FE derive `total − dislike`).

### Tests (Phase A/B)
- `server/tests/test_showtimes_adapter.py` — adapter normalize + join + radius filter against a
  fixture market payload (no live network in CI).
- `server/tests/test_showtime_poll.py` — create/vote/winner (mirror `test_time_poll.py`):
  attendance-max then like-max then earliest; plus-one weighting.

---

## Frontend plan

### Create flow (the big piece) — `showtime` branch of `app/create-poll/page.tsx`
State machine (component state; not all persisted to the draft):
1. **Location + radius** (required gate) — reuse `components/ReferenceLocationInput.tsx`
   + `components/SearchRadiusBubble.tsx`. "Load showtimes" on set.
2. **Loading** — indeterminate spinner "Loading showtimes near {label}…" while
   `apiShowtimesNearby(lat, lng, radius, 21)` runs.
3. **Movie pick** — filterable combobox over the **loaded catalog** (NOT `apiSearchMovies` —
   sourcing from the catalog guarantees every listed film has nearby sessions). Reuse the
   `AutocompleteInput`/`OptionLabel` styling for poster thumbnails + session counts; filter
   client-side (`searchDisabled` so it never hits the network).
4. **Calendar** — `components/DaysSelector.tsx` `inline compact` with **`allowedDays`** = the
   dates having sessions for the picked film in radius. (`allowedDays` prop already exists.)
5. **Per-day curation** — for each selected day, `ShowtimeBubbles` in select mode over that
   day's in-radius sessions (grouped by cinema; format + seats badges). Creator taps the viable ones.
6. **Submit** — `options` = selected keys; `options_metadata` = per-key rich data;
   `question_type/category='showtime'` + reference location. Auto-title "Showtime for {Film}".

`QuestionDraft` (`app/create-poll/createPollHelpers.ts`): reuse
`refLatitude/refLongitude/refLocationLabel/searchRadius/options/optionsMetadata`. Add ephemeral
component state `catalog / selectedFilmId / selectedDays` (catalog too big for localStorage —
persist location + chosen keys + selectedFilmId, re-fetch catalog on reopen). `draftToQuestionParams`
already maps reference location + options + options_metadata; add the showtime case (no
time-window/duration/availability fields).

### Ballot — `components/QuestionBallot.tsx`
Add a `showtime` branch → new `components/QuestionBallot/ShowtimeBallotSection.tsx` (single-phase
tri-state over `question.options`, want/neutral/can't-attend, reusing the wrapper Submit + name
gate + plus-ones). Vote via `apiSubmitPollVotes` with `vote_type:'showtime'` + liked/disliked —
add the case to `components/QuestionBallot/voteDataBuilders.ts` (`liked_slots`/`disliked_slots`,
no `voter_day_time_windows`).

### Results — `components/QuestionResults.tsx`
Add a `showtime` branch → `ShowtimeResults`: `ShowtimeBubbles` disabled + per-option want/can't
counts + a "Winner: {Film} · {time} @ {cinema} — N can attend, M want" line with the **ticketing
link** (`sales_url`). Add `CompactShowtimePreview` (winner pill) for the group card.

### Type-system ripple (small but several)
- `lib/types.ts` — `question_type` union `+= 'showtime'`; reuse `like_counts`/`dislike_counts`/`winner`
  on `QuestionResults` (+ optional `attendance_counts`).
- `lib/questionListUtils.ts` — `QUESTION_TYPE_SYMBOLS.showtime` (🎬), and `getCategoryIcon` /
  `getQuestionLabel` / `getQuestionSectionTitle` handling (special-case like `time`).
- `lib/api/_internal.ts` — `toQuestion` / `toQuestionResults` map any new fields.
- `lib/api/showtimes.ts` (new) — `apiShowtimesNearby(lat, lng, radius, days)`; re-export from
  `lib/api/index.ts`.
- `components/TypeFieldInput.tsx` `BUILT_IN_TYPES` + `app/create-poll/page.tsx` `BUBBLE_ENTRIES` —
  add the Showtime category (🎬). Gate it out of `isAutocompleteCategory` (its movie picker is
  catalog-sourced, not the per-option Nominatim autocomplete).
- `synthesizePlaceholderPoll` — optimistic placeholder for a showtime card.

---

## Reuse map

| Need | Reuse | New |
|---|---|---|
| Reference location + radius | `ReferenceLocationInput`, `SearchRadiusBubble`, `lib/geolocation`, `_haversine_miles` | — |
| Movie picker | `AutocompleteInput` filtering + `OptionLabel` poster chips | catalog-sourced data |
| Calendar (days w/ showtimes) | `DaysSelector inline compact allowedDays` | — |
| Showtime bubbles | TimeSlotBubbles tri-state + drag-select + legend + disabled (extract hook) | `ShowtimeBubbles` layout (arbitrary times) |
| Vote storage | `votes.liked_slots` / `disliked_slots`, `apiSubmitPollVotes`, plus-ones `vote_weight` | — |
| Winner algorithm | `_pick_winner_from_reactions` | `algorithms/showtime.py` wrapper (~30 LOC) |
| Caching pattern | `search.py` favicon disk cache, `_haversine_miles` | per-(market,day) showtime cache |
| Results display | TimeResults structure | `ShowtimeResults`, `CompactShowtimePreview` |

---

## Data shapes

**Option key:** `"YYYY-MM-DD HH:MM-HH:MM"` (start = showtime, end = start + runtime).

**`options_metadata[key]`:**
```json
{
  "session_id": "…", "film_id": "…", "film_name": "Dune: Part Two",
  "poster_url": "https://…", "cinema_id": "…", "cinema_name": "Alamo South Lamar",
  "cinema_slug": "south-lamar", "format": "70mm", "seats_left": 42,
  "sales_url": "https://drafthouse.com/…", "datetime": "2026-06-20T19:10:00-05:00",
  "runtime": 166
}
```

**`GET /api/showtimes/nearby` response:**
```json
{
  "reference": { "lat": 30.25, "lng": -97.75, "radius_miles": 25, "label": "Austin, TX" },
  "horizon_days": 21,
  "films": [{
    "film_id": "…", "name": "Dune: Part Two", "year": 2024, "rating": "PG-13",
    "runtime": 166, "poster_url": "https://…",
    "sessions": [{
      "key": "2026-06-20 19:10-21:56", "session_id": "…",
      "cinema_id": "…", "cinema_name": "Alamo South Lamar", "cinema_slug": "south-lamar",
      "date": "2026-06-20", "time": "19:10", "datetime": "2026-06-20T19:10:00-05:00",
      "format": "70mm", "seats_left": 42, "sales_url": "https://…"
    }]
  }]
}
```

---

## Phasing (for the implementation session)

- **A — De-risk the data** (standalone): cinema directory + Alamo adapter + per-(market,day)
  cache + `/api/showtimes/nearby` + a script printing real near-you results. **Confirms the
  on-sale window, market IDs, and the two-feed join before any UI.** Adapter unit tests on a fixture.
- **B — Type plumbing**: migration (3 CHECK constraints) + `QuestionType` + validation + models +
  `_compute_results` branch + vote path + `algorithms/showtime.py` + FE unions/mappers. Goal: a
  showtime poll **creatable/votable via API**, winner computed, no pretty UI. `test_showtime_poll.py`.
- **C — Create flow**: the location → load → pick → calendar → curate → submit machine.
- **D — Ballot + results + compact preview**: `ShowtimeBallotSection`, `ShowtimeResults`,
  `CompactShowtimePreview`, `voteDataBuilders` case, group-card icon/section-title wiring.
- **E — Polish + demo**: posters, ticketing links, format/seats badges, empty states; seed a real
  Alamo demo on the branch dev server and share the link.

## Out of scope (deferred, by owner decision)
- Self-healing / AI auto-discovery of endpoints (separate initiative; the `ShowtimeSource`
  protocol leaves room).
- Other chains (AMC official API is the natural second source; the directory + protocol make it additive).
- A public/hosted multi-chain aggregator (legal/operator concerns — fine at personal/limited scale only).
