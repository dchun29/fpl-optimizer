import { useEffect, useState, useCallback } from 'react';
import Header from './components/Header.jsx';
import TeamIdSetup from './components/TeamIdSetup.jsx';
import PitchView from './components/PitchView.jsx';
import BenchStrip from './components/BenchStrip.jsx';
import TransferSuggestions from './components/TransferSuggestions.jsx';
import ChipAdvisor from './components/ChipAdvisor.jsx';
import SquadOverrides from './components/SquadOverrides.jsx';
import { getBootstrap, getFixtures, getEntry, getEntryPicks, getMyTeam } from './lib/api.js';
import {
  buildProjectionContext,
  buildScoredSquad,
  selectBestXI,
  pickCaptains,
  findCaptaincyCeiling,
  suggestTransfers,
} from './lib/optimizer.js';
import { scanFixtureAnomalies, buildChipAdvice } from './lib/chipAdvisor.js';
import {
  deriveSeasons,
  fetchLastSeasonTeamStrength,
  fetchLastSeasonPlayerRates,
  fetchCurrentSeasonGameLogs,
} from './lib/externalData.js';

const STORAGE_KEY = 'fpl_team_id';
const HORIZON = 6;

// --- Manual squad-override + bank storage (see SquadOverrides.jsx) ---
// FPL's public API only exposes a squad once its gameweek has locked, so any
// transfer made since then is invisible to it. Rather than depend on FPL's
// (now broken — see api/my-team.js) authenticated login to see live squad
// state, you log transfers here yourself; they're kept in this browser's
// localStorage, applied on top of the last-known locked squad, and dropped
// automatically once the real picks endpoint catches up (see the
// `forEvent` filtering below).
const overridesKey = (id) => `fpl_overrides_${id}`;
const bankOverrideKey = (id) => `fpl_bank_override_${id}`;

function loadOverrides(id) {
  try {
    const raw = JSON.parse(localStorage.getItem(overridesKey(id)) || '[]');
    return Array.isArray(raw) ? raw : [];
  } catch {
    return [];
  }
}

function saveOverrides(id, list) {
  localStorage.setItem(overridesKey(id), JSON.stringify(list));
}

function loadBankOverride(id) {
  const raw = localStorage.getItem(bankOverrideKey(id));
  if (raw == null) return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

function saveBankOverride(id, tenthsOrNull) {
  if (tenthsOrNull == null) {
    localStorage.removeItem(bankOverrideKey(id));
  } else {
    localStorage.setItem(bankOverrideKey(id), String(tenthsOrNull));
  }
}

export default function App() {
  const [teamId, setTeamId] = useState(() => localStorage.getItem(STORAGE_KEY) || '');
  const [status, setStatus] = useState('idle'); // idle | loading | ready | error
  const [error, setError] = useState('');
  const [data, setData] = useState(null);
  const [freeTransfers, setFreeTransfers] = useState(1);

  const load = useCallback(async (id) => {
    setStatus('loading');
    setError('');
    try {
      const [bootstrap, fixtures, entry] = await Promise.all([
        getBootstrap(),
        getFixtures(),
        getEntry(id),
      ]);

      const events = bootstrap.events;
      const currentEvent = events.find((e) => e.is_current) || [...events].reverse().find((e) => e.finished);
      const nextEvent = events.find((e) => e.is_next) || currentEvent;

      if (!currentEvent) {
        throw new Error('No completed gameweek found yet this season — check back once GW1 kicks off.');
      }

      // Last season's team ratings and player xG/xA rates (from a public
      // community mirror of FPL's own historical data) supplement this
      // season's own numbers early on, when FPL hasn't populated granular
      // team strength yet and every player's own sample is still tiny — see
      // lib/externalData.js. Best-effort: resolves to {} on any failure, so
      // a slow/unreachable GitHub never blocks loading the team.
      // Current-season per-gameweek game logs (lib/externalData.js) add a
      // "next layer" of context on top of the projection itself: set-piece
      // duty, recent-form trend, and a flag for a season average that's
      // secretly one big outlier game — see lib/formSignals.js. Same
      // best-effort contract as the other two fetches.
      const seasons = deriveSeasons(bootstrap);
      const [picksResp, lastSeasonTeamStrengthByCode, lastSeasonPlayerRatesByCode, gameLogsByElement] =
        await Promise.all([
          getEntryPicks(id, currentEvent.id),
          fetchLastSeasonTeamStrength(seasons.previous),
          fetchLastSeasonPlayerRates(seasons.previous),
          fetchCurrentSeasonGameLogs(seasons.current),
        ]);
      const elementsById = Object.fromEntries(bootstrap.elements.map((e) => [e.id, e]));

      const ctx = buildProjectionContext(
        bootstrap,
        fixtures,
        nextEvent.id,
        HORIZON,
        lastSeasonTeamStrengthByCode,
        lastSeasonPlayerRatesByCode,
        gameLogsByElement
      );

      // Try to get exact sell prices / bank / free-transfer count from the
      // authenticated my-team endpoint. Falls back cleanly if credentials
      // aren't configured or login fails — the app still works either way.
      const myTeam = await getMyTeam(id);
      const isLive = myTeam.ok;

      const sellPriceById = isLive
        ? Object.fromEntries(myTeam.data.picks.map((p) => [p.element, p.selling_price]))
        : {};

      // Manual transfers logged for a gameweek that hasn't locked in yet
      // (i.e. still ahead of currentEvent) are applied on top of the
      // last-known picks here. One that's now behind currentEvent should
      // already be reflected in picksResp for real, so it's dropped — this
      // also self-prunes the stored list without you having to clear it by
      // hand each week.
      const allOverrides = loadOverrides(id);
      const activeOverrides = allOverrides.filter((o) => o.forEvent > currentEvent.id);
      if (activeOverrides.length !== allOverrides.length) saveOverrides(id, activeOverrides);

      const effectivePicks = picksResp.picks.map((p) => ({ ...p }));
      for (const o of activeOverrides) {
        const idx = effectivePicks.findIndex((p) => p.element === o.outId);
        if (idx !== -1) {
          effectivePicks[idx] = { ...effectivePicks[idx], element: o.inId, is_captain: false, is_vice_captain: false };
        }
      }

      const manualBank = loadBankOverride(id);
      const estimatedBank = isLive ? myTeam.data.transfers.bank : picksResp.entry_history?.bank ?? 0;
      const bank = manualBank != null ? manualBank : estimatedBank;

      const liveFreeTransfers = isLive ? myTeam.data.transfers.limit : null;
      const effectiveFreeTransfers = typeof liveFreeTransfers === 'number' ? liveFreeTransfers : freeTransfers;

      const squad = buildScoredSquad(effectivePicks, elementsById, ctx, sellPriceById);
      const { starters, bench, formation } = selectBestXI(squad);
      const { captain, viceCaptain } = pickCaptains(starters);
      const captaincyCeiling = findCaptaincyCeiling(squad);
      const transferSuggestions = suggestTransfers(squad, bootstrap.elements, ctx, bank, effectiveFreeTransfers);

      const anomalies = scanFixtureAnomalies(ctx.fixturesByTeamEvent, nextEvent.id, HORIZON, ctx.teamsById);
      const chipAdvice = buildChipAdvice(squad, anomalies, captaincyCeiling, HORIZON);

      if (typeof liveFreeTransfers === 'number') {
        setFreeTransfers(liveFreeTransfers);
      }

      setData({
        teamName: entry.name,
        gwLabel: `Gameweek ${nextEvent.id}`,
        nextEventId: nextEvent.id,
        deadlineIso: nextEvent.deadline_time,
        starters,
        bench,
        fullSquad: squad,
        formation,
        captain,
        viceCaptain,
        transferSuggestions,
        chipAdvice,
        bank,
        bankIsManual: manualBank != null,
        isLive,
        overrides: activeOverrides,
        allElements: bootstrap.elements,
        teamsById: ctx.teamsById,
      });
      setStatus('ready');
    } catch (err) {
      setError(err.message || 'Something went wrong loading your team.');
      setStatus('error');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (teamId) load(teamId);
  }, [teamId, load]);

  const handleSubmitTeamId = (id) => {
    localStorage.setItem(STORAGE_KEY, id);
    setTeamId(id);
  };

  const handleReset = () => {
    localStorage.removeItem(STORAGE_KEY);
    setTeamId('');
    setData(null);
    setStatus('idle');
  };

  const handleAddOverride = (outId, inId) => {
    if (!data) return;
    const outName = data.fullSquad.find((p) => p.element === outId)?.webName ?? `#${outId}`;
    const inName = data.allElements.find((e) => e.id === inId)?.web_name ?? `#${inId}`;
    const record = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      forEvent: data.nextEventId,
      outId,
      outName,
      inId,
      inName,
    };
    saveOverrides(teamId, [...data.overrides, record]);
    load(teamId);
  };

  const handleRemoveOverride = (id) => {
    if (!data) return;
    saveOverrides(teamId, data.overrides.filter((o) => o.id !== id));
    load(teamId);
  };

  const handleBankChange = (tenthsOrNull) => {
    saveBankOverride(teamId, tenthsOrNull);
    load(teamId);
  };

  if (!teamId) {
    return <TeamIdSetup onSubmit={handleSubmitTeamId} error={status === 'error' ? error : ''} />;
  }

  if (status === 'loading' || !data) {
    return (
      <div className="state-wrap">
        <div className="spinner" />
        Pulling your squad, fixtures, and underlying stats…
      </div>
    );
  }

  if (status === 'error') {
    return (
      <>
        <Header teamName="" gwLabel="Matchday" onReset={handleReset} />
        <div className="error-box">{error}</div>
      </>
    );
  }

  return (
    <>
      <Header
        teamName={data.teamName}
        gwLabel={data.gwLabel}
        deadlineIso={data.deadlineIso}
        onReset={handleReset}
      />

      <SquadOverrides
        squad={data.fullSquad}
        allElements={data.allElements}
        teamsById={data.teamsById}
        overrides={data.overrides}
        bankTenths={data.bank}
        bankIsManual={data.bankIsManual}
        nextEventLabel={data.gwLabel}
        onAdd={handleAddOverride}
        onRemove={handleRemoveOverride}
        onBankChange={handleBankChange}
      />

      <div className="section">
        <div className="section-head">
          <h2 className="section-title">Starting XI</h2>
          <span className="section-note">{data.formation}</span>
        </div>
      </div>
      <PitchView starters={data.starters} captain={data.captain} viceCaptain={data.viceCaptain} />
      <div className="formation-label">
        Captain <b style={{ color: 'var(--amber)' }}>{data.captain.webName}</b> · Vice{' '}
        {data.viceCaptain.webName}
      </div>

      <div className="section">
        <div className="section-head">
          <h2 className="section-title">Bench</h2>
        </div>
      </div>
      <BenchStrip bench={data.bench} />

      <div className="controls-row">
        <div className="ft-input">
          Free transfers
          <select value={freeTransfers} onChange={(e) => setFreeTransfers(Number(e.target.value))}>
            {[0, 1, 2, 3, 4, 5].map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </div>
        <span className="section-note">
          Bank £{(data.bank / 10).toFixed(1)}m{data.bankIsManual ? ' (manual)' : ''}
        </span>
        <span className="section-note" style={{ color: data.isLive ? 'var(--turf-bright)' : 'var(--chalk-dim)' }}>
          {data.isLive ? '● Live prices from your account' : '○ Estimated prices'}
        </span>
      </div>

      <div className="section">
        <div className="section-head">
          <h2 className="section-title">Transfer Suggestions</h2>
          <span className="section-note">next {HORIZON} GWs</span>
        </div>
        <TransferSuggestions suggestions={data.transferSuggestions} />
      </div>

      <div className="section">
        <div className="section-head">
          <h2 className="section-title">Chip Strategy</h2>
        </div>
        <ChipAdvisor advice={data.chipAdvice} />
      </div>

      <div className="footer-note">
        Projections are built from scratch off underlying stats — xG/xA per 90, defensive-
        contribution points, bonus-point history, and clean-sheet probability derived from each
        team's attack/defence ratings — rather than FPL's own point estimate, then projected
        across the next {HORIZON}{' '}
        gameweeks to weigh fixture swings, doubles, and blanks. Early in a season, when this
        year's own team ratings and player samples are still thin, projections also draw on
        FPL's official fixture difficulty ratings and last season's team and player data as a
        prior — both fade out automatically as this season's own numbers fill in. Set-piece
        duty, recent-form trend, and single-game-outlier flags are shown alongside players as
        extra context — they don't change any score or ranking, just what you see next to it.{' '}
        Player prices always reflect today's market (that part of FPL's API needs no login);
        what your account login would normally add — exact sell prices, bank, and same-week
        transfer visibility — isn't available right now (see the "Squad adjustments" box above
        to log transfers by hand instead).{' '}
        This is a planning aid built on public data, not a guarantee — always sanity-check
        flagged players and confirmed lineups before the deadline.
      </div>
    </>
  );
}
