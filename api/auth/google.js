// SEA — Systematic Email Automation
// File: api/auth/google.js
// Handles Google OAuth login redirect

const SCOPES = [
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/gmail.modify',
  'https://www.googleapis.com/auth/gmail.labels',
  'https://www.googleapis.com/auth/userinfo.email',
  'https://www.googleapis.com/auth/userinfo.profile',
].join(' ');

module.exports = async (req, res) => {
  try {
    const clientId     = process.env.GOOGLE_CLIENT_ID;
    const redirectUri  = process.env.REDIRECT_URI ||
      `https://${req.headers.host}/api/auth/callback`;

    if (!clientId) {
      return res.status(500).json({
        error: 'GOOGLE_CLIENT_ID not configured in environment variables'
      });
    }

    // Build Google OAuth URL
    const params = new URLSearchParams({
      client_id:     clientId,
      redirect_uri:  redirectUri,
      response_type: 'code',
      scope:         SCOPES,
      access_type:   'offline',
      prompt:        'consent',
      state:         Buffer.from(JSON.stringify({
        timestamp: Date.now(),
        source:    'sea-app'
      })).toString('base64'),
    });

    const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?${params}`;

    // Log for SEA security audit
    console.log('[SEA AUTH] Google OAuth redirect initiated');

    // Redirect user to Google login
    res.setHeader('Location', authUrl);
    res.status(302).end();

  } catch (error) {
    console.error('[SEA AUTH] Error:', error.message);
    res.status(500).json({ error: 'Authentication failed. Please try again.' });
  }
};
