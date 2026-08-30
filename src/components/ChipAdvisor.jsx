const CHIP_ICON = {
  'Bench Boost': '🪑',
  'Free Hit': '🎯',
  'Triple Captain': '👑',
  Wildcard: '🔄',
};

export default function ChipAdvisor({ advice }) {
  return (
    <div>
      {advice.map((a, i) => (
        <div className="chip-card" key={i}>
          {a.chip ? (
            <div className="chip-head">
              <span className="chip-icon">{CHIP_ICON[a.chip] || '★'}</span>
              <span className="chip-name">{a.chip}</span>
              {a.eventId && <span className="chip-gw">GW{a.eventId}</span>}
            </div>
          ) : (
            <div className="chip-head">
              <span className="chip-name" style={{ color: 'var(--chalk-dim)' }}>
                No chip signal
              </span>
            </div>
          )}
          <div className="chip-reason">{a.reason}</div>
        </div>
      ))}
    </div>
  );
}
