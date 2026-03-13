# BTA Relay Server
**Breaking The Algorithm, LLC — Ad Intelligence Proxy**

Secure Node.js/Express server that acts as a server-side proxy between the BTA Admin Panel and the Meta, Google Ads, TikTok, and Nextdoor advertising APIs. Deployed on Railway.

---

## Why This Exists

Browser-based apps cannot call Meta, Google, TikTok, or Nextdoor APIs directly — CORS blocks it. This relay runs server-side, holds your API keys securely as environment variables, and returns clean normalized data to the BTA admin panel.

---

## Routes

| Method | Path | Description |
|---|---|---|
| GET | `/health` | Status check — shows which platforms are configured |
| GET | `/insights/all` | Pull performance from all platforms in one call |
| GET | `/meta/insights` | Meta (FB/IG) ad performance |
| POST | `/meta/campaign` | Create Meta campaign |
| POST | `/meta/adset` | Create Meta ad set |
| POST | `/meta/creative` | Upload Meta creative |
| POST | `/meta/ad` | Create Meta ad |
| POST | `/meta/pause` | Pause Meta ad(s) |
| POST | `/meta/duplicate` | Duplicate ad set (scale winner) |
| GET | `/google/insights` | Google Ads performance |
| GET | `/tiktok/insights` | TikTok Ads performance |
| GET | `/nextdoor/insights` | Nextdoor Ads performance |

All routes except `/health` require the `x-relay-secret` header.

---

## Deploy to Railway (10 Minutes)

### Step 1 — Push to GitHub

```bash
# Inside your empty GitHub repo:
git clone https://github.com/YOUR_USERNAME/YOUR_REPO_NAME.git
cd YOUR_REPO_NAME

# Copy the bta-relay files into the repo root:
# server.js, package.json, .gitignore, .env.example, README.md

git add .
git commit -m "BTA Relay server — initial deploy"
git push origin main
```

### Step 2 — Create Railway Account

1. Go to [railway.app](https://railway.app)
2. Click **Login** → **Login with GitHub**
3. Authorize Railway

### Step 3 — Deploy from GitHub

1. Click **New Project**
2. Click **Deploy from GitHub repo**
3. Select your repo
4. Railway auto-detects Node.js and starts the build

### Step 4 — Add Environment Variables

In your Railway project → **Variables** tab → add each of these:

```
RELAY_SECRET        = (generate a 32-char random string — keep this private)
ALLOWED_ORIGIN      = https://your-admin-panel.netlify.app
META_ACCESS_TOKEN   = (from Meta Business Manager > System Users)
META_AD_ACCOUNT_ID  = act_XXXXXXXXXXXXXXX
GOOGLE_DEVELOPER_TOKEN = (from Google Ads > Tools > API Center)
GOOGLE_CUSTOMER_ID  = (your Google Ads account ID, no dashes)
GOOGLE_CLIENT_ID    = (from Google Cloud Console OAuth credentials)
GOOGLE_CLIENT_SECRET = (from Google Cloud Console OAuth credentials)
GOOGLE_REFRESH_TOKEN = (from OAuth flow)
TIKTOK_ACCESS_TOKEN = (from TikTok Business API)
TIKTOK_ADVERTISER_ID = (from TikTok Ads Manager)
NEXTDOOR_ACCESS_TOKEN = (from Nextdoor Developer Portal)
NEXTDOOR_CLIENT_ID  = (from Nextdoor Developer Portal)
```

### Step 5 — Get Your Railway URL

In Railway: **Settings** → **Domains** → **Generate Domain**

You'll get a URL like: `https://bta-relay-production.up.railway.app`

### Step 6 — Wire Into BTA Admin Panel

In the admin panel → **CRM** → **Integrations**:
- **Relay URL**: paste your Railway domain (no trailing slash)
- **Relay Secret**: paste the same RELAY_SECRET you set on Railway

Hit **Save** on both. Then open the **Ad Intelligence** panel → **Performance Dashboard** → **Refresh All**.

---

## Test Your Deployment

```bash
# Health check (no auth required)
curl https://your-relay.up.railway.app/health

# Expected response:
# {
#   "status": "ok",
#   "service": "BTA Relay",
#   "platforms": { "meta": true, "google": false, ... }
# }

# Test with auth
curl -H "x-relay-secret: YOUR_SECRET" \
  "https://your-relay.up.railway.app/meta/insights?date_preset=last_7d"
```

---

## Getting API Credentials

### Meta (Facebook / Instagram)
1. Go to [business.facebook.com](https://business.facebook.com)
2. Settings → Users → System Users → Add
3. Create system user with **Advertiser** role
4. Click **Generate New Token** → select your app → check `ads_management`, `ads_read`, `business_management`
5. Copy the token → `META_ACCESS_TOKEN`
6. Settings → Ad Accounts → find your account ID → `META_AD_ACCOUNT_ID` (format: `act_XXXXX`)

### Google Ads
1. Sign into [ads.google.com](https://ads.google.com)
2. Tools → API Center → Apply for developer token (basic access is instant)
3. Create OAuth2 credentials in [Google Cloud Console](https://console.cloud.google.com)
4. Enable the Google Ads API in your project
5. Run the OAuth flow to get a refresh token
   - Scope: `https://www.googleapis.com/auth/adwords`

### TikTok
1. Go to [business-api.tiktok.com](https://business-api.tiktok.com/portal)
2. Apply for Marketing API access
3. Create an app → get Access Token
4. Copy Advertiser ID from TikTok Ads Manager URL

### Nextdoor
1. Go to [developer.nextdoor.com](https://developer.nextdoor.com)
2. Fill out the Ads API access request form
3. Once approved, generate an access token from the Ads Debugger
4. Token valid for 1 week — will need periodic refresh

---

## Local Development

```bash
npm install
cp .env.example .env
# Fill in .env with your credentials
npm run dev
# Server runs at http://localhost:3000
```

---

## Security Notes

- **Never commit `.env`** — it's in `.gitignore`
- **RELAY_SECRET** must be 32+ characters — it's the only thing protecting your ad account access
- **ALLOWED_ORIGIN** should be your exact admin panel URL in production, not `*`
- All API keys live only on Railway as environment variables — never in any HTML or JS file

---

*Breaking The Algorithm, LLC — DeLand, Florida*
*Admin@BreakingTheAlgorithm.com | breakingthealgorithm.com*
