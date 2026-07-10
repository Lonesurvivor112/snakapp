# SnakApp — Project Plan

**Quick answer:** Build a lightweight single-page app that stores a snack catalog, a recipe tracker that auto-extracts structured recipe data from URLs when available, and a randomized weekly snack planner that enforces variety rules. Use Recipe Schema (JSON-LD) as the primary extractor, fall back to OpenGraph/HTML parsing, and offer manual entry for anything the scraper misses.

## Project overview

- **Goal:** A personal web app to collect snacks, save recipes (auto-ingest when possible), browse/filter, and generate weekly snack plans with variety constraints.
- **Stack suggestion:** HTML/CSS/Vanilla JS or React for UI; IndexedDB or localStorage for local-only; optional small backend (Node + SQLite) if you want sync or sharing.

---

## Core features

- **Snack Catalog:** name, category (sweet/savory), tags, rating, image URL, notes, purchase link. *(Essential)*
- **Recipe Tracker:** store recipe title, ingredients, steps, prep/cook times, servings, image, source URL. Auto-ingest from recipe pages using structured data when present.
- **URL Importer:** paste recipe URL → app attempts to extract JSON-LD Recipe schema; if found, populate fields; otherwise try OpenGraph or microdata; finally show manual editor.
- **Randomized Weekly Builder:** generate 7 snack suggestions with rules (no repeat category more than twice, prioritize high-rated items, include at least 2 homemade recipes per week).
- **Browse & Filter:** by tag, dietary restriction, prep time, rating.
- **Favorites & Collections:** quick access lists (e.g., "Movie Night", "Office Snacks").
- **Export/Share:** copy recipe text or share link (local export only unless you add backend).

---

## Data model (high level)

- **Snack:** id; name; category; tags; rating; image; notes; sourceUrl; isRecipeRef (bool).
- **Recipe:** id; name; ingredients[]; instructions[]; prepTime; cookTime; totalTime; servings; nutrition; image; sourceUrl; rawSchema (store original JSON-LD).

---

## Recipe ingestion approach (comparison)

| Method | Accuracy | Speed | Complexity |
|---|---|---|---|
| Recipe Schema (JSON-LD) | High | Fast | Low |
| OpenGraph / meta tags | Medium | Fast | Low |
| Headless render + DOM parse | High | Slow | High |

Use Recipe Schema first; it's the standard structured format and JSON-LD is generally preferred.

---

## Randomized weekly builder algorithm (outline)

1. Filter candidate snacks by availability and user constraints.
2. Score each item: `score = 0.6*rating + 0.3*(freshnessPriority) + 0.1*(noveltyBoost)`.
3. Greedy pick for 7 slots while enforcing: max 2 same category, at least 2 homemade, no exact repeats from previous week.
4. Offer "regenerate" with seed to keep reproducible randomness.

---

## Risks, tradeoffs, and suggestions

- **Scraping reliability:** Not all sites publish Recipe schema; fallback parsing is necessary.
- **Legal/ethical:** Respect robots.txt and site terms; avoid heavy automated crawling.
- **Storage choice:** Local storage is simplest; add a backend only if you need cross-device sync.
- **UX tip:** Provide an inline editor after import so users can correct missing fields; store original JSON-LD for provenance.

---

## Next steps (practical)

- Build a clickable prototype of the snack catalog and URL importer.
- Implement JSON-LD extractor and test on 10 recipe sites.
- Add the weekly generator and a simple UI for constraints and regeneration.
