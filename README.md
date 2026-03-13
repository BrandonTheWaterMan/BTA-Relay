# BTA Relay Server
**Breaking The Algorithm, LLC — Ad Intelligence Proxy**

Secure Node.js/Express server — proxy between BTA Admin Panel and Meta, Google Ads, TikTok, and Nextdoor APIs. Deployed on Render.

---

## Deploy to Render (5 Minutes)

### Step 1 — Connect GitHub repo on Render
1. Go to render.com → sign in with GitHub
2. Click **New** → **Web Service**
3. Select your BTA-Relay repo

### Step 2 — Configure
- **Build Command:** `npm install`
- **Start Command:** `node server.js`
- **Plan:** Free
- Click **Create Web Service**

### Step 3 — Add Environment Variables
In Render service → **Environment** tab:

```
RELAY_SECRET        = (32+ char random string)
ALLOWED_ORIGIN      = https://bta-cms.netlify.app
META_ACCESS_TOKEN   =
META_AD_ACCOUNT_ID  = act_XXXXXXXXXXXXXXX
GOOGLE_DEVELOPER_TOKEN =
GOOGLE_CUSTOMER_ID  =
GOOGLE_CLIENT_ID    =
GOOGLE_CLIENT_SECRET =
GOOGLE_REFRESH_TOKEN =
TIKTOK_ACCESS_TOKEN =
TIKTOK_ADVERTISER_ID =
NEXTDOOR_ACCESS_TOKEN =
NEXTDOOR_CLIENT_ID  =
```

### Step 4 — Get Your URL
Render assigns: `https://bta-relay.onrender.com`

### Step 5 — Wire Into BTA Admin
Admin panel → CRM → Integrations → paste Relay URL + RELAY_SECRET → Save.

---

## Note on Free Tier
Render free tier sleeps after 15 min inactivity. First request after sleep takes ~30 sec. Upgrade to $7/mo Starter for always-on.

---

## Routes
| Method | Path | Description |
|---|---|---|
| GET | `/health` | Status check |
| GET | `/insights/all` | All platforms |
| GET | `/meta/insights` | Meta performance |
| GET | `/google/insights` | Google Ads |
| GET | `/tiktok/insights` | TikTok Ads |
| GET | `/nextdoor/insights` | Nextdoor Ads |

All routes except `/health` require `x-relay-secret` header.

---

*Breaking The Algorithm, LLC — DeLand, Florida*
*Admin@BreakingTheAlgorithm.com | breakingthealgorithm.com*
