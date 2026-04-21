// SEA — Systematic Email Automation
// File: api/gmail/accounts.js
// Manages account login, logout, and multi-account sessions

module.exports = async (req, res) => {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    const { action } = req.query;

    // ── GET — List all connected accounts ──────────────────────
    if (req.method === 'GET' && action === 'list') {
      const authHeader = req.headers.authorization;
      if (!authHeader) {
        return res.status(200).json({ accounts: [], total: 0 });
      }

      try {
        const encoded  = authHeader.replace('Bearer ', '');
        const sessions = JSON.parse(Buffer.from(encoded, 'base64').toString());
        const accounts = Array.isArray(sessions) ? sessions : [sessions];

        const accountList = accounts.map((s, index) => ({
          id:           index + 1,
          email:        s.email,
          name:         s.name,
          picture:      s.picture,
          platform:     s.platform || 'GMAIL',
          connectedAt:  s.connectedAt,
          active:       s.active !== false,
          expiresAt:    s.expiresAt,
          isExpired:    Date.now() > s.expiresAt,
        }));

        return res.status(200).json({
          accounts: accountList,
          total:    accountList.length,
          active:   accountList.filter(a => a.active).length,
          maxAllowed: 10,
        });
      } catch {
        return res.status(200).json({ accounts: [], total: 0 });
      }
    }

    // ── POST — Add new account or toggle active/inactive ───────
    if (req.method === 'POST') {
      const body = req.body || {};

      // Toggle account active status (login/logout)
      if (action === 'toggle') {
        const { email, active } = body;
        if (!email) {
          return res.status(400).json({ error: 'Email required' });
        }
        console.log(`[SEA ACCOUNTS] Account ${active ? 'activated' : 'paused'}: ${email}`);
        return res.status(200).json({
          success:  true,
          email,
          active:   active !== false,
          message:  active ? `${email} is now active` : `${email} paused — data preserved`,
        });
      }

      // Add new account (initiate OAuth)
      if (action === 'add') {
        const currentCount = parseInt(req.query.current) || 0;
        if (currentCount >= 10) {
          return res.status(400).json({
            error:   'Maximum 10 accounts reached',
            message: 'Please remove an account before adding a new one',
          });
        }
        console.log('[SEA ACCOUNTS] New account OAuth initiated');
        return res.status(200).json({
          success:     true,
          authUrl:     `/api/auth/google`,
          message:     'Redirect to Google login',
          slotsRemaining: 10 - currentCount - 1,
        });
      }

      return res.status(400).json({ error: 'Unknown action' });
    }

    // ── DELETE — Remove account completely ─────────────────────
    if (req.method === 'DELETE') {
      const { email } = req.query;
      if (!email) {
        return res.status(400).json({ error: 'Email required to remove account' });
      }

      // Revoke Google OAuth token
      const authHeader = req.headers.authorization;
      if (authHeader) {
        try {
          const encoded = authHeader.replace('Bearer ', '');
          const session = JSON.parse(Buffer.from(encoded, 'base64').toString());

          if (session.accessToken) {
            // Revoke access so Google removes the connection
            await fetch(
              `https://oauth2.googleapis.com/revoke?token=${session.accessToken}`,
              { method: 'POST' }
            );
            console.log('[SEA ACCOUNTS] Token revoked for:', email);
          }
        } catch (e) {
          // Token revocation failure is non-critical
          console.log('[SEA ACCOUNTS] Token revocation skipped:', e.message);
        }
      }

      console.log('[SEA ACCOUNTS] Account removed:', email);
      return res.status(200).json({
        success:  true,
        email,
        message:  `${email} removed from SEA. All local data cleared.`,
        removedAt: new Date().toISOString(),
      });
    }

    // ── GET — Account health check ─────────────────────────────
    if (req.method === 'GET' && action === 'health') {
      const authHeader = req.headers.authorization;
      if (!authHeader) {
        return res.status(401).json({ error: 'No session' });
      }

      try {
        const encoded = authHeader.replace('Bearer ', '');
        const session = JSON.parse(Buffer.from(encoded, 'base64').toString());

        // Verify token is still valid with Google
        const checkRes = await fetch(
          `https://www.googleapis.com/oauth2/v1/tokeninfo?access_token=${session.accessToken}`
        );
        const tokenInfo = await checkRes.json();

        if (tokenInfo.error) {
          return res.status(200).json({
            email:   session.email,
            healthy: false,
            reason:  'Token expired — needs refresh',
          });
        }

        return res.status(200).json({
          email:     session.email,
          healthy:   true,
          expiresIn: tokenInfo.expires_in,
          scopes:    tokenInfo.scope,
        });
      } catch (e) {
        return res.status(200).json({ healthy: false, reason: e.message });
      }
    }

    // ── Fallback ────────────────────────────────────────────────
    return res.status(400).json({
      error:   'Invalid request',
      message: 'Supported: GET?action=list, POST?action=add, POST?action=toggle, DELETE?email=x, GET?action=health',
    });

  } catch (error) {
    console.error('[SEA ACCOUNTS] Error:', error.message);
    res.status(500).json({ error: 'Account operation failed. Please try again.' });
  }
};
