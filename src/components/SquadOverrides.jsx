import { useState } from 'react';

function fmtCost(tenths) {
  return `£${(tenths / 10).toFixed(1)}m`;
}

/**
 * A manual log of transfers you've made in the real FPL app since the last
 * completed gameweek. FPL's public API only exposes a squad once its
 * gameweek has locked (see the "estimated prices" note in App.jsx), so
 * anything you've done since then is invisible to it. Logging a swap here
 * applies it on top of that last-known squad for scoring/lineup purposes —
 * using this season's live market prices (already public, no login needed)
 * for the incoming player — until the real locked picks catch up, at which
 * point it's dropped automatically (see the `forEvent` filtering in
 * App.jsx's load()).
 *
 * Stored in this browser's localStorage, keyed by team ID — nothing is sent
 * anywhere. If you use the app from a different browser or device, you'll
 * need to re-log transfers there too.
 */
export default function SquadOverrides({
  squad,
  allElements,
  teamsById,
  overrides,
  bankTenths,
  bankIsManual,
  nextEventLabel,
  onAdd,
  onRemove,
  onBankChange,
}) {
  const [outId, setOutId] = useState('');
  const [query, setQuery] = useState('');
  const [inId, setInId] = useState(null);
  const [open, setOpen] = useState(false);

  const outPlayer = squad.find((p) => p.element === Number(outId));

  const suggestions =
    outPlayer && query.trim().length > 0
      ? allElements
          .filter(
            (el) =>
              el.element_type === outPlayer.elementType &&
              !squad.some((p) => p.element === el.id) &&
              el.web_name.toLowerCase().includes(query.trim().toLowerCase())
          )
          .slice(0, 8)
      : [];

  const canAdd = outPlayer && inId;

  function handleAdd() {
    if (!canAdd) return;
    onAdd(Number(outId), inId);
    setOutId('');
    setQuery('');
    setInId(null);
    setOpen(false);
  }

  const bankDisplay = (bankTenths / 10).toFixed(1);

  return (
    <div className="overrides-box">
      <div className="overrides-head">
        <span>Squad adjustments</span>
        <button className="link-btn" onClick={() => setOpen((v) => !v)}>
          {open ? 'Close' : '+ Log a transfer'}
        </button>
      </div>

      {overrides.length > 0 && (
        <div className="overrides-list">
          {overrides.map((o) => (
            <div className="override-chip" key={o.id}>
              <span>
                {o.outName} → {o.inName}
              </span>
              <button className="chip-remove" onClick={() => onRemove(o.id)} aria-label="Remove">
                ×
              </button>
            </div>
          ))}
        </div>
      )}

      {overrides.length === 0 && !open && (
        <div className="overrides-empty">
          Made a transfer in the real app since your last locked gameweek? Log it here so the
          squad below matches what you actually have for {nextEventLabel}.
        </div>
      )}

      {open && (
        <div className="override-form">
          <select
            value={outId}
            onChange={(e) => {
              setOutId(e.target.value);
              setQuery('');
              setInId(null);
            }}
          >
            <option value="">Out: pick a player…</option>
            {squad.map((p) => (
              <option key={p.element} value={p.element}>
                {p.webName} ({p.posLabel})
              </option>
            ))}
          </select>

          <div className="override-search">
            <input
              type="text"
              placeholder={outPlayer ? 'In: search a replacement…' : 'Pick "Out" first'}
              disabled={!outPlayer}
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setInId(null);
              }}
            />
            {suggestions.length > 0 && !inId && (
              <div className="override-suggestions">
                {suggestions.map((el) => (
                  <button
                    key={el.id}
                    className="override-suggestion"
                    onClick={() => {
                      setInId(el.id);
                      setQuery(`${el.web_name} (${teamsById[el.team]?.short_name ?? ''})`);
                    }}
                  >
                    {el.web_name}{' '}
                    <span className="psub">
                      {teamsById[el.team]?.short_name ?? ''} · {fmtCost(el.now_cost)}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>

          <button className="override-add-btn" disabled={!canAdd} onClick={handleAdd}>
            Add
          </button>
        </div>
      )}

      <div className="override-bank-row">
        <span className="section-note">Bank</span>
        <input
          type="number"
          step="0.1"
          className="override-bank-input"
          value={bankDisplay}
          onChange={(e) => {
            const val = parseFloat(e.target.value);
            if (Number.isFinite(val)) onBankChange(Math.round(val * 10));
          }}
        />
        {bankIsManual && (
          <button className="link-btn" onClick={() => onBankChange(null)}>
            Reset to estimate
          </button>
        )}
      </div>
    </div>
  );
}
