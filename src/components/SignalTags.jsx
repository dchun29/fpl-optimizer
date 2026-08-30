// Renders the "next layer" context tags (set-piece duty, single-game
// outlier flag) next to a player. Purely informational — see
// lib/formSignals.js for what feeds this. Recent-form isn't shown here
// since it's a number best placed next to the existing score rather than
// as a tag; components that want it read player.recentForm directly.
export default function SignalTags({ player }) {
  const tags = [...(player.setPieceRoles || [])];
  if (tags.length === 0 && !player.outlierFlag) return null;

  return (
    <div className="sig-tags">
      {tags.map((role) => (
        <span className="sig-tag" key={role}>
          {role}
        </span>
      ))}
      {player.outlierFlag && (
        <span
          className="sig-tag outlier"
          title={`${player.outlierFlag.sharePct}% of this season's underlying output came from GW${player.outlierFlag.round} alone`}
        >
          1-game spike
        </span>
      )}
    </div>
  );
}

