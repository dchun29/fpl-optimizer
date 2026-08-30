# Matchday — FPL Team Selector

Weekly Fantasy Premier League optimizer: pulls your live squad, scores every
player for the next gameweek (FPL's own expected-points model, adjusted for
fixture difficulty and injury/suspension status), then recommends your
starting XI, captain/vice-captain, and up to three transfers.

## How it works

- **`/api/fpl.js`** — a Vercel serverless function that proxies the public
  `fantasy.premierleague.com/api/*` endpoints. The FPL API doesn't send CORS
  headers, so the browser can't call it directly; this function fetches
  server-side and hands the JSON back.
- **`src/lib/optimizer.js`** — the scoring and selection logic:
  - Each player's score = FPL's `ep_next` (or a form/PPG blend if that's
    missing), nudged for their next fixture's difficulty rating, scaled down
    by their chance of actually playing (from `chance_of_playing_next_round`
    / status flags).
  - Starting XI: tries every valid formation (3–5 DEF, 2–5 MID, 1–3 FWD) and
    picks the one with the highest total score from your 15-man squad.
  - Captain/vice: the two highest scorers in your starting XI.
  - Transfers: for your weakest/flagged squad members, checks whether an
    affordable same-position replacement scores meaningfully higher.
- **`src/components/PitchView.jsx`** — draws your starting XI on a pitch
  diagram in their formation, with a gold armband on the captain.
- **`/api/my-team.js`** — optional: logs into your FPL account server-side
  (using `FPL_EMAIL` / `FPL_PASSWORD` env vars) to pull your *exact* sell
  prices, bank, and free-transfer count from the authenticated `my-team`
  endpoint. The public API only exposes current market price, not what
  you'd actually get for selling a player (FPL keeps 50% of any price rise,
  rounded down), so this closes that gap. If the env vars aren't set, or
  login fails, the app falls back to the market-price estimate automatically
  — nothing breaks either way.

## Optional: exact prices via your FPL login

1. In your Vercel project, go to **Settings → Environment Variables**.
2. Add `FPL_EMAIL` and `FPL_PASSWORD` (your normal fantasy.premierleague.com
   login). Mark them **Production** (and Preview if you use it).
3. Redeploy. The header will show "● Live prices from your account" once
   it's working; otherwise it silently falls back to estimates.

These credentials are read only inside the serverless function to log in on
your behalf — they're never sent to the browser, never logged, and the
`my-team` response is served with `Cache-Control: no-store`. Still, this is
a real password sitting in your project config, which is a step up in
sensitivity from the Team-ID-only setup — skip this if you'd rather not.

## Run locally

```bash
npm install
npm run dev
```

Note: `/api/fpl` only works when served by Vercel (locally, use `vercel dev`
instead of `npm run dev` if you want the proxy to work, or just deploy).

## Deploy (same flow as your CTA tracker)

```bash
git init
git add .
git commit -m "Matchday FPL optimizer"
gh repo create fpl-optimizer --public --source=. --push
```

Then import the repo at [vercel.com/new](https://vercel.com/new) — no config
needed, Vercel auto-detects the Vite frontend and the `/api` serverless
function.

## Finding your Team ID

In the FPL app or site, go to **Points** or **My Team** — your Team ID is
the number in the URL: `fantasy.premierleague.com/entry/`**`1234567`**`/event/1`.
Enter it once; it's saved in your browser (`localStorage`) so you won't need
to re-enter it.

## Known limitations

- **Sell price** is approximated as the player's current market price. FPL's
  actual sell price can be a few tenths of a million lower if the player has
  risen in price since you bought them (their profit-sharing rule), so treat
  the transfer budget as a close estimate, not gospel.
- **Free transfers** aren't available from the public API (chip usage,
  saved transfers, etc. aren't exposed), so you tell the app how many you
  have via the dropdown — it uses that only to flag which suggested
  transfers would cost a -4 hit.
- Projections are a planning aid based on FPL's own point projections and
  fixture ratings — not a betting model. Always sanity-check flagged/
  doubtful players close to the deadline.
