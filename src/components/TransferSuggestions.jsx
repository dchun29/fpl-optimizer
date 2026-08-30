import SignalTags from './SignalTags.jsx';

function fmtCost(tenths) {
  return `£${(tenths / 10).toFixed(1)}m`;
}

function reasonForLeg(leg) {
  if (leg.out.hasFlag) {
    return `${leg.out.webName} is flagged — ${leg.out.statusLabel?.toLowerCase()}`;
  }
  if (leg.out.isBlankNext) {
    return `${leg.out.webName} has no fixture next gameweek`;
  }
  return `${leg.out.webName} projects lowest among this squad's weak links over the next few gameweeks`;
}

/**
 * A separate, visually distinct caution line for an incoming player whose
 * season total is mostly one game (see lib/formSignals.js) — the exact
 * pattern behind a pick looking better in the projection than it turns out
 * to be. This doesn't change whether the transfer is suggested, just flags
 * it for a second look before you act on it.
 */
function cautionForLeg(leg) {
  if (!leg.in.outlierFlag) return null;
  return `${leg.in.webName}'s underlying output is ${leg.in.outlierFlag.sharePct}% from a single game (GW${leg.in.outlierFlag.round}) — worth a second look before committing.`;
}

export default function TransferSuggestions({ suggestions }) {
  if (!suggestions.length) {
    return (
      <div className="no-transfers">
        Your squad's projected points hold up well against the market over the next few
        gameweeks — no transfer clearly beats what you're already rostered. Bank your free
        transfer.
      </div>
    );
  }

  return (
    <div>
      {suggestions.map((sug, i) => (
        <div className="transfer-card" key={i}>
          <div className="transfer-plan-label">
            {{ 1: 'Single transfer', 2: 'Double transfer', 3: 'Triple transfer' }[sug.transferCount] ||
              `${sug.transferCount}-player transfer`}
            {sug.hitCost > 0 && <span className="hit-badge">−{sug.hitCost} hit</span>}
          </div>

          {sug.legs.map((leg, li) => (
            <div className="transfer-row" key={li} style={{ marginTop: li > 0 ? 12 : 0 }}>
              <div className="transfer-side out">
                <div className="label">Out</div>
                <div className="pname">{leg.out.webName}</div>
                <div className="psub">
                  {leg.out.teamShort} · {fmtCost(leg.out.sellPrice)}
                </div>
                <SignalTags player={leg.out} />
              </div>
              <div className="transfer-arrow">→</div>
              <div className="transfer-side in">
                <div className="label">In</div>
                <div className="pname">{leg.in.webName}</div>
                <div className="psub">
                  {leg.in.teamShort} · {fmtCost(leg.in.nowCost)}
                </div>
                <SignalTags player={leg.in} />
              </div>
            </div>
          ))}

          <div className="transfer-reason">
            {sug.legs.map((l) => reasonForLeg(l)).join('. ')}. Replacements project higher over
            the next several gameweeks, not just next week.
          </div>

          {sug.legs.filter((l) => l.in.outlierFlag).length > 0 && (
            <div className="transfer-caution">
              {sug.legs.map((l) => cautionForLeg(l)).filter(Boolean).join(' ')}
            </div>
          )}

          <div className="transfer-gain">
            +{sug.gain.toFixed(1)} pts over horizon
            {sug.hitCost > 0 ? ` · net +${sug.netGain.toFixed(1)} pts after the hit` : ' · within your free transfers'}
          </div>
        </div>
      ))}
    </div>
  );
}
