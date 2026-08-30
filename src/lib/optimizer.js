export const POS_LABEL = { 1: 'GKP', 2: 'DEF', 3: 'MID', 4: 'FWD' };

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
  return arr.reduce((s, p) => s + p.score, 0);
}

/** How likely a player is to actually play their next match, 0-1. */
function computeAvailability(el) {
  if (el.status === 'a') {
    return el.chance_of_playing_next_round == null ? 1 : el.chance_of_playing_next_round / 100;
  }
  if (el.chance_of_playing_next_round != null) return el.chance_of_playing_next_round / 100;
  if (el.status === 'd') return 0.5;
  return 0; // injured, suspended, unavailable, on loan elsewhere, etc.
}

/** FPL publishes its own next-gameweek points estimate (ep_next); fall back to form/PPG if it's missing. */
function baseExpectedPoints(el) {
  const ep = parseFloat(el.ep_next);
  if (!Number.isNaN(ep) && ep > 0) return ep;
  const form = parseFloat(el.form) || 0;
  const ppg = parseFloat(el.points_per_game) || 0;
  return form * 0.6 + ppg * 0.4;
}

/**
 * Combined next-gameweek score: FPL's expected points, nudged for fixture
 * difficulty, scaled down by the chance a flagged player doesn't actually play.
 */
export function scorePlayer(el, fixtureInfo) {
  const availability = computeAvailability(el);
  const base = baseExpectedPoints(el);
  const difficulty = fixtureInfo?.nextDifficulty ?? 3;
  const fixtureAdj = (3 - difficulty) * 0.18;
  const rawScore = Math.max(0, base + fixtureAdj) * availability;
  return {
    score: Math.round(rawScore * 100) / 100,
    base: Math.round(base * 100) / 100,
    availability,
    difficulty,
    avgDifficulty: fixtureInfo?.avgDifficulty ?? 3,
    hasFlag: el.status !== 'a',
    statusLabel: statusLabel(el),
  };
}

function statusLabel(el) {
  if (el.status === 'a') return null;
  const map = { d: 'Doubtful', i: 'Injured', s: 'Suspended', u: 'Unavailable', n: 'Not in squad' };
  const base = map[el.status] || 'Flagged';
  if (el.chance_of_playing_next_round != null) {
    return `${base} (${el.chance_of_playing_next_round}% chance)`;
  }
  return base;
}

/** Maps team id -> next-fixture and 3-gameweek-lookahead difficulty info. */
export function buildTeamFixtureMap(fixtures, fromEventId, lookahead = 3) {
  const map = {};
  const upcoming = fixtures
    .filter((f) => f.event != null && f.event >= fromEventId && f.event < fromEventId + lookahead)
    .sort((a, b) => a.event - b.event);

  for (const f of upcoming) {
    for (const side of ['team_h', 'team_a']) {
      const teamId = f[side];
      const isHome = side === 'team_h';
      const difficulty = isHome ? f.team_h_difficulty : f.team_a_difficulty;
      const oppId = isHome ? f.team_a : f.team_h;
      if (!map[teamId]) map[teamId] = { fixtures: [] };
      map[teamId].fixtures.push({ event: f.event, difficulty, oppId, isHome });
    }
  }

  for (const teamId in map) {
    const list = map[teamId].fixtures.sort((a, b) => a.event - b.event);
    map[teamId].nextDifficulty = list[0]?.difficulty ?? 3;
    map[teamId].nextOppId = list[0]?.oppId ?? null;
    map[teamId].nextIsHome = list[0]?.isHome ?? null;
    map[teamId].avgDifficulty = list.length
      ? list.reduce((s, x) => s + x.difficulty, 0) / list.length
      : 3;
  }
  return map;
}

/**
 * Builds squad player objects (joined + scored) from a picks response.
 * `sellPriceById`, when provided (from the authenticated my-team endpoint),
 * gives each player's exact sell price; otherwise it's approximated as
 * their current market price.
 */
export function buildScoredSquad(picks, elementsById, teamsById, teamFixtureMap, sellPriceById = {}) {
  return picks.map((pick) => {
    const el = elementsById[pick.element];
    const fixtureInfo = teamFixtureMap[el.team];
    const scoring = scorePlayer(el, fixtureInfo);
    const opp = fixtureInfo?.nextOppId ? teamsById[fixtureInfo.nextOppId] : null;
    const hasLiveSellPrice = Object.prototype.hasOwnProperty.call(sellPriceById, el.id);
    return {
      element: el.id,
      webName: el.web_name,
      elementType: el.element_type,
      posLabel: POS_LABEL[el.element_type],
      teamId: el.team,
      teamShort: teamsById[el.team]?.short_name ?? '',
      nowCost: el.now_cost,
      sellPrice: hasLiveSellPrice ? sellPriceById[el.id] : el.now_cost,
      sellPriceIsLive: hasLiveSellPrice,
      oppShort: opp ? opp.short_name : '—',
      oppIsHome: fixtureInfo?.nextIsHome ?? null,
      wasOriginalCaptain: !!pick.is_captain,
      ...scoring,
    };
  });
}

/** Picks the highest-scoring valid formation (3-5 DEF, 2-5 MID, 1-3 FWD) from a 15-man squad. */
export function selectBestXI(squad) {
  const byPos = { 1: [], 2: [], 3: [], 4: [] };
  for (const p of squad) byPos[p.elementType].push(p);
  for (const k in byPos) byPos[k].sort((a, b) => b.score - a.score);

  const gk = byPos[1][0];
  const benchGk = byPos[1][1];

  let best = null;
  for (const [d, m, f] of VALID_FORMATIONS) {
    if (byPos[2].length < d || byPos[3].length < m || byPos[4].length < f) continue;
    const defs = byPos[2].slice(0, d);
    const mids = byPos[3].slice(0, m);
    const fwds = byPos[4].slice(0, f);
    const total = gk.score + sum(defs) + sum(mids) + sum(fwds);
    if (!best || total > best.total) {
      best = { total, formation: `${d}-${m}-${f}`, defs, mids, fwds };
    }
  }

  const starters = [gk, ...best.defs, ...best.mids, ...best.fwds];
  const starterIds = new Set(starters.map((p) => p.element));
  const benchOutfield = squad
    .filter((p) => !starterIds.has(p.element) && p.elementType !== 1)
    .sort((a, b) => b.score - a.score);

  return { starters, bench: [benchGk, ...benchOutfield], formation: best.formation };
}

export function pickCaptains(starters) {
  const sorted = [...starters].sort((a, b) => b.score - a.score);
  return { captain: sorted[0], viceCaptain: sorted[1] };
}

/**
 * Suggests up to `maxSuggestions` transfers: weakest/flagged squad players
 * swapped for the best-scoring affordable replacement in the same position.
 */
export function suggestTransfers(squad, allElements, teamsById, teamFixtureMap, bankTenths, maxSuggestions = 3) {
  const squadIds = new Set(squad.map((p) => p.element));
  const suggestions = [];

  const weakLinks = [...squad].sort((a, b) => {
    if (a.hasFlag !== b.hasFlag) return a.hasFlag ? -1 : 1;
    return a.score - b.score;
  });

  for (const out of weakLinks) {
    if (suggestions.length >= maxSuggestions) break;
    const budget = out.sellPrice + bankTenths;
    const pool = allElements.filter(
      (p) => p.element_type === out.elementType && !squadIds.has(p.id) && p.now_cost <= budget
    );

    let bestCandidate = null;
    for (const p of pool) {
      const fixtureInfo = teamFixtureMap[p.team];
      const scoring = scorePlayer(p, fixtureInfo);
      if (!bestCandidate || scoring.score > bestCandidate.score) {
        bestCandidate = { player: p, ...scoring };
      }
    }

    if (bestCandidate && bestCandidate.score > out.score + 0.75) {
      const opp = teamFixtureMap[bestCandidate.player.team]?.nextOppId;
      suggestions.push({
        out,
        in: {
          id: bestCandidate.player.id,
          webName: bestCandidate.player.web_name,
          teamShort: teamsById[bestCandidate.player.team]?.short_name ?? '',
          nowCost: bestCandidate.player.now_cost,
          oppShort: opp ? teamsById[opp]?.short_name ?? '—' : '—',
          score: bestCandidate.score,
          statusLabel: bestCandidate.statusLabel,
        },
        gain: Math.round((bestCandidate.score - out.score) * 100) / 100,
        costDelta: bestCandidate.player.now_cost - out.sellPrice,
      });
      squadIds.add(bestCandidate.player.id);
    }
  }

  return suggestions;
}
