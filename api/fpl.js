// Serverless proxy for the public Fantasy Premier League API.
// The FPL API doesn't send CORS headers, so the browser can't call it directly.
// This function fetches server-side and passes the JSON back with caching.

const SAFE_PATH = /^[a-zA-Z0-9/_-]+$/;

export default async function handler(req, res) {
  const { path } = req.query;

  if (!path || Array.isArray(path)) {
    return res.status(400).json({ error: 'Missing "path" query param' });
  }
  if (!SAFE_PATH.test(path)) {
    return res.status(400).json({ error: 'Invalid path' });
  }

  const url = `https://fantasy.premierleague.com/api/${path}/`;

  try {
    const upstream = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; fpl-optimizer/1.0)',
        Accept: 'application/json',
      },
    });

    if (!upstream.ok) {
      return res
        .status(upstream.status)
        .json({ error: `FPL API responded ${upstream.status} for ${path}` });
    }

    const data = await upstream.json();
    res.setHeader('Cache-Control', 's-maxage=120, stale-while-revalidate=600');
    return res.status(200).json(data);
  } catch (err) {
    return res.status(502).json({ error: `Upstream fetch failed: ${err.message}` });
  }
}
