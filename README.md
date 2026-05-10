# Calorie & Protein Tracker

A self-hosted calorie + protein tracker focused on the two metrics that actually matter for body composition. Type meals in plain English ("3 scrambled eggs and a slice of toast") and AI parses them into structured nutrition data, then cross-checks against USDA / FatSecret / OpenFoodFacts databases for accuracy.

## Features

- **Plain-English meal logging** — AI parses your text into items + macros
- **Database verification** — USDA Foundation lab data + FatSecret + OpenFoodFacts cross-check the AI's estimates
- **Today view** — kcal ring, protein bar, water bottle, day-of-day pacing, meal-period grouping (breakfast/lunch/dinner)
- **History** — calendar grid, 30-day kcal trend, day-of-week pattern chart, last-7-days review card
- **TDEE calibration** — auto-corrects your maintenance calories based on observed weight + intake
- **Recipes** — guided recipe builder (pick ingredients → effort level → 3 ideas → full recipe)
- **Templates + favorites** — one-tap log meals you eat often
- **Cost-capped** — daily token + dollar caps prevent runaway AI spend

## Quick start

### Requirements
- [Node.js](https://nodejs.org/) v18 or newer
- An OpenAI API key (and optionally USDA + FatSecret keys for better food matching)

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

### Run

```bash
npm start
```

Open <http://localhost:3000> in your browser.

On Windows you can also double-click `restart.bat` to kill any old server on port 3000 and start a fresh one in a minimised window.

### First run

The app shows a 4-step onboarding wizard the first time you open it: basics (height/weight/age/sex) → activity level → goal → summary with your calculated targets.

## Usage tips

- **Logging a meal**: click the green `+ Log meal` button (or press `L`), type what you ate, click `Parse with AI`. Save when you're happy with the breakdown. Tap the pencil/edit icon on a logged meal to fix kcal/macros/time.
- **Backfilling**: in the History tab, click any past day → `+ Add meal` to log something you forgot.
- **Saving food values**: when AI gets something wrong (low/medium confidence), click `Save as my food` to teach the app the correct value. Next time you log that food, it skips AI and uses your value.
- **Templates**: log a meal once, then click `+ Template` to save the combo. One tap to log it again.
- **Keyboard shortcuts**: `1`–`5` switch tabs, `L` opens the log modal, `Esc` closes modals.

## Cost & API usage

Built around `gpt-5-nano` ($0.05 / $0.40 per million tokens) by default. With the daily caps in place the most you can spend per day is what `DAILY_COST_CAP_USD` is set to (default: $2).

Real-world usage on a normal 3-meal day is around 3 cents. Heavy use (lots of recipe generation, rescans) tops out around 30 cents.

Every AI call is logged to `data/ai_calls.log` (one JSON line per call) and printed to the server console with model name + token counts, so you can see exactly what's being charged.

## Data storage

Everything is local JSON files in `data/`:

- `log.json` — meal entries by date
- `profile.json` — your stats
- `weight.json` — weight history
- `templates.json` — saved meal combos
- `custom_foods.json` — your verified food values
- `water.json` — water tracking
- `usage.json` — AI usage tracking (last 1000 calls)
- `ai_calls.log` — append-only audit log of every AI call

No external database, no cloud. Back up the `data/` folder if you want to keep your history.

## Project structure

```
calories/
├── server.js                 — Express server + all API endpoints
├── public/
│   ├── index.html            — single-page UI shell
│   ├── styles.css            — main styles
│   ├── css/
│   │   ├── ai-loaders.css    — animated loading screens
│   │   └── onboarding.css    — first-run wizard
│   └── js/
│       ├── helpers.js        — $, api(), state, glossify, refreshAfterChange
│       ├── ai-loaders.js     — random animated loaders during AI waits
│       ├── edu-content.js    — protein/fat/carb/fiber education content
│       ├── water.js          — water tracking
│       ├── log-modal.js      — meal logging + edit + parse + rescan
│       ├── templates-favorites.js  — template + favorite UI
│       ├── today.js          — Today view (the big one)
│       ├── recipes.js        — recipe builder + snack
│       ├── profile.js        — profile form + TDEE calibration card
│       ├── history.js        — calendar + trends + day-of-week + weekly review
│       ├── dev.js            — health checks + usage stats
│       ├── onboarding.js     — first-run wizard
│       └── init.js           — boots loadToday() + nav handlers
└── data/                     — JSON storage (gitignored)
```

## License

Personal project, do whatever you want with it.
