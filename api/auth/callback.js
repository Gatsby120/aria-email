// SEA — Systematic Email Automation
// File: api/auth/callback.js
// Receives Google auth code and exchanges for access token

module.exports = async (req, res) => {
  try {
    const { code, error, state } = req.query;

    // Handle user denied access
    if (error) {
      console.log('[SEA AUTH] User denied access:', error);
      return res.redirect('/?auth=denied');
    }

    // Validate auth code exists
    if (!code) {
      return res.redirect('/?auth=failed&reason=no_code');
    }

    const clientId     = process.env.GOOGLE_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
    const redirectUri  = process.env.REDIRECT_URI ||
      `https://${req.headers.host}/api/auth/callback`;

    if (!clientId || !clientSecret) {
      console.error('[SEA AUTH] Missing environment variables');
      return res.redirect('/?auth=failed&reason=config_error');
    }

    // Exchange auth code for tokens
    const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id:     clientId,
        client_secret: clientSecret,
        redirect_uri:  redirectUri,
        grant_type:    'authorization_code',
      }),
    });

    const tokens = await tokenResponse.json();

    if (tokens.error) {
      console.error('[SEA AUTH] Token exchange failed:', tokens.error);
      return res.redirect('/?auth=failed&reason=token_error');
    }

    // Fetch user profile using access token
    const profileResponse = await fetch(
      'https://www.googleapis.com/oauth2/v2/userinfo',
      { headers: { Authorization: `Bearer ${tokens.access_token}` } }
    );
    const profile = await profileResponse.json();

    // Build secure session data
    const sessionData = {
      email:         profile.email,
      name:          profile.name,
      picture:       profile.picture,
      accessToken:   tokens.access_token,
      refreshToken:  tokens.refresh_token,
      expiresAt:     Date.now() + (tokens.expires_in * 1000),
      connectedAt:   new Date().toISOString(),
      platform:      'GMAIL',
    };

    // Encode session and pass to frontend via URL param
    // In production replace with encrypted cookie or database session
    const encoded = Buffer.from(
      JSON.stringify(sessionData)
    ).toString('base64');

    console.log('[SEA AUTH] Successfully authenticated:', profile.email);

    // Redirect back to SEA app with session token
    res.redirect(`/?auth=success&session=${encoded}&email=${encodeURIComponent(profile.email)}`);

  } catch (error) {
    console.error('[SEA AUTH] Callback error:', error.message);
    res.redirect('/?auth=failed&reason=server_error');
  }
};
