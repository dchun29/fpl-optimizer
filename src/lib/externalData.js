// Early in a season, FPL's own bootstrap-static hasn't populated granular
// team attack/defence ratings yet (they come back as 0 — see
// buildLeagueAverages in projections.js) and every player's own xG/xA per
// 90 is based on a tiny, noisy sample of minutes. This module pulls in two
// supplementary signals, both free and requiring no API key:
//
// 1. FPL's own official Fixture Difficulty Rating (team_h_difficulty /
//    team_a_difficulty on the fixtures endpoint) — already fetched by this
//    app, just not used yet. Wired in directly in projections.js.
// 2. Last season's final team ratings and player-level xG/xA rates, from
//    vaastav/Fantasy-Premier-League — a long-running, MIT-licensed
//    community mirror of FPL's own historical data, updated through the
//    current season. Fetched here.
//
// Both last-season fetches are best-effort: if GitHub is unreachable, the
// repo layout changes, or a particular season's file is missing, they
// resolve to {} rather than throwing, so the app works exactly as before —
// just without the enrichment — rather than failing to load.

const REPO_BASE = 'https://raw.githubusercontent.com/vaastav/Fantasy-Premier-League/master/data';

/**
 * Minimal CSV parser (quoted fields, embedded commas, doubled-quote
 * escapes) — good enough for this dataset without pulling in a library.
 */
function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ',') {
      row.push(field);
      field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else {
      field += c;
    }
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.length > 1 || r[0] !== '');
}

function rowsToObjects(rows) {
  const [header, ...body] = rows;
  if (!header) return [];
  return body.map((r) => Object.fromEntries(header.map((h, i) => [h, r[i]])));
}

function num(v) {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * Season folder names (e.g. "2025-26") this app's current data belongs to
 * and the one before it, derived from the first gameweek's deadline date
 * rather than hardcoded, so this doesn't need a manual update every year.
 */
export function deriveSeasons(bootstrap) {
  const firstDeadline = bootstrap?.events?.[0]?.deadline_time;
  const startYear = firstDeadline ? new Date(firstDeadline).getFullYear() : new Date().getFullYear();
  const two = (y) => String(y).slice(-2);
  return {
    current: `${startYear}-${two(startYear + 1)}`,
    previous: `${startYear - 1}-${two(startYear)}`,
  };
}

/**
 * Last season's final team attack/defence ratings, keyed by each team's
 * stable cross-season `code` (not `id`, which isn't guaranteed stable
 * across seasons). Used as a fallback in projectFixture when the current
 * season hasn't populated these fields yet — a real per-team signal
 * instead of a single flat league-average constant.
 */
export async function fetchLastSeasonTeamStrength(previousSeason) {
  try {
    const res = await fetch(`${REPO_BASE}/${previousSeason}/teams.csv`);
    if (!res.ok) return {};
    const rows = rowsToObjects(parseCsv(await res.text()));
    const byCode = {};
    for (const r of rows) {
      const code = num(r.code);
      if (code == null) continue;
      const entry = {
        attack_home: num(r.strength_attack_home),
        attack_away: num(r.strength_attack_away),
        defence_home: num(r.strength_defence_home),
        defence_away: num(r.strength_defence_away),
      };
      // Only keep it if it's real data — guards against a season whose
      // archived snapshot was itself captured with these fields unset.
      if (Object.values(entry).some((v) => v > 0)) byCode[code] = entry;
    }
    return byCode;
  } catch {
    return {};
  }
}

/**
 * Last season's per-90 xG/xA for every player who played a meaningful
 * amount, keyed by stable cross-season `code`. Used to shrink this
 * season's still-tiny-sample rate toward a track record (see the `shrink`
 * helper in projections.js' projectPlayer) — so 1-2 gameweeks of noise
 * doesn't wildly over- or understate a player's real level. Players with a
 * short prior-season stint (under 2 full games) are dropped rather than
 * kept as a noisy prior in their own right.
 */
export async function fetchLastSeasonPlayerRates(previousSeason) {
  try {
    const res = await fetch(`${REPO_BASE}/${previousSeason}/players_raw.csv`);
    if (!res.ok) return {};
    const rows = rowsToObjects(parseCsv(await res.text()));
    const byCode = {};
    for (const r of rows) {
      const code = num(r.code);
      const minutes = num(r.minutes);
      if (code == null || !minutes || minutes < 180) continue;
      byCode[code] = {
        xG90: num(r.expected_goals_per_90) ?? 0,
        xA90: num(r.expected_assists_per_90) ?? 0,
        minutes,
      };
    }
    return byCode;
  } catch {
    return {};
  }
}

/**
 * This season's per-gameweek game log for every player who's played a
 * minute, from the same community mirror as the two fetches above —
 * `gws/merged_gw.csv` is one row per player per gameweek and gets updated
 * after every round. Keyed by `element`, which (unlike `code` above) is
 * safe to match directly against this season's own bootstrap element ids,
 * since both come from the same season.
 *
 * This is what makes it possible to look at recent form and game-to-game
 * variance instead of a single season-to-date average — see
 * lib/formSignals.js. A player's season aggregate can look identical
 * whether it came from six steady games or one huge outlier and five
 * blanks; this is the data needed to tell those two apart.
 */
export async function fetchCurrentSeasonGameLogs(currentSeason) {
  try {
    const res = await fetch(`${REPO_BASE}/${currentSeason}/gws/merged_gw.csv`);
    if (!res.ok) return {};
    const rows = rowsToObjects(parseCsv(await res.text()));
    const byElement = {};
    for (const r of rows) {
      const element = num(r.element);
      const round = num(r.round);
      if (element == null || round == null) continue;
      const expectedGoals = num(r.expected_goals) ?? 0;
      const expectedAssists = num(r.expected_assists) ?? 0;
      const entry = {
        round,
        minutes: num(r.minutes) ?? 0,
        starts: num(r.starts) ?? 0,
        expectedGoalInvolvements: num(r.expected_goal_involvements) ?? expectedGoals + expectedAssists,
        bonus: num(r.bonus) ?? 0,
        totalPoints: num(r.total_points) ?? 0,
      };
      (byElement[element] = byElement[element] || []).push(entry);
    }
    for (const gameLog of Object.values(byElement)) gameLog.sort((a, b) => a.round - b.round);
    return byElement;
  } catch {
    return {};
  }
}
