# Calorie & Protein Tracker

A self-hosted calorie + protein tracker focused on the two metrics that actually matter for body composition. Type meals in plain English ("3 scrambled eggs and a slice of toast") and AI parses them into structured nutrition data, then cross-checks against USDA / FatSecret / OpenFoodFacts databases for accuracy.

## Features

- **Plain-English meal logging** — AI parses your text into items + macros
- **Database verification** — USDA Foundation lab data + FatSecret + OpenFoodFacts cross-check the AI's estimates
- **Today view** — kcal ring, protein bar, water bottle, day-of-day pacing, meal-period grouping (breakfast/lunch/dinner)
- **History** — calendar grid, 30-day kcal trend, day-of-week pattern chart, last-7-days review card
- **TDEE calibration** — auto-corrects your maintenance calories based on observed weight + intake
- **Templates + favorites** — one-tap log meals you eat often
- **Cost-capped** — daily token + dollar caps prevent runaway AI spend

## Quick start

### Requirements
- [Node.js](https://nodejs.org/) v18 or newer
- An OpenAI API key (and optionally USDA + FatSecret keys for better food matching)
- A Discord application for OAuth login. Free to create at <https://discord.com/developers/applications> — the app gates `/api/*` behind a signed-cookie session and an allow-list of Discord user IDs, so even when you self-host it stays private.

### Install

```bash
git clone <repo-url> calories
cd calories
npm install
```

### Configure

Copy `.env.example` to `.env` and fill in your keys:

```bash
cp .env.example .env
```

Then edit `.env`:

```
OPENAI_API_KEY=sk-...
OPENAI_MODEL=gpt-5-nano

# --- Discord OAuth (required to log in) ---
DISCORD_CLIENT_ID=...
DISCORD_CLIENT_SECRET=...
DISCORD_REDIRECT_URI=https://YOUR-DOMAIN/auth/discord/callback
# Generate with: node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
SESSION_SECRET=...
# Comma-separated list of Discord user IDs allowed to log in (yours, plus anyone else)
ALLOWED_DISCORD_IDS=123456789012345678

# Optional but recommended — improves food lookup accuracy and caches results
USDA_API_KEY=...                    # free at https://fdc.nal.usda.gov/api-key-signup.html
FATSECRET_CLIENT_ID=...              # free at https://platform.fatsecret.com/
FATSECRET_CLIENT_SECRET=...

# Hard daily spend caps — adjust as you like
DAILY_TOKEN_CAP=500000
DAILY_COST_CAP_USD=2

# Set to 1 to disable all AI calls (use manual entry only)
AI_DISABLED=0
```

**On the Discord developer portal**: create an application → OAuth2 → add the redirect URI exactly matching `DISCORD_REDIRECT_URI`. For local dev use `http://localhost:3000/auth/discord/callback`. Get your Discord user ID by enabling Developer Mode in Discord settings → right-click your name → Copy User ID.

**In production**, the server refuses to start if `SESSION_SECRET` is unset (signed cookies must not fall back to a known default). Locally (no `NODE_ENV=production`), the fallback is allowed for convenience.

### Run

```bash
npm start
```

Open <http://localhost:3000> in your browser.

On Windows you can also double-click `restart.bat` to kill any old server on port 3000 and start a fresh one in a minimised window.

### First run

You'll see a login screen. Click **Log in with Discord**, approve the OAuth prompt, and (if your Discord ID is in `ALLOWED_DISCORD_IDS`) you'll land on the main app. The first time you log in, a 4-step onboarding wizard runs: basics (height/weight/age/sex) → activity level → goal → summary with your calculated targets.

Each Discord user gets their own data directory under `data/users/<discord_id>/` — multiple people on the allow-list never see each other's logs.

## Usage tips

- **Logging a meal**: click the green `+ Log meal` button (or press `L`), type what you ate, click `Parse with AI`. Save when you're happy with the breakdown. Tap the pencil/edit icon on a logged meal to fix kcal/macros/time.
- **Backfilling**: in the History tab, click any past day → `+ Add meal` to log something you forgot.
- **Saving food values**: when AI gets something wrong (low/medium confidence), click `Save as my food` to teach the app the correct value. Next time you log that food, it skips AI and uses your value.
- **Templates**: log a meal once, then click `+ Template` to save the combo. One tap to log it again.
- **Keyboard shortcuts**: `1`–`5` switch tabs, `L` opens the log modal, `Esc` closes modals.

## Cost & API usage

Built around `gpt-5-nano` ($0.05 / $0.40 per million tokens) by default. With the daily caps in place the most you can spend per day is what `DAILY_COST_CAP_USD` is set to (default: $2).

Real-world usage on a normal 3-meal day is around 3 cents. Heavy use (lots of rescans, suggestions) tops out around 30 cents.

Every AI call is logged to `data/ai_calls.log` (one JSON line per call) and printed to the server console with model name + token counts, so you can see exactly what's being charged.

## Data storage

Everything is local JSON files in `data/`. Per-user files live under `data/users/<discord_id>/`; server-wide files live at the top of `data/`:

**Per user** (`data/users/<discord_id>/`):

- `log.json` — meal entries by date
- `profile.json` — your stats
- `weight.json` — weight history
- `templates.json` — saved meal combos
- `custom_foods.json` — your verified food values
- `water.json` — water tracking

**Server-wide** (`data/`):

- `sessions.json` — active login sessions (cleared on logout / expiry)
- `usage.json` — AI usage tracking (last 1000 calls, trimmed)
- `ai_calls.log` — append-only audit log of every AI call

All read-modify-write access to these files is serialized through a per-path mutex so concurrent requests can't lose entries.

No external database, no cloud. Back up the `data/` folder if you want to keep your history. The `/api/export/json` endpoint also bundles your data for download — see Backup/Restore below.

### Backup & restore

- `GET /api/export/json` → downloads `calories-backup-YYYY-MM-DD.json` containing all of your user's data.
- `GET /api/export/csv` → flat CSV of your meal log.
- `POST /api/import` accepts the JSON bundle back with `?mode=merge` (deduplicates by entry id) or `?mode=replace` (overwrites).

## Project structure

```
calories/
├── server.js                 — Express server + all API endpoints
├── electron/main.js          — optional desktop shell (loads localhost:3000)
├── public/
│   ├── index.html            — single-page UI shell
│   ├── styles.css            — main styles (uses CSS vars for colours + z-index scale)
│   ├── css/
│   │   ├── ai-loaders.css    — animated loading screens
│   │   ├── login.css         — pre-auth login screen
│   │   └── onboarding.css    — first-run wizard
│   └── js/
│       ├── helpers.js        — $, api(), state, glossify, fmtDate, round1, pctOf
│       ├── auth.js           — login screen + logout + session check
│       ├── ai-loaders.js     — random animated loaders during AI waits
│       ├── edu-content.js    — protein/fat/carb/fiber education content
│       ├── water.js          — water tracking
│       ├── log-modal.js      — meal logging + edit + parse + rescan
│       ├── templates-favorites.js  — template + favorite UI
│       ├── today.js          — Today view (the big one)
│       ├── profile.js        — profile form + TDEE calibration card
│       ├── history.js        — calendar + trends + day-of-week + weekly review
│       ├── dev.js            — health checks + usage stats
│       ├── onboarding.js     — first-run wizard
│       └── init.js           — boots loadToday() + nav handlers
├── tests/                    — node:test suite (see Tests section)
│   ├── helpers.test.js
│   ├── parse-helpers.test.js
│   ├── favorites.test.js
│   ├── api.test.js
│   └── startup.test.js
└── data/                     — JSON storage (gitignored)
    └── users/<discord_id>/   — per-user meal data
```

## Tests

```bash
npm test
```

Uses Node's built-in test runner (`node --test`) — no extra dev dependencies. Requires Node 18+. The suite finishes in ~1.6s (the startup tests dominate; the rest is sub-100ms).

The five test files cover the highest-risk surfaces from the codebase audit:

- **[tests/helpers.test.js](tests/helpers.test.js)** — pure utility functions: `round1`, `fmtDate`, `todayStr`, `readJson`/`writeJson`, `normalizeFoodName`, `customLookup`, `isRelevantMatch`. Includes dedicated `withFileLock` tests asserting (a) serialization on the same path, (b) parallelism on different paths, (c) that a rejected operation doesn't poison the chain.
- **[tests/parse-helpers.test.js](tests/parse-helpers.test.js)** — the decomposed `/api/parse` pipeline: `initialFinals`, `applyCustomFood`, `applySanityCaps`. Includes an explicit regression test for the `qty=0` bug (`?? 1` vs the old `|| 1`).
- **[tests/favorites.test.js](tests/favorites.test.js)** — `computeFavorites`: frequency ranking, 8-item cap, case-insensitive grouping, kcal/protein averaging, `last_*` fields tracking the newest entry.
- **[tests/api.test.js](tests/api.test.js)** — live HTTP integration. Boots the Express app on a random port (`app.listen(0)`), isolates writes into a tmpdir via `CALORIES_DATA_DIR`, mints a test session cookie that bypasses Discord OAuth, then exercises the auth gate, `/api/profile`, `/api/log` CRUD, `/api/templates`, `/api/custom-foods`, `/api/favorites` cache, and the export endpoints. Includes a **10-way concurrent POST to `/api/water`** as a regression test for the per-file mutex — all 10 entries must persist.
- **[tests/startup.test.js](tests/startup.test.js)** — spawns `node server.js` as a subprocess. Verifies the production fail-fast: `NODE_ENV=production` with no `SESSION_SECRET` must exit non-zero with a clear message; with `SESSION_SECRET` set, the server boots and logs the startup banner; dev mode never fail-fasts.

### Running a single file

```bash
node --test tests/api.test.js
```

### Why test isolation matters

`tests/api.test.js` sets `process.env.CALORIES_DATA_DIR` to a fresh `os.tmpdir()` subdirectory **before** requiring `server.js`. That env var is captured at module load (see `DATA_DIR` in [server.js](server.js)), so tests can't write to your real `data/` folder. The tmpdir is removed in `test.after`.

## License

Personal project, do whatever you want with it.
