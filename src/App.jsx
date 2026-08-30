import { useEffect, useState, useCallback } from 'react';
import Header from './components/Header.jsx';
import TeamIdSetup from './components/TeamIdSetup.jsx';
import PitchView from './components/PitchView.jsx';
import BenchStrip from './components/BenchStrip.jsx';
import TransferSuggestions from './components/TransferSuggestions.jsx';
import { getBootstrap, getFixtures, getEntry, getEntryPicks, getMyTeam } from './lib/api.js';
import {
  buildTeamFixtureMap,
  buildScoredSquad,
  selectBestXI,
  pickCaptains,
  suggestTransfers,
} from './lib/optimizer.js';

const STORAGE_KEY = 'fpl_team_id';

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

      const picksResp = await getEntryPicks(id, currentEvent.id);

      const elementsById = Object.fromEntries(bootstrap.elements.map((e) => [e.id, e]));
      const teamsById = Object.fromEntries(bootstrap.teams.map((t) => [t.id, t]));
      const teamFixtureMap = buildTeamFixtureMap(fixtures, nextEvent.id, 3);

      // Try to get exact sell prices / bank / free-transfer count from the
      // authenticated my-team endpoint. Falls back cleanly if credentials
      // aren't configured or login fails — the app still works either way.
      const myTeam = await getMyTeam(id);
      const isLive = myTeam.ok;

      const sellPriceById = isLive
        ? Object.fromEntries(myTeam.data.picks.map((p) => [p.element, p.selling_price]))
        : {};
      const bank = isLive ? myTeam.data.transfers.bank : picksResp.entry_history?.bank ?? 0;
      const liveFreeTransfers = isLive ? myTeam.data.transfers.limit : null;

      const squad = buildScoredSquad(picksResp.picks, elementsById, teamsById, teamFixtureMap, sellPriceById);
      const { starters, bench, formation } = selectBestXI(squad);
      const { captain, viceCaptain } = pickCaptains(starters);
      const transferSuggestions = suggestTransfers(
        squad,
        bootstrap.elements,
        teamsById,
        teamFixtureMap,
        bank,
        3
      );

      if (typeof liveFreeTransfers === 'number') {
        setFreeTransfers(liveFreeTransfers);
      }

      setData({
        teamName: entry.name,
        gwLabel: `Gameweek ${nextEvent.id}`,
        deadlineIso: nextEvent.deadline_time,
        starters,
        bench,
        formation,
        captain,
        viceCaptain,
        transferSuggestions,
        bank,
        isLive,
        liveError: !isLive && myTeam.code !== 'NO_CREDENTIALS' ? myTeam.error : null,
      });
      setStatus('ready');
    } catch (err) {
      setError(err.message || 'Something went wrong loading your team.');
      setStatus('error');
    }
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

  if (!teamId) {
    return <TeamIdSetup onSubmit={handleSubmitTeamId} error={status === 'error' ? error : ''} />;
  }

  if (status === 'loading' || !data) {
    return (
      <div className="state-wrap">
        <div className="spinner" />
        Pulling your squad and fixture data…
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
        <span className="section-note">Bank £{(data.bank / 10).toFixed(1)}m</span>
        <span className="section-note" style={{ color: data.isLive ? 'var(--turf-bright)' : 'var(--chalk-dim)' }}>
          {data.isLive ? '● Live prices from your account' : '○ Estimated prices'}
        </span>
      </div>

      <div className="section">
        <div className="section-head">
          <h2 className="section-title">Transfer Suggestions</h2>
        </div>
        <TransferSuggestions suggestions={data.transferSuggestions} freeTransfers={freeTransfers} />
      </div>

      <div className="footer-note">
        Projections blend each player's FPL expected points with their next fixture's difficulty
        and injury/suspension status.{' '}
        {data.isLive
          ? "Sell prices and bank are pulled live from your FPL account, so transfer budgets are exact."
          : 'Sell prices are approximated from current market value — your actual sell price may be slightly lower if a player has risen in price since you bought them. Set FPL_EMAIL / FPL_PASSWORD in Vercel to pull exact prices instead.'}{' '}
        This is a planning aid, not a guarantee — always sanity-check flagged players before the
        deadline.
      </div>
    </>
  );
}
