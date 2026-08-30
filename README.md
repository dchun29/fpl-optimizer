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
- **`src/lib/projections.js`** — a from-scratch expected-points model, built
  up from underlying stats instead of leaning on FPL's own `ep_next`:
  - Attacking return (goals/assists) from each player's xG/xA per 90,
    scaled by their actual playing-time pattern and adjusted for the
    opponent's defensive strength (using the teams' home/away attack &
    defence ratings, not just the single 1-5 difficulty number).
  - Clean-sheet probability derived the same way, feeding clean-sheet
    points and an expected-goals-conceded penalty for GK/DEF.
  - A bonus-points estimate from each player's season bonus-per-game rate.
  - Everything is scaled by immediate availability (injury/suspension
    status), and projected across the next 6 gameweeks — so a double
    gameweek sums both fixtures, a blank scores zero, and near-term weeks
    count more than distant ones (decaying weights).
- **`src/lib/optimizer.js`** — starting XI (best valid formation from the
  15-man squad), captain/vice (top two scorers), and the transfer search:
  every squad player is checked against every affordable same-position
  replacement (not just the weakest one), using the 6-week horizon score,
  plus a paired-transfer search among the 8 weakest/most-flagged squad
  members for double-transfer plans — each shown with its -4 hit cost and
  net gain after the hit.
- **`src/lib/chipAdvisor.js`** — scans the fixture list for double and
  blank gameweeks among your squad's teams (Bench Boost / Free Hit
  triggers), finds the single highest-ceiling gameweek for any squad player
  (Triple Captain), and flags when your weakest four players are projected
  well below your squad average (Wildcard signal). Only fires when the
  signal is strong — otherwise says so plainly, since doubles/blanks are
  usually confirmed only a few weeks out.
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

- **The projection model is a heuristic, not a betting-grade model.** It's
  built from public underlying stats (xG/xA, bonus history, team
  attack/defence ratings) with a reasonably principled formula, but it
  hasn't been backtested against actual results — treat it as a
  well-informed second opinion, not gospel. Always sanity-check flagged
  players and confirmed lineups close to the deadline.
- **New signings / returning-from-injury players** can look undervalued:
  their `minutes` total only covers games since they were available, but
  the model divides by the season's total games played, understating their
  per-game rate. This self-corrects as they accumulate more games.
- **Doubles/blanks** only show up once the fixture list has an event number
  assigned to them, which the Premier League/FPL usually confirms only a
  few gameweeks ahead of a rearrangement — so the chip advisor may go quiet
  even in seasons that end up having them later on.
- **Sell price** is approximated as the player's current market price
  unless you've set up the optional FPL login (see above). FPL's actual
  sell price can be a few tenths of a million lower if the player has risen
  in price since you bought them (their profit-sharing rule).
- **Free transfers** default to a manual dropdown unless you've set up the
  optional FPL login, which pulls your exact count automatically.
