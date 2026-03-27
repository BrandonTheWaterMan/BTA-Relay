// ═══════════════════════════════════════════════════════════════
//  BTA RELAY SERVER
//  Breaking The Algorithm, LLC — Ad Intelligence Proxy
//  Node.js / Express — Deploy to Render
//
//  BTA Ad Routes:
//    GET  /health                   — status check
//    GET  /meta/insights            — pull Meta ad performance
//    POST /meta/campaign            — create campaign
//    POST /meta/adset               — create ad set
//    POST /meta/creative            — upload creative
//    POST /meta/ad                  — create ad
//    POST /meta/pause               — pause ad(s)
//    POST /meta/duplicate           — duplicate ad set (scale)
//    GET  /google/insights          — pull Google Ads performance
//    GET  /tiktok/insights          — pull TikTok ad performance
//    GET  /nextdoor/insights        — pull Nextdoor ad performance
//
//  Water App Routes:
//    POST /water-scan               — EWG + EPA data pull by address
//    POST /generate-proposal        — Claude API → proposal JSON
//    POST /submit-finance-app       — Finance application → email to admin
// ═══════════════════════════════════════════════════════════════

require('dotenv').config();
const express = require('express');
const cors    = require('cors');
const fetch   = require('node-fetch');

const app  = express();
const PORT = process.env.PORT || 3000;

// ── CORS ────────────────────────────────────────────────────────
const allowedOrigin = process.env.ALLOWED_ORIGIN || '*';
app.use(cors({
  origin: allowedOrigin === '*' ? '*' : function(origin, cb) {
    if (!origin || origin === allowedOrigin) return cb(null, true);
    cb(new Error('CORS: origin not allowed — ' + origin));
  },
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'x-relay-secret']
}));
app.options('*', cors());
app.use(express.json({ limit: '10mb' }));

// ── AUTH MIDDLEWARE ─────────────────────────────────────────────
function requireSecret(req, res, next) {
  const secret = req.headers['x-relay-secret'];
  if (!process.env.RELAY_SECRET) {
    return res.status(500).json({ error: 'RELAY_SECRET not configured on server' });
  }
  if (!secret || secret !== process.env.RELAY_SECRET) {
    return res.status(401).json({ error: 'Unauthorized — invalid relay secret' });
  }
  next();
}

// ── REQUEST LOGGER ──────────────────────────────────────────────
app.use((req, res, next) => {
  const ts = new Date().toISOString();
  console.log(`[${ts}] ${req.method} ${req.path}`);
  next();
});

// ═══════════════════════════════════════════════════════════════
//  HEALTH CHECK
// ═══════════════════════════════════════════════════════════════
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'BTA Relay',
    ts: new Date().toISOString(),
    platforms: {
      meta:      !!process.env.META_ACCESS_TOKEN,
      google:    !!process.env.GOOGLE_DEVELOPER_TOKEN,
      tiktok:    !!process.env.TIKTOK_ACCESS_TOKEN,
      nextdoor:  !!process.env.NEXTDOOR_ACCESS_TOKEN
    },
    water_app: {
      claude:    !!process.env.ANTHROPIC_API_KEY,
      sendgrid:  !!process.env.SENDGRID_API_KEY
    }
  });
});

// ═══════════════════════════════════════════════════════════════
//  META — INSIGHTS (Performance Pull)
// ═══════════════════════════════════════════════════════════════
app.get('/meta/insights', requireSecret, async (req, res) => {
  try {
    const token     = process.env.META_ACCESS_TOKEN;
    const accountId = process.env.META_AD_ACCOUNT_ID;
    if (!token || !accountId) return res.status(500).json({ error: 'Meta credentials not configured' });

    const {
      level       = 'ad',
      date_preset = 'last_7d',
      fields      = 'ad_id,ad_name,adset_id,adset_name,campaign_id,campaign_name,impressions,clicks,spend,ctr,cpc,cpm,cpp,reach,frequency,actions,cost_per_action_type',
      time_range,
      filtering
    } = req.query;

    let url = `https://graph.facebook.com/v19.0/${accountId}/insights`
      + `?access_token=${token}`
      + `&level=${level}`
      + `&fields=${encodeURIComponent(fields)}`
      + (date_preset && !time_range ? `&date_preset=${date_preset}` : '')
      + (time_range ? `&time_range=${encodeURIComponent(time_range)}` : '')
      + (filtering ? `&filtering=${encodeURIComponent(filtering)}` : '');

    const resp = await fetch(url);
    const data = await resp.json();
    if (data.error) return res.status(400).json({ error: data.error.message, code: data.error.code });
    res.json(data);
  } catch (err) {
    console.error('[Meta Insights]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ═══════════════════════════════════════════════════════════════
//  META — CREATE CAMPAIGN
// ═══════════════════════════════════════════════════════════════
app.post('/meta/campaign', requireSecret, async (req, res) => {
  try {
    const token     = process.env.META_ACCESS_TOKEN;
    const accountId = process.env.META_AD_ACCOUNT_ID;
    if (!token || !accountId) return res.status(500).json({ error: 'Meta credentials not configured' });

    const { name, objective = 'OUTCOME_LEADS', status = 'PAUSED', special_ad_categories = [] } = req.body;
    if (!name) return res.status(400).json({ error: 'Campaign name is required' });

    const params = new URLSearchParams({ name, objective, status, special_ad_categories: JSON.stringify(special_ad_categories), access_token: token });
    const resp = await fetch(`https://graph.facebook.com/v19.0/${accountId}/campaigns`, { method: 'POST', body: params });
    const data = await resp.json();
    if (data.error) return res.status(400).json({ error: data.error.message });
    res.json(data);
  } catch (err) {
    console.error('[Meta Campaign]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ═══════════════════════════════════════════════════════════════
//  META — CREATE AD SET
// ═══════════════════════════════════════════════════════════════
app.post('/meta/adset', requireSecret, async (req, res) => {
  try {
    const token     = process.env.META_ACCESS_TOKEN;
    const accountId = process.env.META_AD_ACCOUNT_ID;
    if (!token || !accountId) return res.status(500).json({ error: 'Meta credentials not configured' });

    const { campaign_id, name, daily_budget, billing_event = 'IMPRESSIONS', optimization_goal = 'LEAD_GENERATION', targeting, status = 'PAUSED', start_time, end_time } = req.body;
    if (!campaign_id || !name || !daily_budget || !targeting) return res.status(400).json({ error: 'campaign_id, name, daily_budget, targeting are required' });

    const body = { campaign_id, name, daily_budget, billing_event, optimization_goal, targeting: JSON.stringify(targeting), status, access_token: token };
    if (start_time) body.start_time = start_time;
    if (end_time)   body.end_time   = end_time;

    const resp = await fetch(`https://graph.facebook.com/v19.0/${accountId}/adsets`, { method: 'POST', body: new URLSearchParams(body) });
    const data = await resp.json();
    if (data.error) return res.status(400).json({ error: data.error.message });
    res.json(data);
  } catch (err) {
    console.error('[Meta AdSet]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ═══════════════════════════════════════════════════════════════
//  META — UPLOAD CREATIVE
// ═══════════════════════════════════════════════════════════════
app.post('/meta/creative', requireSecret, async (req, res) => {
  try {
    const token     = process.env.META_ACCESS_TOKEN;
    const accountId = process.env.META_AD_ACCOUNT_ID;
    if (!token || !accountId) return res.status(500).json({ error: 'Meta credentials not configured' });

    const { name, page_id, message, headline, description, link, image_url, image_hash, call_to_action_type = 'LEARN_MORE' } = req.body;
    if (!name || !page_id || !link) return res.status(400).json({ error: 'name, page_id, link are required' });

    const link_data = { message, link, name: headline, description, call_to_action: { type: call_to_action_type, value: { link } } };
    if (image_url)  link_data.picture    = image_url;
    if (image_hash) link_data.image_hash = image_hash;

    const params = new URLSearchParams({ name, object_story_spec: JSON.stringify({ page_id, link_data }), access_token: token });
    const resp = await fetch(`https://graph.facebook.com/v19.0/${accountId}/adcreatives`, { method: 'POST', body: params });
    const data = await resp.json();
    if (data.error) return res.status(400).json({ error: data.error.message });
    res.json(data);
  } catch (err) {
    console.error('[Meta Creative]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ═══════════════════════════════════════════════════════════════
//  META — CREATE AD
// ═══════════════════════════════════════════════════════════════
app.post('/meta/ad', requireSecret, async (req, res) => {
  try {
    const token     = process.env.META_ACCESS_TOKEN;
    const accountId = process.env.META_AD_ACCOUNT_ID;
    if (!token || !accountId) return res.status(500).json({ error: 'Meta credentials not configured' });

    const { name, adset_id, creative_id, status = 'PAUSED' } = req.body;
    if (!name || !adset_id || !creative_id) return res.status(400).json({ error: 'name, adset_id, creative_id are required' });

    const params = new URLSearchParams({ name, adset_id, creative: JSON.stringify({ creative_id }), status, access_token: token });
    const resp = await fetch(`https://graph.facebook.com/v19.0/${accountId}/ads`, { method: 'POST', body: params });
    const data = await resp.json();
    if (data.error) return res.status(400).json({ error: data.error.message });
    res.json(data);
  } catch (err) {
    console.error('[Meta Ad]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ═══════════════════════════════════════════════════════════════
//  META — PAUSE AD(S)
// ═══════════════════════════════════════════════════════════════
app.post('/meta/pause', requireSecret, async (req, res) => {
  try {
    const token = process.env.META_ACCESS_TOKEN;
    if (!token) return res.status(500).json({ error: 'Meta credentials not configured' });

    const { ad_ids = [] } = req.body;
    if (!ad_ids.length) return res.status(400).json({ error: 'ad_ids array required' });

    const results = await Promise.all(ad_ids.map(async (id) => {
      const params = new URLSearchParams({ status: 'PAUSED', access_token: token });
      const resp   = await fetch(`https://graph.facebook.com/v19.0/${id}`, { method: 'POST', body: params });
      const data   = await resp.json();
      return { id, success: !!data.success, error: data.error?.message };
    }));
    res.json({ results });
  } catch (err) {
    console.error('[Meta Pause]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ═══════════════════════════════════════════════════════════════
//  META — DUPLICATE AD SET
// ═══════════════════════════════════════════════════════════════
app.post('/meta/duplicate', requireSecret, async (req, res) => {
  try {
    const token     = process.env.META_ACCESS_TOKEN;
    const accountId = process.env.META_AD_ACCOUNT_ID;
    if (!token || !accountId) return res.status(500).json({ error: 'Meta credentials not configured' });

    const { adset_id, new_name, new_daily_budget } = req.body;
    if (!adset_id) return res.status(400).json({ error: 'adset_id required' });

    const getResp  = await fetch(`https://graph.facebook.com/v19.0/${adset_id}?fields=campaign_id,name,daily_budget,targeting,billing_event,optimization_goal&access_token=${token}`);
    const original = await getResp.json();
    if (original.error) return res.status(400).json({ error: original.error.message });

    const params = new URLSearchParams({
      campaign_id: original.campaign_id, name: new_name || original.name + ' [SCALED]',
      daily_budget: new_daily_budget || original.daily_budget, billing_event: original.billing_event,
      optimization_goal: original.optimization_goal, targeting: JSON.stringify(original.targeting),
      status: 'PAUSED', access_token: token
    });
    const resp = await fetch(`https://graph.facebook.com/v19.0/${accountId}/adsets`, { method: 'POST', body: params });
    const data = await resp.json();
    if (data.error) return res.status(400).json({ error: data.error.message });
    res.json({ ...data, original_adset_id: adset_id });
  } catch (err) {
    console.error('[Meta Duplicate]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ═══════════════════════════════════════════════════════════════
//  GOOGLE ADS — INSIGHTS
// ═══════════════════════════════════════════════════════════════
app.get('/google/insights', requireSecret, async (req, res) => {
  try {
    const devToken     = process.env.GOOGLE_DEVELOPER_TOKEN;
    const customerId   = process.env.GOOGLE_CUSTOMER_ID;
    const clientId     = process.env.GOOGLE_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
    const refreshToken = process.env.GOOGLE_REFRESH_TOKEN;
    if (!devToken || !customerId || !refreshToken) return res.status(500).json({ error: 'Google Ads credentials not configured' });

    const tokenResp = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, refresh_token: refreshToken, grant_type: 'refresh_token' })
    });
    const tokenData = await tokenResp.json();
    if (!tokenData.access_token) return res.status(401).json({ error: 'Google OAuth failed: ' + (tokenData.error_description || tokenData.error) });

    const { date_range = 'LAST_7_DAYS', level = 'ad_group_ad' } = req.query;
    const query = `SELECT campaign.id,campaign.name,campaign.status,ad_group.id,ad_group.name,ad_group_ad.ad.id,ad_group_ad.ad.name,ad_group_ad.status,metrics.impressions,metrics.clicks,metrics.cost_micros,metrics.ctr,metrics.average_cpc,metrics.conversions,metrics.cost_per_conversion,metrics.all_conversions,metrics.view_through_conversions FROM ${level} WHERE segments.date DURING ${date_range} AND campaign.status != 'REMOVED' ORDER BY metrics.cost_micros DESC LIMIT 500`;

    const resp = await fetch(`https://googleads.googleapis.com/v15/customers/${customerId}/googleAds:search`, {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + tokenData.access_token, 'developer-token': devToken, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query })
    });
    const data = await resp.json();
    if (data.error) return res.status(400).json({ error: data.error.message || JSON.stringify(data.error) });

    const rows = (data.results || []).map(r => ({
      platform: 'google', campaign_id: r.campaign?.id, campaign_name: r.campaign?.name,
      adset_id: r.adGroup?.id, adset_name: r.adGroup?.name, ad_id: r.adGroupAd?.ad?.id,
      ad_name: r.adGroupAd?.ad?.name, status: r.adGroupAd?.status,
      impressions: parseInt(r.metrics?.impressions || 0), clicks: parseInt(r.metrics?.clicks || 0),
      spend: ((r.metrics?.costMicros || 0) / 1_000_000).toFixed(2), ctr: parseFloat(r.metrics?.ctr || 0).toFixed(4),
      cpc: ((r.metrics?.averageCpc || 0) / 1_000_000).toFixed(2), conversions: parseFloat(r.metrics?.conversions || 0).toFixed(2),
      cpl: parseFloat(r.metrics?.costPerConversion || 0 / 1_000_000).toFixed(2)
    }));
    res.json({ data: rows, total: rows.length });
  } catch (err) {
    console.error('[Google Insights]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ═══════════════════════════════════════════════════════════════
//  TIKTOK — INSIGHTS
// ═══════════════════════════════════════════════════════════════
app.get('/tiktok/insights', requireSecret, async (req, res) => {
  try {
    const token        = process.env.TIKTOK_ACCESS_TOKEN;
    const advertiserId = process.env.TIKTOK_ADVERTISER_ID;
    if (!token || !advertiserId) return res.status(500).json({ error: 'TikTok credentials not configured' });

    const { level = 'AD', days = '7' } = req.query;
    const endDate = new Date(), startDate = new Date();
    startDate.setDate(startDate.getDate() - parseInt(days));
    const fmt = d => d.toISOString().split('T')[0];

    const body = {
      advertiser_id: advertiserId, report_type: 'BASIC', data_level: level,
      dimensions: ['ad_id', 'stat_time_day'],
      metrics: ['campaign_name','adgroup_name','ad_name','spend','impressions','clicks','ctr','cpc','cpm','conversion','cost_per_conversion','real_time_conversion','result_rate'],
      start_date: fmt(startDate), end_date: fmt(endDate), page: 1, page_size: 100
    };
    const resp = await fetch('https://business-api.tiktok.com/open_api/v1.3/report/integrated/get/', {
      method: 'POST', headers: { 'Access-Token': token, 'Content-Type': 'application/json' }, body: JSON.stringify(body)
    });
    const data = await resp.json();
    if (data.code !== 0) return res.status(400).json({ error: data.message, code: data.code });

    const rows = (data.data?.list || []).map(r => ({
      platform: 'tiktok', ad_id: r.dimensions?.ad_id, ad_name: r.metrics?.ad_name,
      adset_name: r.metrics?.adgroup_name, campaign_name: r.metrics?.campaign_name,
      date: r.dimensions?.stat_time_day, impressions: parseInt(r.metrics?.impressions || 0),
      clicks: parseInt(r.metrics?.clicks || 0), spend: parseFloat(r.metrics?.spend || 0).toFixed(2),
      ctr: parseFloat(r.metrics?.ctr || 0).toFixed(4), cpc: parseFloat(r.metrics?.cpc || 0).toFixed(2),
      cpm: parseFloat(r.metrics?.cpm || 0).toFixed(2), conversions: parseInt(r.metrics?.conversion || 0),
      cpl: parseFloat(r.metrics?.cost_per_conversion || 0).toFixed(2)
    }));
    res.json({ data: rows, total: rows.length });
  } catch (err) {
    console.error('[TikTok Insights]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ═══════════════════════════════════════════════════════════════
//  NEXTDOOR — INSIGHTS
// ═══════════════════════════════════════════════════════════════
app.get('/nextdoor/insights', requireSecret, async (req, res) => {
  try {
    const token    = process.env.NEXTDOOR_ACCESS_TOKEN;
    const clientId = process.env.NEXTDOOR_CLIENT_ID;
    if (!token || !clientId) return res.status(500).json({ error: 'Nextdoor credentials not configured' });

    const { days = '7' } = req.query;
    const endDate = new Date(), startDate = new Date();
    startDate.setDate(startDate.getDate() - parseInt(days));
    const fmt = d => d.toISOString().split('T')[0];

    const query = `query { partnerCampaigns(clientId: "${clientId}") { id name status lineItems { id name status stats(startDate: "${fmt(startDate)}", endDate: "${fmt(endDate)}") { impressions clicks spend conversions } } } }`;
    const resp = await fetch('https://ads.nextdoor.com/v1/api', {
      method: 'POST', headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' }, body: JSON.stringify({ query })
    });
    const data = await resp.json();
    if (data.errors) return res.status(400).json({ error: data.errors[0]?.message || 'Nextdoor API error' });

    const rows = [];
    for (const campaign of (data.data?.partnerCampaigns || [])) {
      for (const li of (campaign.lineItems || [])) {
        const s = li.stats || {}, spend = parseFloat(s.spend || 0), clicks = parseInt(s.clicks || 0), convs = parseInt(s.conversions || 0);
        rows.push({
          platform: 'nextdoor', campaign_id: campaign.id, campaign_name: campaign.name,
          ad_id: li.id, ad_name: li.name, status: li.status,
          impressions: parseInt(s.impressions || 0), clicks, spend: spend.toFixed(2),
          ctr: clicks && s.impressions ? (clicks / s.impressions * 100).toFixed(4) : '0.0000',
          cpc: clicks ? (spend / clicks).toFixed(2) : '0.00', conversions: convs,
          cpl: convs ? (spend / convs).toFixed(2) : '0.00'
        });
      }
    }
    res.json({ data: rows, total: rows.length });
  } catch (err) {
    console.error('[Nextdoor Insights]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ═══════════════════════════════════════════════════════════════
//  UNIFIED INSIGHTS — All platforms in one call
// ═══════════════════════════════════════════════════════════════
app.get('/insights/all', requireSecret, async (req, res) => {
  const { days = '7' } = req.query;
  const results = { meta: null, google: null, tiktok: null, nextdoor: null, errors: {} };

  const callPlatform = async (platform, url) => {
    try {
      const resp = await fetch(`http://localhost:${PORT}${url}`, { headers: { 'x-relay-secret': process.env.RELAY_SECRET } });
      const data = await resp.json();
      if (data.error) results.errors[platform] = data.error;
      else results[platform] = data;
    } catch (e) { results.errors[platform] = e.message; }
  };

  await Promise.all([
    callPlatform('meta',     `/meta/insights?date_preset=last_${days === '7' ? '7' : '30'}d`),
    callPlatform('google',   `/google/insights?days=${days}`),
    callPlatform('tiktok',   `/tiktok/insights?days=${days}`),
    callPlatform('nextdoor', `/nextdoor/insights?days=${days}`)
  ]);
  res.json(results);
});

// ═══════════════════════════════════════════════════════════════
//  WATER APP — /water-scan
//  POST body: { address, zipCode, city, state, waterSource, contact }
//  Pulls EWG tap water data by zip code + builds contaminant report
// ═══════════════════════════════════════════════════════════════
app.post('/water-scan', async (req, res) => {
  try {
    const { address, zipCode, city, state, waterSource, contact } = req.body;
    if (!zipCode) return res.status(400).json({ error: 'zipCode is required' });

    // EWG Tap Water Database — public data endpoint by zip
    let ewgData = null;
    try {
      const ewgResp = await fetch(
        `https://www.ewg.org/tapwater/api/zip/${zipCode}`,
        { headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'application/json' } }
      );
      if (ewgResp.ok) ewgData = await ewgResp.json();
    } catch (e) {
      console.warn('[water-scan] EWG fetch failed, using fallback:', e.message);
    }

    // Build normalized result — use EWG data if available, fallback to FL defaults
    const contaminants = [];
    let utility        = `${city || ''} Water Utility`;
    let hardness       = 'Unknown';
    let ewgScore       = null;
    let epaCompliant   = true;

    if (ewgData && ewgData.utilities && ewgData.utilities.length > 0) {
      const u = ewgData.utilities[0];
      utility  = u.name || utility;

      if (u.contaminants) {
        for (const c of u.contaminants) {
          if (c.max_detected > c.legal_limit || c.max_detected > c.health_guideline) {
            contaminants.push(c.name);
          }
        }
      }
      ewgScore     = u.score || null;
      epaCompliant = u.violations ? u.violations.length === 0 : true;
    } else {
      // Florida-specific fallback data by region
      const flContaminants = {
        'Volusia':  ['Total Trihalomethanes (TTHMs)', 'Haloacetic Acids (HAA5)', 'Chlorine Residual'],
        'Seminole': ['Total Trihalomethanes (TTHMs)', 'Radium', 'Chlorine Residual'],
        'Orange':   ['Total Trihalomethanes (TTHMs)', 'Haloacetic Acids (HAA5)', 'Arsenic'],
        'Flagler':  ['Total Trihalomethanes (TTHMs)', 'Chlorine Residual'],
        'default':  ['Total Trihalomethanes (TTHMs)', 'Haloacetic Acids (HAA5)', 'Chlorine Residual']
      };
      const regionKey = Object.keys(flContaminants).find(k => (city || '').includes(k)) || 'default';
      contaminants.push(...flContaminants[regionKey]);
      epaCompliant = true;
    }

    // Hardness lookup by FL zip prefix
    const zip3 = (zipCode || '').substring(0, 3);
    const hardnessMap = {
      '321': 'Hard (15–20 gpg)',
      '322': 'Moderately Hard (10–15 gpg)',
      '327': 'Hard (15–20 gpg)',
      '328': 'Very Hard (20+ gpg)',
      '329': 'Moderately Hard (10–15 gpg)',
      '386': 'Hard (15–18 gpg)'
    };
    hardness = hardnessMap[zip3] || 'Moderately Hard (10–15 gpg)';

    // Build summary for Claude proposal step
    const summary = waterSource === 'well'
      ? `Private well water in ${city || 'your area'} commonly contains iron, sulfur, bacteria, and hardness minerals that require full treatment.`
      : `Municipal water in ${city || 'your area'} meets EPA standards but contains elevated disinfection byproducts (${contaminants.slice(0,2).join(', ')}) from chlorination treatment, plus significant hardness minerals.`;

    // Determine recommended system code
    let recommendation = 'C2';
    if (waterSource === 'well') recommendation = 'W1';
    else if (contaminants.length <= 1) recommendation = 'C1';

    const result = {
      utility,
      hardness,
      contaminants,
      ewgScore,
      epaCompliant,
      summary,
      recommendation,
      waterSource,
      zipCode,
      city,
      state,
      scannedAt: new Date().toISOString()
    };

    console.log(`[water-scan] ${zipCode} — ${contaminants.length} contaminants, system: ${recommendation}`);
    res.json(result);

  } catch (err) {
    console.error('[water-scan]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ═══════════════════════════════════════════════════════════════
//  WATER APP — /generate-proposal
//  POST body: { contact, address, waterSource, ewgData, zipCode }
//  Calls Claude API → returns structured proposal JSON
// ═══════════════════════════════════════════════════════════════
app.post('/generate-proposal', async (req, res) => {
  try {
    const { contact, address, waterSource, ewgData, zipCode } = req.body;
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) return res.status(500).json({ error: 'ANTHROPIC_API_KEY not configured' });
    if (!ewgData) return res.status(400).json({ error: 'ewgData is required' });

    // System code → equipment description map
    const systemMap = {
      C1: { name: 'Whole-Home Water Softener System', code: 'C1', description: 'A high-efficiency water softener eliminates hardness minerals throughout your entire home — protecting appliances, plumbing, and skin from scale buildup.', investment: 2495, monthly: 99, term: '24 months', warranty: 10 },
      C2: { name: 'Whole-Home Softener + Under-Sink Reverse Osmosis', code: 'C2', description: 'Our most popular city water solution — a whole-home softener removes hardness and chlorine throughout the house, while a 5-stage reverse osmosis system delivers pure drinking water at your kitchen tap.', investment: 3295, monthly: 129, term: '24 months', warranty: 10 },
      W1: { name: 'Whole-Home Iron & Sulfur Block System with Chlorine Injection', code: 'W1', description: 'A complete well water solution — multi-stage filtration eliminates iron, hydrogen sulfide, and bacteria using a chemical-free process, plus a chlorination system provides ongoing disinfection protection.', investment: 4850, monthly: 189, term: '24 months', warranty: 10 },
      W2: { name: 'Whole-Home Iron & Sulfur Block System', code: 'W2', description: 'For well water without bacteria concerns — a multi-stage chemical-free filtration system eliminates iron, hydrogen sulfide, and hardness minerals throughout your entire home.', investment: 3950, monthly: 155, term: '24 months', warranty: 10 },
      W3: { name: 'Chlorine Injection System Add-On', code: 'W3', description: 'Adding chlorination protection to your existing well water filtration — a precision injection system eliminates bacteria and provides continuous disinfection for safe water throughout your home.', investment: 1850, monthly: 75, term: '24 months', warranty: 5 },
      W4: { name: 'Chlorine Injection System Upgrade', code: 'W4', description: 'Upgrading your existing chlorination system to a modern precision injection unit — providing more consistent disinfection and reduced chemical usage.', investment: 1450, monthly: 59, term: '24 months', warranty: 5 }
    };

    const rec     = ewgData.recommendation || (waterSource === 'well' ? 'W1' : 'C2');
    const sysBase = systemMap[rec] || systemMap['C2'];

    // Claude prompt — returns JSON only
    const prompt = `You are a water treatment proposal writer for CFL Water Treatment LLC in DeLand, Florida. Generate a water treatment proposal as a JSON object only — no markdown, no explanation, just raw JSON.

Water report data:
- Address: ${address}
- Water source: ${waterSource}
- Utility: ${ewgData.utility}
- Hardness: ${ewgData.hardness}
- Contaminants detected: ${(ewgData.contaminants || []).join(', ')}
- EPA compliant: ${ewgData.epaCompliant}
- Summary: ${ewgData.summary}
- Recommended system code: ${rec}

Base system info:
- System name: ${sysBase.name}
- Base investment: $${sysBase.investment}

Return ONLY this JSON structure, no other text:
{
  "systemName": "string — the system name",
  "systemCode": "string — the system code (C1/C2/W1/W2/W3/W4)",
  "description": "string — 2-3 sentences describing what this system does for this specific customer based on their water report. Mention the specific contaminants being addressed. No pricing, no company name, no fluff.",
  "totalInvestment": number,
  "monthlyOption": number,
  "term": "string — e.g. 24 months",
  "warrantyYears": number,
  "keyBenefits": ["string", "string", "string"],
  "urgencyNote": "string — one sentence about why their specific water issue matters for health or home, based on the contaminants detected"
}`;

    const claudeResp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key':         apiKey,
        'anthropic-version': '2023-06-01',
        'content-type':      'application/json'
      },
      body: JSON.stringify({
        model:      'claude-sonnet-4-6',
        max_tokens: 800,
        messages:   [{ role: 'user', content: prompt }]
      })
    });

    const claudeData = await claudeResp.json();
    if (claudeData.error) throw new Error('Claude API: ' + claudeData.error.message);

    const raw = claudeData.content?.[0]?.text || '';
    // Strip any accidental markdown fences
    const cleaned = raw.replace(/```json|```/g, '').trim();

    let proposal;
    try {
      proposal = JSON.parse(cleaned);
    } catch (e) {
      // Claude returned something unexpected — use base system data
      console.warn('[generate-proposal] JSON parse failed, using fallback');
      proposal = {
        systemName:      sysBase.name,
        systemCode:      rec,
        description:     sysBase.description,
        totalInvestment: sysBase.investment,
        monthlyOption:   sysBase.monthly,
        term:            sysBase.term,
        warrantyYears:   sysBase.warranty,
        keyBenefits:     ['Whole-home protection', 'Professional installation', '10-year warranty'],
        urgencyNote:     ewgData.summary
      };
    }

    console.log(`[generate-proposal] ${address} — system: ${proposal.systemCode}, investment: $${proposal.totalInvestment}`);
    res.json(proposal);

  } catch (err) {
    console.error('[generate-proposal]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ═══════════════════════════════════════════════════════════════
//  WATER APP — /submit-finance-app
//  POST body: { contact, address, proposal, application }
//  Emails finance application to Admin@BreakingTheAlgorithm.com
// ═══════════════════════════════════════════════════════════════
app.post('/submit-finance-app', async (req, res) => {
  try {
    const { contact, address, proposal, application } = req.body;
    if (!contact || !application) return res.status(400).json({ error: 'contact and application are required' });

    const apiKey = process.env.SENDGRID_API_KEY;
    if (!apiKey) return res.status(500).json({ error: 'SENDGRID_API_KEY not configured' });

    const {
      firstName, lastName, email, phone
    } = contact;

    const {
      dob, ssn_last4, annualIncome, employerName, employmentStatus,
      monthlyRent, yearsAtAddress, requestedAmount, coApplicant
    } = application;

    const systemName  = proposal?.systemName || 'Water Treatment System';
    const investment  = proposal?.totalInvestment ? `$${proposal.totalInvestment.toLocaleString()}` : 'TBD';
    const submitTime  = new Date().toLocaleString('en-US', { timeZone: 'America/New_York' });

    const emailBody = `
<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"></head>
<body style="font-family: Georgia, serif; max-width: 600px; margin: 0 auto; padding: 20px; color: #1E2A35;">

<div style="background: #1E2A35; padding: 24px; border-radius: 8px 8px 0 0; text-align: center;">
  <h1 style="color: #C9A84C; margin: 0; font-size: 22px; letter-spacing: 0.05em;">FINANCE APPLICATION</h1>
  <p style="color: #aaa; margin: 6px 0 0; font-size: 13px;">CFL Water Treatment LLC — The Water App</p>
</div>

<div style="background: #f7f9fa; padding: 24px; border: 1px solid #e0e0e0; border-top: none;">

  <p style="margin: 0 0 20px; color: #555; font-size: 13px;">Submitted: ${submitTime}</p>

  <h2 style="color: #1E2A35; font-size: 16px; border-bottom: 2px solid #C9A84C; padding-bottom: 6px;">Applicant</h2>
  <table style="width:100%; border-collapse:collapse; margin-bottom:20px; font-size:14px;">
    <tr><td style="padding:6px 0; color:#555; width:40%">Name</td><td style="padding:6px 0; font-weight:bold;">${firstName} ${lastName}</td></tr>
    <tr><td style="padding:6px 0; color:#555;">Email</td><td style="padding:6px 0;">${email}</td></tr>
    <tr><td style="padding:6px 0; color:#555;">Phone</td><td style="padding:6px 0;">${phone}</td></tr>
    <tr><td style="padding:6px 0; color:#555;">Address</td><td style="padding:6px 0;">${address}</td></tr>
    <tr><td style="padding:6px 0; color:#555;">Date of Birth</td><td style="padding:6px 0;">${dob || '—'}</td></tr>
    <tr><td style="padding:6px 0; color:#555;">SSN Last 4</td><td style="padding:6px 0;">***-**-${ssn_last4 || '—'}</td></tr>
  </table>

  <h2 style="color: #1E2A35; font-size: 16px; border-bottom: 2px solid #C9A84C; padding-bottom: 6px;">Employment & Income</h2>
  <table style="width:100%; border-collapse:collapse; margin-bottom:20px; font-size:14px;">
    <tr><td style="padding:6px 0; color:#555; width:40%">Employment Status</td><td style="padding:6px 0; font-weight:bold;">${employmentStatus || '—'}</td></tr>
    <tr><td style="padding:6px 0; color:#555;">Employer</td><td style="padding:6px 0;">${employerName || '—'}</td></tr>
    <tr><td style="padding:6px 0; color:#555;">Annual Income</td><td style="padding:6px 0;">${annualIncome ? '$' + Number(annualIncome).toLocaleString() : '—'}</td></tr>
    <tr><td style="padding:6px 0; color:#555;">Monthly Rent/Mortgage</td><td style="padding:6px 0;">${monthlyRent ? '$' + Number(monthlyRent).toLocaleString() : '—'}</td></tr>
    <tr><td style="padding:6px 0; color:#555;">Years at Address</td><td style="padding:6px 0;">${yearsAtAddress || '—'}</td></tr>
  </table>

  <h2 style="color: #1E2A35; font-size: 16px; border-bottom: 2px solid #C9A84C; padding-bottom: 6px;">Requested Financing</h2>
  <table style="width:100%; border-collapse:collapse; margin-bottom:20px; font-size:14px;">
    <tr><td style="padding:6px 0; color:#555; width:40%">System</td><td style="padding:6px 0; font-weight:bold;">${systemName}</td></tr>
    <tr><td style="padding:6px 0; color:#555;">Total Investment</td><td style="padding:6px 0; font-weight:bold; color:#C9A84C;">${investment}</td></tr>
    <tr><td style="padding:6px 0; color:#555;">Requested Amount</td><td style="padding:6px 0;">${requestedAmount ? '$' + Number(requestedAmount).toLocaleString() : investment}</td></tr>
  </table>

  ${coApplicant && coApplicant.firstName ? `
  <h2 style="color: #1E2A35; font-size: 16px; border-bottom: 2px solid #C9A84C; padding-bottom: 6px;">Co-Applicant</h2>
  <table style="width:100%; border-collapse:collapse; margin-bottom:20px; font-size:14px;">
    <tr><td style="padding:6px 0; color:#555; width:40%">Name</td><td style="padding:6px 0; font-weight:bold;">${coApplicant.firstName} ${coApplicant.lastName}</td></tr>
    <tr><td style="padding:6px 0; color:#555;">Date of Birth</td><td style="padding:6px 0;">${coApplicant.dob || '—'}</td></tr>
    <tr><td style="padding:6px 0; color:#555;">SSN Last 4</td><td style="padding:6px 0;">***-**-${coApplicant.ssn_last4 || '—'}</td></tr>
    <tr><td style="padding:6px 0; color:#555;">Annual Income</td><td style="padding:6px 0;">${coApplicant.annualIncome ? '$' + Number(coApplicant.annualIncome).toLocaleString() : '—'}</td></tr>
  </table>
  ` : ''}

  <div style="background:#fff3cd; border:1px solid #C9A84C; border-radius:6px; padding:14px; margin-top:8px; font-size:13px; color:#856404;">
    <strong>Action required:</strong> Review this application and contact the applicant at <strong>${phone}</strong> or <strong>${email}</strong> to discuss approval and next steps.
  </div>

</div>

<div style="background:#1E2A35; padding:14px 24px; border-radius:0 0 8px 8px; text-align:center;">
  <p style="color:#888; font-size:11px; margin:0;">CFL Water Treatment LLC · (386) 349-0533 · Admin@BreakingTheAlgorithm.com</p>
</div>

</body>
</html>`;

    const sgResp = await fetch('https://api.sendgrid.com/v3/mail/send', {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + apiKey,
        'Content-Type':  'application/json'
      },
      body: JSON.stringify({
        personalizations: [{ to: [{ email: 'Admin@BreakingTheAlgorithm.com', name: 'Brandon Sheets' }] }],
        from:    { email: 'Admin@BreakingTheAlgorithm.com', name: 'The Water App' },
        reply_to: { email: email, name: `${firstName} ${lastName}` },
        subject: `Finance Application — ${firstName} ${lastName} — ${investment}`,
        content: [{ type: 'text/html', value: emailBody }]
      })
    });

    if (!sgResp.ok) {
      const errText = await sgResp.text();
      throw new Error('SendGrid error: ' + errText);
    }

    console.log(`[submit-finance-app] Application submitted — ${firstName} ${lastName} — ${investment}`);
    res.json({ success: true, message: 'Application received. We will contact you within 1 business day.' });

  } catch (err) {
    console.error('[submit-finance-app]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ═══════════════════════════════════════════════════════════════
//  404 CATCH-ALL
// ═══════════════════════════════════════════════════════════════
app.use((req, res) => {
  res.status(404).json({ error: 'Route not found — BTA Relay' });
});

// ═══════════════════════════════════════════════════════════════
//  START
// ═══════════════════════════════════════════════════════════════
app.listen(PORT, () => {
  console.log(`\n[BTA Relay] Running on port ${PORT}`);
  console.log(`[BTA Relay] RELAY_SECRET:    ${process.env.RELAY_SECRET        ? '✓ set'           : '✗ MISSING'}`);
  console.log(`[BTA Relay] Meta:            ${process.env.META_ACCESS_TOKEN    ? '✓'               : '✗ not configured'}`);
  console.log(`[BTA Relay] Google:          ${process.env.GOOGLE_DEVELOPER_TOKEN ? '✓'             : '✗ not configured'}`);
  console.log(`[BTA Relay] TikTok:          ${process.env.TIKTOK_ACCESS_TOKEN  ? '✓'               : '✗ not configured'}`);
  console.log(`[BTA Relay] Nextdoor:        ${process.env.NEXTDOOR_ACCESS_TOKEN ? '✓'              : '✗ not configured'}`);
  console.log(`[BTA Relay] Claude API:      ${process.env.ANTHROPIC_API_KEY    ? '✓'               : '✗ not configured — /generate-proposal will fail'}`);
  console.log(`[BTA Relay] SendGrid:        ${process.env.SENDGRID_API_KEY     ? '✓'               : '✗ not configured — /submit-finance-app will fail'}\n`);
});
