import { computeFormationLayout } from '../lib/formation.js';

function PitchBackground() {
  return (
    <svg className="pitch-svg-bg" viewBox="0 0 400 540" preserveAspectRatio="none">
      <defs>
        <linearGradient id="turfGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#1c3524" />
          <stop offset="100%" stopColor="#152a1c" />
        </linearGradient>
      </defs>
      <rect width="400" height="540" fill="url(#turfGrad)" />
      {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => (
        <rect
          key={i}
          x="0"
          y={i * 67.5}
          width="400"
          height="67.5"
          fill={i % 2 === 0 ? 'rgba(255,255,255,0.02)' : 'transparent'}
        />
      ))}
      <g stroke="rgba(236,232,220,0.35)" strokeWidth="1.5" fill="none">
        <rect x="14" y="14" width="372" height="512" />
        <line x1="14" y1="270" x2="386" y2="270" />
        <circle cx="200" cy="270" r="48" />
        <circle cx="200" cy="270" r="2" fill="rgba(236,232,220,0.35)" />
        {/* top box (attacking end) */}
        <rect x="110" y="14" width="180" height="70" />
        <rect x="160" y="14" width="80" height="28" />
        <path d="M 160 84 A 40 40 0 0 0 240 84" />
        {/* bottom box (defensive end / GK) */}
        <rect x="110" y="456" width="180" height="70" />
        <rect x="160" y="498" width="80" height="28" />
        <path d="M 160 456 A 40 40 0 0 1 240 456" />
      </g>
    </svg>
  );
}

export default function PitchView({ starters, captain, viceCaptain }) {
  const positioned = computeFormationLayout(starters);

  return (
    <div className="pitch-wrap">
      <PitchBackground />
      <div className="pitch-overlay">
        {positioned.map((p) => {
          const isCap = captain && p.element === captain.element;
          const isVice = viceCaptain && p.element === viceCaptain.element;
          return (
            <div
              key={p.element}
              className="pitch-player"
              style={{ left: `${p.x}%`, top: `${p.y}%` }}
            >
              <div className={`pitch-player-badge${isCap ? ' captain' : ''}`}>
                {p.posLabel}
                {isCap && <span className="armband">C</span>}
                {isVice && !isCap && <span className="armband" style={{ background: '#93a49b', color: '#0d1512' }}>V</span>}
              </div>
              <div className="pitch-player-name">{p.webName}</div>
              <div className="pitch-player-meta">{p.score.toFixed(1)} pts · {p.teamShort} v {p.oppShort}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
