// SEA — Systematic Email Automation
// File: api/gmail/inbox.js
// Fetches real emails from Gmail API and categorises them

const CATEGORY_RULES = {
  primary:     ['urgent','action required','sign','deadline','important','meeting','confirm'],
  work:        ['project','proposal','client','invoice','contract','report','review','feedback'],
  finance:     ['payment','receipt','invoice','bank','transaction','salary','transfer','bill'],
  orders:      ['order','shipped','delivered','tracking','dispatch','purchase','bought'],
  travel:      ['flight','booking','hotel','itinerary','reservation','trip','check-in'],
  newsletters: ['newsletter','weekly','digest','update','bulletin','roundup'],
  marketing:   ['sale','offer','deal','discount','% off','limited time','exclusive','promo'],
  social:      ['linkedin','facebook','twitter','instagram','notification','comment','like'],
  alerts:      ['otp','verify','security','login','sign-in','password','alert','code'],
  spam:        ['winner','congratulations','claim','free money','inheritance','million'],
};

function categorise(subject, from) {
  const text = (subject + ' ' + from).toLowerCase();
  for (const [cat, keywords] of Object.entries(CATEGORY_RULES)) {
    if (keywords.some(k => text.includes(k))) return cat;
  }
  return 'personal';
}

function getUrgency(subject, category) {
  const s = subject.toLowerCase();
  if (['primary','alerts'].includes(category)) return 'urgent';
  if (s.includes('urgent') || s.includes('asap') || s.includes('today') ||
      s.includes('deadline') || s.includes('sign') || s.includes('action')) return 'urgent';
  if (s.includes('follow up') || s.includes('reminder') || s.includes('this week') ||
      s.includes('please review') || s.includes('response needed')) return 'pending';
  if (['marketing','newsletters','social','spam'].includes(category)) return 'archived';
  return 'reference';
}

async function refreshAccessToken(refreshToken) {
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      refresh_token: refreshToken,
      client_id:     process.env.GOOGLE_CLIENT_ID,
      client_secret: process.env.GOOGLE_CLIENT_SECRET,
      grant_type:    'refresh_token',
    }),
  });
  return response.json();
}

async function fetchEmailList(accessToken, maxResults = 50) {
  const url = `https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=${maxResults}&labelIds=INBOX`;
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!response.ok) throw new Error(`Gmail API error: ${response.status}`);
  return response.json();
}

async function fetchEmailDetail(accessToken, messageId) {
  const url = `https://gmail.googleapis.com/gmail/v1/users/me/messages/${messageId}?format=metadata&metadataHeaders=Subject&metadataHeaders=From&metadataHeaders=Date&metadataHeaders=To`;
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  return response.json();
}

function parseHeaders(headers) {
  const get = name => (headers.find(h => h.name === name) || {}).value || '';
  return {
    subject: get('Subject') || '(No subject)',
    from:    get('From'),
    date:    get('Date'),
    to:      get('To'),
  };
}

function formatTime(dateStr) {
  try {
    const date = new Date(dateStr);
    const now  = new Date();
    const diff = now - date;
    const days = Math.floor(diff / 86400000);
    if (days === 0) return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    if (days === 1) return 'Yesterday';
    if (days < 7)  return date.toLocaleDateString([], { weekday: 'short' });
    return date.toLocaleDateString([], { day: 'numeric', month: 'short' });
  } catch { return ''; }
}

module.exports = async (req, res) => {
  // CORS headers for browser fetch
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    // Extract session from Authorization header
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'No session token provided' });
    }

    let session;
    try {
      const encoded = authHeader.replace('Bearer ', '');
      session = JSON.parse(Buffer.from(encoded, 'base64').toString());
    } catch {
      return res.status(401).json({ error: 'Invalid session token' });
    }

    let { accessToken, refreshToken, expiresAt } = session;

    // Refresh token if expired
    if (Date.now() > expiresAt - 60000) {
      console.log('[SEA INBOX] Refreshing expired token for:', session.email);
      const refreshed = await refreshAccessToken(refreshToken);
      if (refreshed.error) {
        return res.status(401).json({ error: 'Session expired. Please reconnect account.' });
      }
      accessToken = refreshed.access_token;
    }

    // Fetch email list from Gmail
    console.log('[SEA INBOX] Fetching emails for:', session.email);
    const maxResults = parseInt(req.query.limit) || 50;
    const emailList  = await fetchEmailList(accessToken, maxResults);

    if (!emailList.messages || emailList.messages.length === 0) {
      return res.status(200).json({ emails: [], total: 0, account: session.email });
    }

    // Fetch details for each email in parallel (batches of 10)
    const messages = emailList.messages;
    const results  = [];
    const batchSize = 10;

    for (let i = 0; i < messages.length; i += batchSize) {
      const batch = messages.slice(i, i + batchSize);
      const details = await Promise.all(
        batch.map(m => fetchEmailDetail(accessToken, m.id))
      );
      results.push(...details);
    }

    // Process and categorise each email
    const emails = results.map((msg, index) => {
      const headers  = parseHeaders(msg.payload?.headers || []);
      const fromName = headers.from.replace(/<.*>/, '').trim().replace(/"/g, '') || headers.from;
      const fromAddr = (headers.from.match(/<(.+)>/) || [])[1] || headers.from;
      const category = categorise(headers.subject, headers.from);
      const urgency  = getUrgency(headers.subject, category);
      const hasFile  = (msg.payload?.parts || []).some(
        p => p.filename && p.filename.length > 0
      );

      return {
        id:       msg.id,
        threadId: msg.threadId,
        from:     fromName,
        addr:     fromAddr,
        subj:     headers.subject,
        time:     formatTime(headers.date),
        cat:      category,
        urg:      urgency,
        mktg:     ['marketing','newsletters','spam'].includes(category),
        file:     hasFile,
        read:     !msg.labelIds?.includes('UNREAD'),
        labels:   msg.labelIds || [],
      };
    });

    // Build account health score
    const total     = emails.length;
    const unread    = emails.filter(e => !e.read).length;
    const noise     = emails.filter(e => e.mktg).length;
    const urgent    = emails.filter(e => e.urg === 'urgent').length;
    const noiseRatio = total > 0 ? (noise / total) : 0;
    const health    = Math.max(0, Math.round(100 - (noiseRatio * 60) - (unread > 20 ? 20 : unread) - (urgent > 5 ? 10 : 0)));

    console.log(`[SEA INBOX] Processed ${emails.length} emails for ${session.email}`);

    res.status(200).json({
      emails,
      total,
      unread,
      noise,
      urgent,
      health,
      account:    session.email,
      name:       session.name,
      picture:    session.picture,
      platform:   'GMAIL',
      fetchedAt:  new Date().toISOString(),
      newToken:   accessToken !== session.accessToken ? accessToken : null,
    });

  } catch (error) {
    console.error('[SEA INBOX] Error:', error.message);
    res.status(500).json({ error: 'Failed to fetch emails. Please try again.' });
  }
};
