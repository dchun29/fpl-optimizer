// Fetches the authenticated /my-team endpoint, which is the only place the
// FPL API exposes a squad's *real* selling price (purchase price + FPL's
// 50%-of-profit-rounded-down rule) and exact bank balance.
//
// Requires FPL_EMAIL and FPL_PASSWORD to be set as Vercel environment
// variables (Project Settings -> Environment Variables). They're read here,
// server-side, only to log in on your behalf — never sent to the browser,
// never logged, never cached.

export default async function handler(req, res) {
  const { teamId } = req.query;

  if (!teamId || Array.isArray(teamId) || !/^\d+$/.test(teamId)) {
    return res.status(400).json({ error: 'Missing or invalid teamId' });
  }

  const email = process.env.FPL_EMAIL;
  const password = process.env.FPL_PASSWORD;

  if (!email || !password) {
    return res.status(501).json({
      error: 'FPL_EMAIL / FPL_PASSWORD not configured',
      code: 'NO_CREDENTIALS',
    });
  }

  try {
    const loginRes = await fetch('https://users.premierleague.com/accounts/login/', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': 'Mozilla/5.0 (compatible; fpl-optimizer/1.0)',
      },
      body: new URLSearchParams({
        login: email,
        password,
        app: 'plfpl-web',
        redirect_uri: 'https://fantasy.premierleague.com/a/login',
      }),
      redirect: 'manual',
    });

    const setCookies =
      typeof loginRes.headers.getSetCookie === 'function'
        ? loginRes.headers.getSetCookie()
        : (loginRes.headers.get('set-cookie') || '').split(/,(?=[^;]+?=[^;]+?(;|$))/);

    const cookieHeader = setCookies.map((c) => c.split(';')[0]).join('; ');

    if (!cookieHeader.includes('pl_profile')) {
      return res.status(401).json({
        error: 'FPL login failed — double check FPL_EMAIL / FPL_PASSWORD in Vercel.',
        code: 'LOGIN_FAILED',
      });
    }

    const myTeamRes = await fetch(`https://fantasy.premierleague.com/api/my-team/${teamId}/`, {
      headers: {
        Cookie: cookieHeader,
        'User-Agent': 'Mozilla/5.0 (compatible; fpl-optimizer/1.0)',
      },
    });

    if (!myTeamRes.ok) {
      return res.status(myTeamRes.status).json({
        error: `my-team request failed (${myTeamRes.status}) — is this Team ID linked to that FPL login?`,
      });
    }

    const data = await myTeamRes.json();
    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).json(data);
  } catch (err) {
    return res.status(502).json({ error: `Login/fetch failed: ${err.message}` });
  }
}
