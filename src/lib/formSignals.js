// "Next layer" display signals that sit alongside the projection model
// rather than inside it. Nothing here changes a player's score or affects
// lineup/transfer ranking — these exist purely to surface context a manager
// would otherwise have to go dig up by hand: who actually takes set pieces,
// whether recent form is trending up or down right now, and whether a
// player's season-to-date numbers are quietly built on one big game rather
// than a repeatable pattern.
//
// That last one is aimed directly at cases like De Cuyper: 17 points in
// week 1 off a huge, unusual expected-goals number, then almost nothing in
// week 2. The season-average stat the projection model scores off treats
// those two games as equally representative; a manager glancing at the
// average alone has no way to tell a genuine breakout from a single lucky
// afternoon. These functions make that distinction visible instead of
// letting it hide inside an average.

/**
 * Set-piece duty from FPL's own bootstrap data — penalties_order,
 * direct_freekicks_order, and corners_and_indirect_freekicks_order are
 * already present on every element from the bootstrap-static fetch this
 * app makes every load; they've just never been read until now. Order 1
 * means first-choice taker; anything else (2, 3, null) is a backup or not
 * on the list at all, so only order 1 is surfaced as a tag to keep this
 * meaningful rather than noisy.
 */
export function deriveSetPieceRoles(el) {
  const roles = [];
  if (el.penalties_order === 1) roles.push('Penalties');
  if (el.direct_freekicks_order === 1) roles.push('Free kicks');
  if (el.corners_and_indirect_freekicks_order === 1) roles.push('Corners');
  return roles;
}

const RECENT_WINDOW = 3;
const RECENT_MIN_MINUTES = 45; // below this, a "rate" is too noisy to show at all

/**
 * Expected-goal-involvement rate over the last few gameweeks only (most
 * recent games, not the full season) — a separate read on "what's
 * happening right now" alongside the season-long, shrinkage-adjusted score
 * used elsewhere. `gameLog` is this player's array from
 * fetchCurrentSeasonGameLogs, oldest first.
 */
export function computeRecentForm(gameLog) {
  if (!gameLog || gameLog.length === 0) return null;
  const recent = gameLog.slice(-RECENT_WINDOW);
  const minutes = recent.reduce((sum, g) => sum + g.minutes, 0);
  if (minutes < RECENT_MIN_MINUTES) return null;
  const xgi = recent.reduce((sum, g) => sum + g.expectedGoalInvolvements, 0);
  return {
    games: recent.length,
    xGI90: Math.round((xgi / minutes) * 90 * 100) / 100,
  };
}

const OUTLIER_SHARE_THRESHOLD = 0.6; // one game carrying 60%+ of the season's underlying output
const OUTLIER_MIN_GAMES = 2; // need at least two games played before "one game dominates" is meaningful

/**
 * Flags a player whose season-to-date expected-goal-involvement total is
 * dominated by a single game, rather than accumulated gradually across
 * several — the exact shape of a one-off spike getting mistaken for a
 * trend. Returns null when there isn't enough of a season yet to judge, or
 * when output is spread out normally.
 */
export function computeOutlierFlag(gameLog) {
  if (!gameLog || gameLog.length < OUTLIER_MIN_GAMES) return null;
  const total = gameLog.reduce((sum, g) => sum + g.expectedGoalInvolvements, 0);
  if (total <= 0) return null;
  const best = gameLog.reduce((m, g) => (g.expectedGoalInvolvements > m.expectedGoalInvolvements ? g : m));
  const share = best.expectedGoalInvolvements / total;
  if (share < OUTLIER_SHARE_THRESHOLD) return null;
  return {
    round: best.round,
    sharePct: Math.round(share * 100),
  };
}

