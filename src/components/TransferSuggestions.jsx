function fmtCost(tenths) {
  return `£${(tenths / 10).toFixed(1)}m`;
}

function reasonFor(sug) {
  const bits = [];
  if (sug.out.hasFlag) {
    bits.push(`<b>${sug.out.webName}</b> is flagged — ${sug.out.statusLabel?.toLowerCase()}`);
  } else if (sug.out.avgDifficulty >= 3.5) {
    bits.push(`<b>${sug.out.webName}</b> has a tough run of fixtures ahead`);
  } else {
    bits.push(`<b>${sug.out.webName}</b> is projected for the lowest points of your squad`);
  }
  bits.push(`<b>${sug.in.webName}</b> is projected for ${sug.in.score.toFixed(1)} pts next gameweek${sug.in.oppShort !== '—' ? ` vs ${sug.in.oppShort}` : ''}.`);
  return bits.join('. ') + '.';
}

export default function TransferSuggestions({ suggestions, freeTransfers }) {
  if (!suggestions.length) {
    return (
      <div className="no-transfers">
        Your squad looks solid for next gameweek — no transfer clearly beats what you're already
        rostered. Bank your free transfer.
      </div>
    );
  }

  return (
    <div>
      {suggestions.map((sug, i) => {
        const overFree = i >= freeTransfers;
        return (
          <div className="transfer-card" key={sug.out.element}>
            <div className="transfer-row">
              <div className="transfer-side out">
                <div className="label">Out</div>
                <div className="pname">{sug.out.webName}</div>
                <div className="psub">{sug.out.teamShort} · {fmtCost(sug.out.sellPrice)}</div>
              </div>
              <div className="transfer-arrow">→</div>
              <div className="transfer-side in">
                <div className="label">In</div>
                <div className="pname">{sug.in.webName}</div>
                <div className="psub">{sug.in.teamShort} · {fmtCost(sug.in.nowCost)}</div>
              </div>
            </div>
            <div className="transfer-reason" dangerouslySetInnerHTML={{ __html: reasonFor(sug) }} />
            <div className="transfer-gain">
              +{sug.gain.toFixed(1)} projected pts next GW
              {overFree ? ' · costs a -4 hit (beyond your free transfers)' : ' · free transfer'}
            </div>
          </div>
        );
      })}
    </div>
  );
}
