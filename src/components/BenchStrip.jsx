import SignalTags from './SignalTags.jsx';

export default function BenchStrip({ bench }) {
  return (
    <div className="bench-strip">
      {bench.map((p, i) => (
        <div className="bench-card" key={p.element}>
          <div className="num">{i === 0 ? 'GK' : `SUB ${i}`}</div>
          <div className="name">{p.webName}</div>
          <div className="score">{Number.isFinite(p.score) ? p.score.toFixed(1) : '—'} pts</div>
          <SignalTags player={p} />
        </div>
      ))}
    </div>
  );
}
