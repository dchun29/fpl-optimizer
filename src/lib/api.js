async function fplGet(path) {
  const res = await fetch(`/api/fpl?path=${encodeURIComponent(path)}`);
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data?.error || `Request failed for ${path}`);
  }
  return data;
}

export const getBootstrap = () => fplGet('bootstrap-static');
export const getFixtures = () => fplGet('fixtures');
export const getEntry = (teamId) => fplGet(`entry/${teamId}`);
export const getEntryPicks = (teamId, eventId) =>
  fplGet(`entry/${teamId}/event/${eventId}/picks`);

/**
 * Real sell prices + exact bank, via the authenticated my-team endpoint.
 * Returns null (rather than throwing) if FPL_EMAIL/FPL_PASSWORD aren't
 * configured or login fails, so callers can fall back to public data.
 */
export async function getMyTeam(teamId) {
  const res = await fetch(`/api/my-team?teamId=${encodeURIComponent(teamId)}`);
  const data = await res.json();
  if (!res.ok) {
    return { ok: false, code: data?.code || 'ERROR', error: data?.error };
  }
  return { ok: true, data };
}
