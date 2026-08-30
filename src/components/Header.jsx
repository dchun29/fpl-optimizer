function formatCountdown(deadlineIso) {
  const diffMs = new Date(deadlineIso).getTime() - Date.now();
  if (diffMs <= 0) return 'Deadline passed';
  const days = Math.floor(diffMs / 86400000);
  const hours = Math.floor((diffMs % 86400000) / 3600000);
  if (days > 0) return `${days}d ${hours}h to deadline`;
  const mins = Math.floor((diffMs % 3600000) / 60000);
  return `${hours}h ${mins}m to deadline`;
}

export default function Header({ teamName, gwLabel, deadlineIso, onReset }) {
  return (
    <div className="header">
      <div className="header-top">
        <div>
          <div className="header-eyebrow">{gwLabel}</div>
          <h1 className="header-title">Matchday</h1>
          {teamName && <div className="header-team">{teamName}</div>}
        </div>
        {deadlineIso && <div className="deadline-chip">{formatCountdown(deadlineIso)}</div>}
      </div>
      <button className="link-btn" style={{ marginTop: 10 }} onClick={onReset}>
        Change team ID
      </button>
    </div>
  );
}
