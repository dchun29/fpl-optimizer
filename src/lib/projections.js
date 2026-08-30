// A from-scratch expected-points model. Instead of leaning on FPL's own
// ep_next figure, this builds points up from underlying attacking output
// (xG/xA per 90), clean-sheet probability derived from team attack/defence
// ratings, bonus-point history, and each player's actual playing-time
// pattern — then projects that across a multi-gameweek horizon so fixture
// swings, doubles, and blanks all feed into the numbers.

const GOAL_PTS = { 1: 10, 2: 6, 3: 5, 4: 4 };
const CS_PTS = { 1: 4, 2: 4, 3: 1, 4: 0 };
const ASSIST_PTS = 3;

// How much each gameweek in the horizon counts toward horizonScore — this
// week fully, then decaying (next-week fixtures/form matter far more than
// week 6's). Shared by projectPlayer and horizonWeightSum so the two never
// drift apart.
const HORIZON_DECAY_WEIGHTS = [1, 0.6, 0.42, 0.3, 0.22, 0.16, 0.12, 0.09];

/**
 * Sum of the decay weights actually used for a given horizon. Dividing
 * horizonScore by this turns it back into a weighted-average points-per-
 * gameweek figure, on the same scale as the single-week `score` — needed
 * to blend the two into one lineup/captain ranking.
 */
export function horizonWeightSum(horizon) {
  let sum = 0;
  for (let i = 0; i < horizon; i++) sum += HORIZON_DECAY_WEIGHTS[i] ?? 0;
  return sum || 1;
}

/**
 * Converts FPL's own official Fixture Difficulty Rating (1 = easiest, 5 =
 * hardest, from the perspective of the team with this fixture) into a
 * multiplier on that team's expected attacking output. FDR bakes in FPL's
 * own analyst judgment of opponent strength, home/away, and current form —
 * and critically, it stays populated even in gameweeks where the granular
 * strength_* fields haven't been computed yet (see buildLeagueAverages),
 * so it's blended in below as an independent signal rather than relying
 * solely on strength ratios that can currently be a flat fallback for
 * every fixture early in a season.
 */
export function fdrToAttackFactor(difficulty) {
  const table = { 1: 1.25, 2: 1.1, 3: 1.0, 4: 0.85, 5: 0.7 };
  return table[difficulty] ?? 1.0;
}

/** Same idea as fdrToAttackFactor, for clean-sheet/conceding difficulty. */
export function fdrToDefenseFactor(difficulty) {
  const table = { 1: 0.75, 2: 0.88, 3: 1.0, 4: 1.15, 5: 1.35 };
  return table[difficulty] ?? 1.0;
}

/** League-average attack/defence strength, used to normalize fixture difficulty. */
export function buildLeagueAverages(teams) {
  const FALLBACK_STRENGTH = 1100; // reasonable mid-table default if a team is missing a field
  // Early in a season (or whenever FPL hasn't computed difficulty yet) these
  // fields come back as 0 rather than omitted/null. Treat non-positive the
  // same as missing so we don't average in a bunch of zeros.
  const safe = (v) => (Number.isFinite(v) && v > 0 ? v : FALLBACK_STRENGTH);
  const n = teams.length || 1;
  const avg = (fn) => teams.reduce((s, t) => s + fn(t), 0) / n;
  const attack = avg((t) => (safe(t.strength_attack_home) + safe(t.strength_attack_away)) / 2);
  const defence = avg((t) => (safe(t.strength_defence_home) + safe(t.strength_defence_away)) / 2);
  return {
    attack: Number.isFinite(attack) ? attack : FALLBACK_STRENGTH,
    defence: Number.isFinite(defence) ? defence : FALLBACK_STRENGTH,
  };
}

/**
 * Maps teamId -> eventId -> [{ oppId, isHome, difficulty }], built from
 * upcoming (unfinished) fixtures only. A team missing from an eventId key
 * has a blank; a team with 2+ entries for one eventId has a double.
 */
export function buildFixturesByTeamEvent(fixtures) {
  const map = {};
  for (const f of fixtures) {
    if (f.finished || f.event == null) continue;
    for (const side of ['team_h', 'team_a']) {
      const teamId = f[side];
      const isHome = side === 'team_h';
      const oppId = isHome ? f.team_a : f.team_h;
      const difficulty = isHome ? f.team_h_difficulty : f.team_a_difficulty;
      map[teamId] = map[teamId] || {};
      map[teamId][f.event] = map[teamId][f.event] || [];
      map[teamId][f.event].push({ oppId, isHome, difficulty });
    }
  }
  return map;
}

/** Number of gameweeks played so far this season, for per-game averages. */
export function countFinishedEvents(events) {
  return events.filter((e) => e.finished).length;
}

/**
 * Per-team count of fixtures already played on the pitch (finished, or
 * provisionally finished pending bonus-point confirmation) — not just
 * fixtures FPL has fully confirmed. A single gameweek's ten fixtures are
 * often spread across three or four days, so at any given moment some
 * teams have already played their fixture for the current gameweek while
 * others haven't. Averaging a player's season-to-date minutes/bonus by a
 * single league-wide "games played" number silently doubles the rate for
 * anyone whose team already played, since their season-to-date total
 * already includes that game.
 */
export function buildGamesPlayedByTeam(fixtures) {
  const map = {};
  for (const f of fixtures) {
    if (f.event == null) continue;
    if (!f.finished && !f.finished_provisional) continue;
    map[f.team_h] = (map[f.team_h] || 0) + 1;
    map[f.team_a] = (map[f.team_a] || 0) + 1;
  }
  return map;
}

function computeAvailability(el) {
  if (el.status === 'a') {
    return el.chance_of_playing_next_round == null ? 1 : el.chance_of_playing_next_round / 100;
  }
  if (el.chance_of_playing_next_round != null) return el.chance_of_playing_next_round / 100;
  if (el.status === 'd') return 0.5;
  return 0;
}

function statusLabel(el) {
  if (el.status === 'a') return null;
  const map = { d: 'Doubtful', i: 'Injured', s: 'Suspended', u: 'Unavailable', n: 'Not in squad' };
  const base = map[el.status] || 'Flagged';
  return el.chance_of_playing_next_round != null
    ? `${base} (${el.chance_of_playing_next_round}% chance)`
    : base;
}

function num(v, fallback = 0) {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : fallback;
}

/** Projects one player's points for a single fixture. */
function projectFixture(el, fixture, teamsById, leagueAvg, avgMinsPerGame, lastSeasonTeamStrengthByCode = {}) {
  const pos = el.element_type;
  const oppTeam = teamsById[fixture.oppId];
  const ownTeam = teamsById[el.team];
  if (!oppTeam || !ownTeam) return { pts: 0, csProb: 0 };

  // Non-positive is FPL's "not computed yet" sentinel, same as missing — fall
  // through to last season's rating for the same team (by stable cross-season
  // `code`), then the league-average fallback, rather than dividing by 0.
  const s = (v) => (Number.isFinite(v) && v > 0 ? v : null);
  const oppLast = lastSeasonTeamStrengthByCode[oppTeam.code];
  const ownLast = lastSeasonTeamStrengthByCode[ownTeam.code];

  const oppDefence =
    s(fixture.isHome ? oppTeam.strength_defence_away : oppTeam.strength_defence_home) ??
    s(fixture.isHome ? oppLast?.defence_away : oppLast?.defence_home) ??
    leagueAvg.defence;
  const oppAttack =
    s(fixture.isHome ? oppTeam.strength_attack_away : oppTeam.strength_attack_home) ??
    s(fixture.isHome ? oppLast?.attack_away : oppLast?.attack_home) ??
    leagueAvg.attack;
  const ownDefence =
    s(fixture.isHome ? ownTeam.strength_defence_home : ownTeam.strength_defence_away) ??
    s(fixture.isHome ? ownLast?.defence_home : ownLast?.defence_away) ??
    leagueAvg.defence;

  const strengthAttackAdj = clamp(leagueAvg.defence / (oppDefence || leagueAvg.defence), 0.7, 1.4);
  const strengthCsDifficulty = clamp(
    (oppAttack / leagueAvg.attack) * (leagueAvg.defence / (ownDefence || leagueAvg.defence)),
    0.5,
    2.2
  );

  // Blend in FPL's own FDR alongside the strength-ratio estimate above —
  // see fdrToAttackFactor/fdrToDefenseFactor for why this matters early in
  // a season when strength_* is still flat for every team.
  const attackAdj = clamp((strengthAttackAdj + fdrToAttackFactor(fixture.difficulty)) / 2, 0.6, 1.5);
  const csDifficulty = clamp((strengthCsDifficulty + fdrToDefenseFactor(fixture.difficulty)) / 2, 0.5, 2.4);
  const csProb = clamp(0.3 / csDifficulty, 0.03, 0.65);
  const expConceded = clamp(1.35 * csDifficulty, 0.3, 3.2);

  const minsFactor = clamp(avgMinsPerGame / 90, 0, 1.05);
  const xG90 = num(el.expected_goals_per_90);
  const xA90 = num(el.expected_assists_per_90);

  const xGExp = xG90 * minsFactor * attackAdj;
  const xAExp = xA90 * minsFactor * attackAdj;
  const attackPts = xGExp * GOAL_PTS[pos] + xAExp * ASSIST_PTS;

  const csComponent = csProb * CS_PTS[pos];
  const concededPenalty = pos === 1 || pos === 2 ? -(expConceded / 2) : 0;

  const startFactor = clamp(avgMinsPerGame / 75, 0, 1);
  const appearancePts = startFactor >= 0.8 ? 2 : 1 + startFactor;

  const blendFactor = clamp(pos >= 3 ? attackAdj : csProb / 0.3, 0.5, 1.5);
  const bonusPerGame = num(el.bonusPerGame);
  const bonusComponent = bonusPerGame * blendFactor;

  const pts = Math.max(0, appearancePts + attackPts + csComponent + concededPenalty + bonusComponent);
  return { pts, csProb, attackPts, csComponent, bonusComponent, appearancePts };
}

function clamp(v, min, max) {
  return Math.min(max, Math.max(min, v));
}

// How much weight last season's per-90 rate carries relative to this
// season's own sample, expressed in minutes: at 0 minutes played this
// season the projection leans entirely on the prior; by a couple of this
// many minutes in, this season's own (increasingly reliable) sample
// dominates. Keeps 1-2 gameweeks of noise from wildly over/understating a
// player's real level before there's enough of a track record to trust.
const PRIOR_MINUTES_WEIGHT = 300;

/** Blends a current-season per-90 rate toward a prior, weighted down as current-season minutes accumulate. */
function shrink(currentRate, currentMinutes, priorRate) {
  if (priorRate == null) return currentRate;
  const w = PRIOR_MINUTES_WEIGHT / (PRIOR_MINUTES_WEIGHT + Math.max(0, currentMinutes));
  return currentRate * (1 - w) + priorRate * w;
}

/**
 * Full projection for one player: score for the immediate next event
 * (summed across both fixtures if it's a double, zero if it's a blank),
 * plus a decay-weighted score across the horizon for transfer/chip
 * decisions, plus a breakdown for the top-contributing factor.
 */
export function projectPlayer(
  el,
  fixturesByTeamEvent,
  fromEvent,
  gamesPlayedByTeam,
  teamsById,
  leagueAvg,
  horizon = 6,
  lastSeasonTeamStrengthByCode = {},
  lastSeasonPlayerRatesByCode = {}
) {
  const availability = computeAvailability(el);
  const minutesTotal = num(el.minutes);
  const bonusTotal = num(el.bonus);
  // Use this player's own team's games-played count, not a single league-wide
  // number — mid-gameweek, some teams have already played their fixture and
  // some haven't (see buildGamesPlayedByTeam).
  const gamesPlayed = gamesPlayedByTeam[el.team] || 0;
  const avgMinsPerGame = gamesPlayed > 0 ? minutesTotal / gamesPlayed : (availability || 0) * 75;

  // Shrink this season's own (possibly tiny-sample) xG/xA per-90 toward last
  // season's rate for the same player (by stable cross-season `code`), so
  // early-season projections aren't whipsawed by one big or blank game.
  const priorRates = lastSeasonPlayerRatesByCode[el.code];
  const shrunkXG90 = shrink(num(el.expected_goals_per_90), minutesTotal, priorRates?.xG90);
  const shrunkXA90 = shrink(num(el.expected_assists_per_90), minutesTotal, priorRates?.xA90);

  el = {
    ...el,
    bonusPerGame: gamesPlayed > 0 ? bonusTotal / gamesPlayed : 0,
    expected_goals_per_90: shrunkXG90,
    expected_assists_per_90: shrunkXA90,
  };

  const teamFixtures = fixturesByTeamEvent[el.team] || {};
  const weights = HORIZON_DECAY_WEIGHTS;

  let nextEventPts = 0;
  let horizonScore = 0;
  let bestSingleFixturePts = 0;
  let nextFixtures = [];
  const perEvent = [];

  for (let i = 0; i < horizon; i++) {
    const eventId = fromEvent + i;
    const fixturesThisEvent = teamFixtures[eventId] || [];
    let eventPts = 0;
    fixturesThisEvent.forEach((fx, idx) => {
      const proj = projectFixture(el, fx, teamsById, leagueAvg, avgMinsPerGame, lastSeasonTeamStrengthByCode);
      const discount = idx === 0 ? 1 : 0.85; // slight rotation-risk discount on 2nd+ fixture in a double
      eventPts += proj.pts * discount;
      bestSingleFixturePts = Math.max(bestSingleFixturePts, proj.pts);
    });
    perEvent.push({ eventId, pts: eventPts * availability, fixtureCount: fixturesThisEvent.length });
    if (i === 0) {
      nextEventPts = eventPts * availability;
      nextFixtures = fixturesThisEvent;
    }
    horizonScore += eventPts * availability * (weights[i] ?? 0);
  }

  return {
    score: safeNum(Math.round(nextEventPts * 100) / 100),
    horizonScore: safeNum(Math.round(horizonScore * 100) / 100),
    isDoubleNext: nextFixtures.length >= 2,
    isBlankNext: nextFixtures.length === 0,
    availability,
    hasFlag: el.status !== 'a',
    statusLabel: statusLabel(el),
    perEvent: perEvent.map((e) => ({ ...e, pts: safeNum(e.pts) })),
  };
}

/** Final safety net: never let a NaN/Infinity escape into the UI, whatever upstream data looks like. */
function safeNum(v) {
  return Number.isFinite(v) ? v : 0;
}
