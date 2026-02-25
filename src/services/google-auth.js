const fs = require('fs');
const path = require('path');
const http = require('http');
const { google } = require('googleapis');
const { CREDENTIALS_PATH, TOKEN_PATH } = require('../config');

const SCOPES = [
  'https://www.googleapis.com/auth/calendar',
  'https://www.googleapis.com/auth/gmail.readonly',
];

let authClient = null;

/**
 * Load or create OAuth2 client with stored credentials.
 * @returns {Promise<import('googleapis').Auth.OAuth2Client>}
 */
async function getAuthClient() {
  if (authClient) return authClient;

  if (!fs.existsSync(CREDENTIALS_PATH)) {
    console.warn(
      '⚠️  Google credentials.json not found. Calendar and Gmail tools will be unavailable.\n' +
      '   To set up: download OAuth2 credentials from Google Cloud Console and save as credentials.json'
    );
    return null;
  }

  const credentials = JSON.parse(fs.readFileSync(CREDENTIALS_PATH, 'utf-8'));
  const { client_id, client_secret, redirect_uris } = credentials.installed || credentials.web || {};

  if (!client_id || !client_secret) {
    console.error('❌ Invalid credentials.json format. Expected "installed" or "web" client.');
    return null;
  }

  const redirectUri = redirect_uris?.[0] || 'http://localhost:3000/oauth2callback';
  const oauth2Client = new google.auth.OAuth2(client_id, client_secret, redirectUri);

  // Try loading stored token
  if (fs.existsSync(TOKEN_PATH)) {
    const token = JSON.parse(fs.readFileSync(TOKEN_PATH, 'utf-8'));
    oauth2Client.setCredentials(token);

    // Set up auto-refresh and save
    oauth2Client.on('tokens', (tokens) => {
      const current = JSON.parse(fs.readFileSync(TOKEN_PATH, 'utf-8'));
      const updated = { ...current, ...tokens };
      fs.writeFileSync(TOKEN_PATH, JSON.stringify(updated, null, 2));
      console.log('🔄 Google OAuth token refreshed and saved.');
    });

    authClient = oauth2Client;
    console.log('✅ Google OAuth loaded from stored token.');
    return authClient;
  }

  // No stored token — need to authorize
  console.log('🔑 No Google token found. Run `npm run auth` to authorize.');
  return null;
}

/**
 * Interactive authorization flow.
 * Run this standalone with `npm run auth` to get the initial token.
 */
async function authorize() {
  if (!fs.existsSync(CREDENTIALS_PATH)) {
    console.error('❌ credentials.json not found. Download it from Google Cloud Console.');
    console.error('   1. Go to https://console.cloud.google.com/apis/credentials');
    console.error('   2. Create an OAuth 2.0 Client ID (Desktop app)');
    console.error('   3. Download and save as credentials.json in the project root');
    process.exit(1);
  }

  const credentials = JSON.parse(fs.readFileSync(CREDENTIALS_PATH, 'utf-8'));
  const { client_id, client_secret } = credentials.installed || credentials.web || {};
  const redirectUri = 'http://localhost:3000/oauth2callback';

  const oauth2Client = new google.auth.OAuth2(client_id, client_secret, redirectUri);

  const authorizeUrl = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: SCOPES,
    prompt: 'consent', // force refresh token
  });

  console.log('\n📋 Open this URL in your browser to authorize:\n');
  console.log(authorizeUrl);
  console.log('\n⏳ Waiting for authorization...\n');

  // Start a temporary local server to catch the redirect
  const code = await new Promise((resolve, reject) => {
    const server = http.createServer(async (req, res) => {
      const url = new URL(req.url, 'http://localhost:3000');
      const authCode = url.searchParams.get('code');

      if (authCode) {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end('<h1>✅ Authorization successful!</h1><p>You can close this tab and return to the terminal.</p>');
        server.close();
        resolve(authCode);
      } else {
        res.writeHead(400, { 'Content-Type': 'text/html' });
        res.end('<h1>❌ Authorization failed</h1><p>No code received.</p>');
      }
    });

    server.listen(3000, () => {
      console.log('🌐 Local server listening on http://localhost:3000');
    });

    // Timeout after 5 minutes
    setTimeout(() => {
      server.close();
      reject(new Error('Authorization timed out after 5 minutes'));
    }, 5 * 60 * 1000);
  });

  const { tokens } = await oauth2Client.getToken(code);
  oauth2Client.setCredentials(tokens);

  fs.writeFileSync(TOKEN_PATH, JSON.stringify(tokens, null, 2));
  console.log('\n✅ Token saved to token.json. Google Calendar and Gmail are now available!');

  return oauth2Client;
}

/**
 * Get an authenticated Google Calendar API client.
 * @returns {Promise<import('googleapis').calendar_v3.Calendar | null>}
 */
async function getCalendar() {
  const auth = await getAuthClient();
  if (!auth) return null;
  return google.calendar({ version: 'v3', auth });
}

/**
 * Get an authenticated Gmail API client.
 * @returns {Promise<import('googleapis').gmail_v1.Gmail | null>}
 */
async function getGmail() {
  const auth = await getAuthClient();
  if (!auth) return null;
  return google.gmail({ version: 'v1', auth });
}

// If run directly, start authorization flow
if (require.main === module) {
  authorize().catch(err => {
    console.error('Authorization failed:', err.message);
    process.exit(1);
  });
}

module.exports = { getAuthClient, getCalendar, getGmail, authorize };
