import { useState } from 'react';

export default function TeamIdSetup({ onSubmit, error }) {
  const [value, setValue] = useState('');

  return (
    <div className="setup-wrap">
      <div className="setup-badge">XI</div>
      <h1 className="setup-title">Matchday</h1>
      <p className="setup-sub">
        Your weekly FPL lineup, captain, and transfer picks — built from your live squad,
        upcoming fixtures, and each player's projected points.
      </p>
      <form
        className="setup-form"
        onSubmit={(e) => {
          e.preventDefault();
          if (value.trim()) onSubmit(value.trim());
        }}
      >
        <input
          inputMode="numeric"
          placeholder="Enter your Team ID"
          value={value}
          onChange={(e) => setValue(e.target.value.replace(/[^0-9]/g, ''))}
        />
        <button className="btn-primary" type="submit" disabled={!value.trim()}>
          Load my team
        </button>
      </form>
      {error && <div className="error-box">{error}</div>}
      <p className="setup-hint">
        Find your Team ID in the FPL app or site under <b>Points</b> or <b>My Team</b> — it's the
        number in the URL, e.g. fantasy.premierleague.com/entry/<code>1234567</code>/event/1
      </p>
    </div>
  );
}
