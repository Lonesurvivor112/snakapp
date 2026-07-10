# 🍿 SnakApp

A personal snack catalog, recipe tracker, and weekly meal planner — built as a single-page web app with no framework, no build step, and no server. Runs entirely in the browser and syncs its database to a private GitHub repo, so the same data follows you from PC to iPhone.

**Live app:** https://lonesurvivor112.github.io/snakapp/

## Features

### 🍿 Snack Catalog
- Snacks with category, tags, star rating, notes, purchase link, and a picture (paste an image URL or upload a photo — uploads are auto-compressed and stored right in the database)
- **Import a snack** by pasting a store product URL (Kroger and others — the UPC barcode in the URL is looked up in Open Food Facts and UPCitemdb) or just by **typing its name** and picking from a photo grid of matches
- Filter by search, category, tag, rating, or favorites ❤️
- Categories and tags are fully editable in Settings (rename applies across all snacks)

### 📖 Recipe Tracker
- Paste any recipe URL — the importer extracts the structured Recipe schema (JSON-LD), falling back to a rendering reader service for bot-protected sites (AllRecipes, RecipeTin Eats, etc.), then to metadata, then to manual entry
- Ingredients, steps, prep/cook/total times, servings, photo, and source link
- **🍳 Cook mode**: tick off ingredients as you gather them and steps as you go — progress is saved, so you can close mid-recipe and pick up where you left off
- One tap adds a recipe to the snack catalog (or creates a recipe from a snack)

### 📅 Weekly Plan
- Generates 7 days of **snacks** and 7 days of **dinners** with one click
- Scoring balances your ratings, how recently something was planned (so the rotation stays fresh), and a dash of seeded randomness
- Variety rules: max per category, minimum homemade, no repeats from last week — all relaxed gracefully when the collection is small
- Edit any day by hand: clear it, pick a specific recipe/snack, or type a custom entry ("Pizza night")
- Save a week under a name and reload it later

### 🛒 Grocery List
- Select recipes (or pull in the whole week's dinners) and generate a combined shopping list
- Ingredients are parsed and merged across recipes with quantities summed — including unit-aware totals like "1 cup + 2 tbsp"
- Smart shopping logic: "4 skinless, boneless chicken breast halves" becomes **Chicken — ≈ 2 lb**, with the recipe's exact wording kept underneath; derived products (chicken broth, garlic powder) stay separate
- Check items off in the store — the list syncs, so build it on the PC and shop with your phone
- Save lists for later, add your own items, copy as text

### ☁️ Sync & Storage
- **Everything saves automatically** — browser storage on every change, plus:
- **Cloud Database**: syncs the whole database to a JSON file in a *private* GitHub repo via the Contents API. Works on every device; changes push ~1.5 s after you make them and other devices pick them up within a minute. Newest copy wins. A Sync Now button forces a round-trip before you close.
- **Live local file** (Chrome/Edge on desktop): optionally also mirror to a JSON file on disk in real time
- Export/Import the full database as a JSON download any time

### 📱 iPhone / PWA
- Installable: open in Safari → Share → **Add to Home Screen** for a full-screen app with an icon
- Works offline via a service worker; home-screen apps are exempt from Safari's storage eviction

## Setup

1. **Host the app** — this repo is served with GitHub Pages (Settings → Pages → deploy from branch). Any static host works.
2. **Create the database repo** — a second, **private** repo (e.g. `snakapp-db`) containing one file, `snakapp-db.json`. An empty starter file is included in this repo — copy it over (don't keep real data in the public repo).
3. **Create a token** — GitHub → Settings → Developer settings → Personal access tokens → **Fine-grained tokens**: repository access limited to the private db repo, permission **Contents: Read and write**.
4. **Connect** — in the app: Settings → Cloud Database → paste the token, confirm the repo name, Connect. Repeat on each device. The token is stored only in that device's browser.

## Tech

Vanilla HTML/CSS/JS — no dependencies, no build.

```
index.html            app shell: tabs, modals, settings
styles.css            styling (mobile-friendly, sliding tab bar)
sw.js                 service worker: offline cache, network-first
manifest.webmanifest  PWA manifest
icons/                app icons
js/
  storage.js          localStorage + live-file sync + GitHub cloud sync
  importer.js         recipe & product import (JSON-LD, reader fallback, barcode/name lookup)
  planner.js          weekly snack & dinner generators (seeded RNG, variety constraints)
  grocery.js          ingredient parsing, merging, and purchase estimates
  app.js              all UI wiring and rendering
```

External services used at runtime (all free, no keys): Open Food Facts (barcode & name lookup), UPCitemdb (barcode fallback), r.jina.ai (rendering reader for protected recipe sites), assorted CORS proxies, and the GitHub API (your own private repo, with your token).

## Privacy

- The app itself contains no data — this public repo is only code.
- Your database lives in your browser and in **your private GitHub repo**; reading it requires your token.
- Recipe/product imports send only the URL or search term to the lookup services.

---
