/** For each event in the horizon, which teams have a double fixture and which have none. */
export function scanFixtureAnomalies(fixturesByTeamEvent, fromEventId, horizon, teamsById) {
  const allTeamIds = Object.keys(teamsById).map(Number);
  const results = [];
  for (let i = 0; i < horizon; i++) {
    const eventId = fromEventId + i;
    const doubleTeams = [];
    const blankTeams = [];
    for (const teamId of allTeamIds) {
      const count = (fixturesByTeamEvent[teamId]?.[eventId] || []).length;
      if (count >= 2) doubleTeams.push(teamId);
      if (count === 0) blankTeams.push(teamId);
    }
    results.push({ eventId, doubleTeams, blankTeams });
  }
  return results;
}

/**
 * Turns fixture anomalies + squad projections into concrete chip
 * recommendations. Conservative by design: only fires when the signal is
 * strong (several squad players affected, or a clear standout ceiling),
 * and says so plainly when nothing meets the bar.
 */
export function buildChipAdvice(squad, anomalies, captaincyCeiling, horizon) {
  const advice = [];

  let bestBB = null;
  for (const a of anomalies) {
    const count = squad.filter((p) => a.doubleTeams.includes(p.teamId)).length;
    if (!bestBB || count > bestBB.count) bestBB = { eventId: a.eventId, count };
  }
  if (bestBB && bestBB.count >= 4) {
    advice.push({
      chip: 'Bench Boost',
      eventId: bestBB.eventId,
      reason: `${bestBB.count} of your 15 players have a double gameweek in GW${bestBB.eventId} — your bench would score too, not just your XI.`,
    });
  }

  let bestFH = null;
  for (const a of anomalies) {
    const count = squad.filter((p) => a.blankTeams.includes(p.teamId)).length;
    if (!bestFH || count > bestFH.count) bestFH = { eventId: a.eventId, count };
  }
  if (bestFH && bestFH.count >= 5) {
    advice.push({
      chip: 'Free Hit',
      eventId: bestFH.eventId,
      reason: `${bestFH.count} of your players have no fixture in GW${bestFH.eventId} — a one-week Free Hit squad from teams that do play would avoid a wipeout gameweek.`,
    });
  }

  if (captaincyCeiling && captaincyCeiling.pts >= 9) {
    advice.push({
      chip: 'Triple Captain',
      eventId: captaincyCeiling.eventId,
      reason: `${captaincyCeiling.player.webName} projects for ${captaincyCeiling.pts.toFixed(1)} pts in GW${captaincyCeiling.eventId}${
        captaincyCeiling.isDouble ? ' (double gameweek)' : ''
      } — the strongest single-week ceiling in your squad over the next ${horizon} gameweeks.`,
    });
  }

  const squadAvgHorizon = squad.reduce((s, p) => s + p.horizonScore, 0) / squad.length;
  const weakestFour = [...squad].sort((a, b) => a.horizonScore - b.horizonScore).slice(0, 4);
  const weakAvg = weakestFour.reduce((s, p) => s + p.horizonScore, 0) / 4;
  if (weakAvg < squadAvgHorizon * 0.55) {
    advice.push({
      chip: 'Wildcard',
      eventId: null,
      reason: `${weakestFour.map((p) => p.webName).join(', ')} are projected well below your squad average over the next ${horizon} gameweeks — a wildcard could rebuild that corner of the squad rather than one-for-one transfers.`,
    });
  }

  if (advice.length === 0) {
    advice.push({
      chip: null,
      eventId: null,
      reason: `No standout chip trigger in the next ${horizon} gameweeks based on currently scheduled fixtures. Doubles and blanks are usually only confirmed a few weeks out, so check back as the schedule firms up.`,
    });
  }

  return advice;
}
