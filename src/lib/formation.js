function rowX(count) {
  const margin = 15;
  if (count === 1) return [50];
  const step = (100 - margin * 2) / (count - 1);
  return Array.from({ length: count }, (_, i) => margin + step * i);
}

/** Lays out starters on a 0-100 x/y grid, attack at the top (y small), GK at the bottom. */
export function computeFormationLayout(starters) {
  const gk = starters.find((p) => p.elementType === 1);
  const defs = starters.filter((p) => p.elementType === 2);
  const mids = starters.filter((p) => p.elementType === 3);
  const fwds = starters.filter((p) => p.elementType === 4);

  const rows = [
    { players: fwds, y: 15 },
    { players: mids, y: 43 },
    { players: defs, y: 70 },
    { players: gk ? [gk] : [], y: 90 },
  ];

  const positioned = [];
  for (const row of rows) {
    const xs = rowX(row.players.length);
    row.players.forEach((p, i) => positioned.push({ ...p, x: xs[i], y: row.y }));
  }
  return positioned;
}
