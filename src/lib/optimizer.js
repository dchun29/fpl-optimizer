import {
  projectPlayer,
  buildLeagueAverages,
  buildFixturesByTeamEvent,
  buildGamesPlayedByTeam,
  horizonWeightSum,
} from './projections.js';
import { deriveSetPieceRoles, computeRecentForm, computeOutlierFlag } from './formSignals.js';

export const POS_LABEL = { 1: 'GKP', 2: 'DEF', 3: 'MID', 4: 'FWD' };

// Lineup/captain decisions blend this week's projection with the 6-week
// outlook, so a one-off spike (or dip) doesn't flip your XI and armband
// every week — this is how much weight the multi-week outlook gets.
// 0 = pick purely on next week's score; 1 = pick purely on the 6-week
// average, ignoring next week's fixture entirely. Transfer suggestions are
// unaffected by this — they already run on the full horizon.
const LINEUP_STABILITY_WEIGHT = 0.3;

const VALID_FORMATIONS = (() => {
  const out = [];
  for (let d = 3; d <= 5; d++) {
    for (let m = 2; m <= 5; m++) {
      const f = 10 - d - m;
      if (f >= 1 && f <= 3) out.push([d, m, f]);
    }
  }
  return out;
})();

function sum(arr) {
  return arr.reduce((s, p) => s + p.stableScore, 0);
}

/**
 * Bundles the per-team/per-gameweek context the projection engine needs,
 * computed once per load. `lastSeasonTeamStrengthByCode` and
 * `lastSeasonPlayerRatesByCode` are optional supplementary signals (see
 * lib/externalData.js) used as a prior/fallback early in a season when this
 * season's own strength ratings and per-90 rates are still thin — omit them
 * (they default to {}) and everything works exactly as before.
 */
export function buildProjectionContext(
  bootstrap,
  fixtures,
  fromEventId,
  horizon = 6,
  lastSeasonTeamStrengthByCode = {},
  lastSeasonPlayerRatesByCode = {},
  gameLogsByElement = {}
) {
  return {
    fixturesByTeamEvent: buildFixturesByTeamEvent(fixtures),
    gamesPlayedByTeam: buildGamesPlayedByTeam(fixtures),
    teamsById: Object.fromEntries(bootstrap.teams.map((t) => [t.id, t])),
    leagueAvg: buildLeagueAverages(bootstrap.teams),
    fromEventId,
    horizon,
    lastSeasonTeamStrengthByCode,
    lastSeasonPlayerRatesByCode,
    gameLogsByElement,
  };
}

/**
 * The three "next layer" display signals (set-piece duty, recent-form
 * window, single-game outlier flag) for one player — see lib/formSignals.js
 * for what each means and why. These are purely informational: nothing
 * here feeds into score, horizonScore, or stableScore, so they never change
 * a ranking, only what's shown alongside it.
 */
function attachFormSignals(el, ctx) {
  return {
    setPieceRoles: deriveSetPieceRoles(el),
    recentForm: computeRecentForm(ctx.gameLogsByElement[el.id]),
    outlierFlag: computeOutlierFlag(ctx.gameLogsByElement[el.id]),
  };
}

function scoreElement(el, ctx) {
  return projectPlayer(
    el,
    ctx.fixturesByTeamEvent,
    ctx.fromEventId,
    ctx.gamesPlayedByTeam,
    ctx.teamsById,
    ctx.leagueAvg,
    ctx.horizon,
    ctx.lastSeasonTeamStrengthByCode,
    ctx.lastSeasonPlayerRatesByCode
  );
}

/**
 * Builds squad player objects (joined + projected) from a picks response.
 * `sellPriceById`, when provided (from the authenticated my-team endpoint),
 * gives each player's exact sell price; otherwise it's approximated as
 * their current market price.
 */
export function buildScoredSquad(picks, elementsById, ctx, sellPriceById = {}) {
  const weightSum = horizonWeightSum(ctx.horizon);
  return picks.map((pick) => {
    const el = elementsById[pick.element];
    const projection = scoreElement(el, ctx);
    const nextFixtures = projection.perEvent[0]?.fixtureCount ?? 0;
    const nextOppId = ctx.fixturesByTeamEvent[el.team]?.[ctx.fromEventId]?.[0]?.oppId;
    const opp = nextOppId ? ctx.teamsById[nextOppId] : null;
    const hasLiveSellPrice = Object.prototype.hasOwnProperty.call(sellPriceById, el.id);
    // horizonScore is a decay-weighted *sum* across 6 gameweeks, so it's not
    // directly comparable to next-week's `score`. Divide back down to a
    // weighted-average points-per-gameweek figure first, then blend.
    const horizonAvg = projection.horizonScore / weightSum;
    const stableScore = projection.score * (1 - LINEUP_STABILITY_WEIGHT) + horizonAvg * LINEUP_STABILITY_WEIGHT;
    return {
      element: el.id,
      webName: el.web_name,
      elementType: el.element_type,
      posLabel: POS_LABEL[el.element_type],
      teamId: el.team,
      teamShort: ctx.teamsById[el.team]?.short_name ?? '',
      nowCost: el.now_cost,
      sellPrice: hasLiveSellPrice ? sellPriceById[el.id] : el.now_cost,
      sellPriceIsLive: hasLiveSellPrice,
      oppShort: opp ? opp.short_name : nextFixtures === 0 ? 'BLANK' : '—',
      wasOriginalCaptain: !!pick.is_captain,
      ...projection,
      ...attachFormSignals(el, ctx),
      stableScore: Math.round(stableScore * 100) / 100,
    };
  });
}

/**
 * Picks the highest-scoring valid formation (3-5 DEF, 2-5 MID, 1-3 FWD) from
 * a 15-man squad. Ranked by `stableScore` (next week blended with the
 * 6-week outlook, see LINEUP_STABILITY_WEIGHT) rather than pure next-week
 * score, so the XI doesn't swing wildly on a single volatile gameweek.
 */
export function selectBestXI(squad) {
  const byPos = { 1: [], 2: [], 3: [], 4: [] };
  for (const p of squad) byPos[p.elementType].push(p);
  for (const k in byPos) byPos[k].sort((a, b) => b.stableScore - a.stableScore);

  const gk = byPos[1][0];
  const benchGk = byPos[1][1];

  let best = null;
  for (const [d, m, f] of VALID_FORMATIONS) {
    if (byPos[2].length < d || byPos[3].length < m || byPos[4].length < f) continue;
    const defs = byPos[2].slice(0, d);
    const mids = byPos[3].slice(0, m);
    const fwds = byPos[4].slice(0, f);
    const total = gk.stableScore + sum(defs) + sum(mids) + sum(fwds);
    if (!best || total > best.total) {
      best = { total, formation: `${d}-${m}-${f}`, defs, mids, fwds };
    }
  }

  const starters = [gk, ...best.defs, ...best.mids, ...best.fwds];
  const starterIds = new Set(starters.map((p) => p.element));
  const benchOutfield = squad
    .filter((p) => !starterIds.has(p.element) && p.elementType !== 1)
    .sort((a, b) => b.stableScore - a.stableScore);

  return { starters, bench: [benchGk, ...benchOutfield], formation: best.formation };
}

/** Captain/vice pick, also ranked by stableScore for the same reason as the XI. */
export function pickCaptains(starters) {
  const sorted = [...starters].sort((a, b) => b.stableScore - a.stableScore);
  return { captain: sorted[0], viceCaptain: sorted[1] };
}

/** Finds the best triple-captain candidate across the horizon: highest single-event ceiling, doubles weighted up. */
export function findCaptaincyCeiling(squad) {
  let best = null;
  for (const p of squad) {
    for (const ev of p.perEvent) {
      if (ev.pts <= 0) continue;
      const ceiling = ev.fixtureCount >= 2 ? ev.pts * 1.05 : ev.pts;
      if (!best || ceiling > best.ceiling) {
        best = { player: p, eventId: ev.eventId, pts: ev.pts, isDouble: ev.fixtureCount >= 2, ceiling };
      }
    }
  }
  return best;
}

function toCandidate(el, ctx, teamsById) {
  const projection = scoreElement(el, ctx);
  return {
    id: el.id,
    webName: el.web_name,
    teamShort: teamsById[el.team]?.short_name ?? '',
    nowCost: el.now_cost,
    ...projection,
    ...attachFormSignals(el, ctx),
  };
}

/**
 * Exhaustively checks every affordable same-position replacement for every
 * squad player (single transfers), then checks paired transfers among the
 * squad's weakest players against the best independent replacements for
 * each — so both one- and two-transfer plans are genuinely searched, not
 * just "swap the worst player."
 */
export function suggestTransfers(squad, allElements, ctx, bankTenths, freeTransfers = 1) {
  const squadIds = new Set(squad.map((p) => p.element));
  const byPosition = { 1: [], 2: [], 3: [], 4: [] };
  for (const el of allElements) {
    if (squadIds.has(el.id)) continue;
    byPosition[el.element_type].push(el);
  }

  // Best single-transfer option for every squad player (using multi-week horizon score).
  const singleOptions = squad.map((out) => {
    const budget = out.sellPrice + bankTenths;
    const pool = byPosition[out.elementType].filter((p) => p.now_cost <= budget);
    let best = null;
    for (const p of pool) {
      const cand = toCandidate(p, ctx, ctx.teamsById);
      if (!best || cand.horizonScore > best.horizonScore) best = cand;
    }
    return { out, best, gain: best ? best.horizonScore - out.horizonScore : -Infinity };
  });

  singleOptions.sort((a, b) => b.gain - a.gain);
  const bestSingle = singleOptions[0];

  // Paired transfers: among the 8 weakest/most-flagged squad players, try every
  // pair, each leg using its own best independent replacement, checked jointly
  // against combined budget.
  const weakPool = [...squad]
    .sort((a, b) => {
      if (a.hasFlag !== b.hasFlag) return a.hasFlag ? -1 : 1;
      return a.horizonScore - b.horizonScore;
    })
    .slice(0, 8);

  let bestPair = null;
  for (let i = 0; i < weakPool.length; i++) {
    for (let j = i + 1; j < weakPool.length; j++) {
      const outA = weakPool[i];
      const outB = weakPool[j];
      const singleA = singleOptions.find((s) => s.out.element === outA.element);
      const singleB = singleOptions.find((s) => s.out.element === outB.element);
      if (!singleA?.best || !singleB?.best) continue;
      if (singleA.best.id === singleB.best.id) continue; // can't buy the same player twice

      const totalBudget = outA.sellPrice + outB.sellPrice + bankTenths;
      const totalCost = singleA.best.nowCost + singleB.best.nowCost;
      if (totalCost > totalBudget) continue;

      const gain = singleA.gain + singleB.gain;
      if (!bestPair || gain > bestPair.gain) {
        bestPair = { legs: [singleA, singleB], gain };
      }
    }
  }

  // Triple transfers: same idea as pairs, extended to every 3-of-8 combination
  // from the weak pool (56 combos — cheap to check exhaustively). Worth
  // surfacing separately from the pair search because the extra -4 hit means
  // a triple only clears the bar when it's genuinely a bigger overhaul, not
  // just "the pair plus one more."
  let bestTriple = null;
  for (let i = 0; i < weakPool.length; i++) {
    for (let j = i + 1; j < weakPool.length; j++) {
      for (let k = j + 1; k < weakPool.length; k++) {
        const legs = [weakPool[i], weakPool[j], weakPool[k]].map((out) =>
          singleOptions.find((s) => s.out.element === out.element)
        );
        if (legs.some((l) => !l?.best)) continue;
        const inIds = new Set(legs.map((l) => l.best.id));
        if (inIds.size < 3) continue; // can't buy the same player twice

        const totalBudget = legs.reduce((s, l) => s + l.out.sellPrice, 0) + bankTenths;
        const totalCost = legs.reduce((s, l) => s + l.best.nowCost, 0);
        if (totalCost > totalBudget) continue;

        const gain = legs.reduce((s, l) => s + l.gain, 0);
        if (!bestTriple || gain > bestTriple.gain) {
          bestTriple = { legs, gain };
        }
      }
    }
  }

  const suggestions = [];
  const GAIN_THRESHOLD = 1.5; // in horizon-weighted points, ~ next-gameweek-equivalent

  if (bestSingle?.best && bestSingle.gain > GAIN_THRESHOLD) {
    suggestions.push(buildSuggestionCard([bestSingle], freeTransfers));
  }
  if (bestPair && bestPair.gain > GAIN_THRESHOLD * 1.6) {
    suggestions.push(buildSuggestionCard(bestPair.legs, freeTransfers));
  }
  if (bestTriple && bestTriple.gain > GAIN_THRESHOLD * 2.2) {
    suggestions.push(buildSuggestionCard(bestTriple.legs, freeTransfers));
  }

  return suggestions.sort((a, b) => b.gain - a.gain);
}

function buildSuggestionCard(legs, freeTransfers) {
  const gain = legs.reduce((s, l) => s + l.gain, 0);
  const transferCount = legs.length;
  const hitCost = Math.max(0, transferCount - freeTransfers) * 4;
  return {
    legs: legs.map((l) => ({ out: l.out, in: l.best, gain: Math.round(l.gain * 100) / 100 })),
    transferCount,
    gain: Math.round(gain * 100) / 100,
    hitCost,
    netGain: Math.round((gain - hitCost) * 100) / 100,
  };
}
