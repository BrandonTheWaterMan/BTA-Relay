// ═══════════════════════════════════════════════════════════════
//  BTA RELAY SERVER
//  Breaking The Algorithm, LLC — Ad Intelligence Proxy
//  Node.js / Express — Deploy to Railway
//
//  Routes:
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
    }
  });
});

// ═══════════════════════════════════════════════════════════════
//  META — INSIGHTS (Performance Pull)
// ═══════════════════════════════════════════════════════════════
// GET /meta/insights?level=ad&date_preset=last_7d&fields=impressions,clicks,spend,ctr,cpc,cpm,cpp,actions,cost_per_action_type
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
// POST /meta/campaign
// Body: { name, objective, status, daily_budget, special_ad_categories }
app.post('/meta/campaign', requireSecret, async (req, res) => {
  try {
    const token     = process.env.META_ACCESS_TOKEN;
    const accountId = process.env.META_AD_ACCOUNT_ID;
    if (!token || !accountId) return res.status(500).json({ error: 'Meta credentials not configured' });

    const {
      name,
      objective         = 'OUTCOME_LEADS',
      status            = 'PAUSED',
      special_ad_categories = []
    } = req.body;

    if (!name) return res.status(400).json({ error: 'Campaign name is required' });

    const params = new URLSearchParams({
      name,
      objective,
      status,
      special_ad_categories: JSON.stringify(special_ad_categories),
      access_token: token
    });

    const resp = await fetch(
      `https://graph.facebook.com/v19.0/${accountId}/campaigns`,
      { method: 'POST', body: params }
    );
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
// POST /meta/adset
// Body: { campaign_id, name, daily_budget, billing_event, optimization_goal,
//         bid_amount, targeting, status }
app.post('/meta/adset', requireSecret, async (req, res) => {
  try {
    const token     = process.env.META_ACCESS_TOKEN;
    const accountId = process.env.META_AD_ACCOUNT_ID;
    if (!token || !accountId) return res.status(500).json({ error: 'Meta credentials not configured' });

    const {
      campaign_id,
      name,
      daily_budget,
      billing_event       = 'IMPRESSIONS',
      optimization_goal   = 'LEAD_GENERATION',
      targeting,
      status              = 'PAUSED',
      start_time,
      end_time
    } = req.body;

    if (!campaign_id || !name || !daily_budget || !targeting) {
      return res.status(400).json({ error: 'campaign_id, name, daily_budget, targeting are required' });
    }

    const body = {
      campaign_id,
      name,
      daily_budget,
      billing_event,
      optimization_goal,
      targeting: JSON.stringify(targeting),
      status,
      access_token: token
    };
    if (start_time) body.start_time = start_time;
    if (end_time)   body.end_time   = end_time;

    const params = new URLSearchParams(body);
    const resp   = await fetch(
      `https://graph.facebook.com/v19.0/${accountId}/adsets`,
      { method: 'POST', body: params }
    );
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
// POST /meta/creative
// Body: { name, page_id, message, headline, description, link, image_url, call_to_action_type }
app.post('/meta/creative', requireSecret, async (req, res) => {
  try {
    const token     = process.env.META_ACCESS_TOKEN;
    const accountId = process.env.META_AD_ACCOUNT_ID;
    if (!token || !accountId) return res.status(500).json({ error: 'Meta credentials not configured' });

    const {
      name,
      page_id,
      message,
      headline,
      description,
      link,
      image_url,
      image_hash,
      call_to_action_type = 'LEARN_MORE'
    } = req.body;

    if (!name || !page_id || !link) {
      return res.status(400).json({ error: 'name, page_id, link are required' });
    }

    const link_data = {
      message,
      link,
      name: headline,
      description,
      call_to_action: { type: call_to_action_type, value: { link } }
    };
    if (image_url)  link_data.picture   = image_url;
    if (image_hash) link_data.image_hash = image_hash;

    const object_story_spec = {
      page_id,
      link_data
    };

    const params = new URLSearchParams({
      name,
      object_story_spec: JSON.stringify(object_story_spec),
      access_token: token
    });

    const resp = await fetch(
      `https://graph.facebook.com/v19.0/${accountId}/adcreatives`,
      { method: 'POST', body: params }
    );
    const data = await resp.json();
    if (data.error) return res.status(400).json({ error: data.error.message });
    res.json(data);
  } catch (err) {
    console.error('[Meta Creative]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ═══════════════════════════════════════════════════════════════
//  META — CREATE AD (links adset + creative)
// ═══════════════════════════════════════════════════════════════
// POST /meta/ad
// Body: { name, adset_id, creative_id, status }
app.post('/meta/ad', requireSecret, async (req, res) => {
  try {
    const token     = process.env.META_ACCESS_TOKEN;
    const accountId = process.env.META_AD_ACCOUNT_ID;
    if (!token || !accountId) return res.status(500).json({ error: 'Meta credentials not configured' });

    const { name, adset_id, creative_id, status = 'PAUSED' } = req.body;
    if (!name || !adset_id || !creative_id) {
      return res.status(400).json({ error: 'name, adset_id, creative_id are required' });
    }

    const params = new URLSearchParams({
      name,
      adset_id,
      creative: JSON.stringify({ creative_id }),
      status,
      access_token: token
    });

    const resp = await fetch(
      `https://graph.facebook.com/v19.0/${accountId}/ads`,
      { method: 'POST', body: params }
    );
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
// POST /meta/pause
// Body: { ad_ids: ['123', '456'] }
app.post('/meta/pause', requireSecret, async (req, res) => {
  try {
    const token = process.env.META_ACCESS_TOKEN;
    if (!token) return res.status(500).json({ error: 'Meta credentials not configured' });

    const { ad_ids = [] } = req.body;
    if (!ad_ids.length) return res.status(400).json({ error: 'ad_ids array required' });

    const results = await Promise.all(ad_ids.map(async (id) => {
      const params = new URLSearchParams({ status: 'PAUSED', access_token: token });
      const resp   = await fetch(
        `https://graph.facebook.com/v19.0/${id}`,
        { method: 'POST', body: params }
      );
      const data = await resp.json();
      return { id, success: !!data.success, error: data.error?.message };
    }));

    res.json({ results });
  } catch (err) {
    console.error('[Meta Pause]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ═══════════════════════════════════════════════════════════════
//  META — DUPLICATE AD SET (Scale winner)
// ═══════════════════════════════════════════════════════════════
// POST /meta/duplicate
// Body: { adset_id, new_name, new_daily_budget }
app.post('/meta/duplicate', requireSecret, async (req, res) => {
  try {
    const token     = process.env.META_ACCESS_TOKEN;
    const accountId = process.env.META_AD_ACCOUNT_ID;
    if (!token || !accountId) return res.status(500).json({ error: 'Meta credentials not configured' });

    const { adset_id, new_name, new_daily_budget } = req.body;
    if (!adset_id) return res.status(400).json({ error: 'adset_id required' });

    // Fetch original adset first
    const getResp = await fetch(
      `https://graph.facebook.com/v19.0/${adset_id}?fields=campaign_id,name,daily_budget,targeting,billing_event,optimization_goal&access_token=${token}`
    );
    const original = await getResp.json();
    if (original.error) return res.status(400).json({ error: original.error.message });

    const params = new URLSearchParams({
      campaign_id:        original.campaign_id,
      name:               new_name || original.name + ' [SCALED]',
      daily_budget:       new_daily_budget || original.daily_budget,
      billing_event:      original.billing_event,
      optimization_goal:  original.optimization_goal,
      targeting:          JSON.stringify(original.targeting),
      status:             'PAUSED',
      access_token:       token
    });

    const resp = await fetch(
      `https://graph.facebook.com/v19.0/${accountId}/adsets`,
      { method: 'POST', body: params }
    );
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
// GET /google/insights?date_range=LAST_7_DAYS&level=ad
app.get('/google/insights', requireSecret, async (req, res) => {
  try {
    const devToken      = process.env.GOOGLE_DEVELOPER_TOKEN;
    const customerId    = process.env.GOOGLE_CUSTOMER_ID;
    const clientId      = process.env.GOOGLE_CLIENT_ID;
    const clientSecret  = process.env.GOOGLE_CLIENT_SECRET;
    const refreshToken  = process.env.GOOGLE_REFRESH_TOKEN;

    if (!devToken || !customerId || !refreshToken) {
      return res.status(500).json({ error: 'Google Ads credentials not configured' });
    }

    // Get fresh access token
    const tokenResp = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id:     clientId,
        client_secret: clientSecret,
        refresh_token: refreshToken,
        grant_type:    'refresh_token'
      })
    });
    const tokenData = await tokenResp.json();
    if (!tokenData.access_token) {
      return res.status(401).json({ error: 'Google OAuth failed: ' + (tokenData.error_description || tokenData.error) });
    }

    const { date_range = 'LAST_7_DAYS', level = 'ad_group_ad' } = req.query;

    // GAQL query — pulls key metrics per ad
    const query = `
      SELECT
        campaign.id,
        campaign.name,
        campaign.status,
        ad_group.id,
        ad_group.name,
        ad_group_ad.ad.id,
        ad_group_ad.ad.name,
        ad_group_ad.status,
        metrics.impressions,
        metrics.clicks,
        metrics.cost_micros,
        metrics.ctr,
        metrics.average_cpc,
        metrics.conversions,
        metrics.cost_per_conversion,
        metrics.all_conversions,
        metrics.view_through_conversions
      FROM ${level}
      WHERE segments.date DURING ${date_range}
        AND campaign.status != 'REMOVED'
      ORDER BY metrics.cost_micros DESC
      LIMIT 500
    `.trim();

    const resp = await fetch(
      `https://googleads.googleapis.com/v15/customers/${customerId}/googleAds:search`,
      {
        method: 'POST',
        headers: {
          'Authorization':       'Bearer ' + tokenData.access_token,
          'developer-token':     devToken,
          'Content-Type':        'application/json'
        },
        body: JSON.stringify({ query })
      }
    );

    const data = await resp.json();
    if (data.error) return res.status(400).json({ error: data.error.message || JSON.stringify(data.error) });

    // Normalize to common BTA format
    const rows = (data.results || []).map(r => ({
      platform:     'google',
      campaign_id:  r.campaign?.id,
      campaign_name:r.campaign?.name,
      adset_id:     r.adGroup?.id,
      adset_name:   r.adGroup?.name,
      ad_id:        r.adGroupAd?.ad?.id,
      ad_name:      r.adGroupAd?.ad?.name,
      status:       r.adGroupAd?.status,
      impressions:  parseInt(r.metrics?.impressions || 0),
      clicks:       parseInt(r.metrics?.clicks || 0),
      spend:        ((r.metrics?.costMicros || 0) / 1_000_000).toFixed(2),
      ctr:          parseFloat(r.metrics?.ctr || 0).toFixed(4),
      cpc:          ((r.metrics?.averageCpc || 0) / 1_000_000).toFixed(2),
      conversions:  parseFloat(r.metrics?.conversions || 0).toFixed(2),
      cpl:          parseFloat(r.metrics?.costPerConversion || 0 / 1_000_000).toFixed(2)
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
// GET /tiktok/insights?date_range=7&level=ADGROUP
app.get('/tiktok/insights', requireSecret, async (req, res) => {
  try {
    const token        = process.env.TIKTOK_ACCESS_TOKEN;
    const advertiserId = process.env.TIKTOK_ADVERTISER_ID;
    if (!token || !advertiserId) return res.status(500).json({ error: 'TikTok credentials not configured' });

    const { level = 'AD', days = '7' } = req.query;
    const endDate   = new Date();
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - parseInt(days));

    const fmt = d => d.toISOString().split('T')[0];

    const body = {
      advertiser_id: advertiserId,
      report_type:   'BASIC',
      data_level:    level,
      dimensions:    ['ad_id', 'stat_time_day'],
      metrics:       ['campaign_name', 'adgroup_name', 'ad_name', 'spend', 'impressions',
                      'clicks', 'ctr', 'cpc', 'cpm', 'conversion', 'cost_per_conversion',
                      'real_time_conversion', 'result_rate'],
      start_date:    fmt(startDate),
      end_date:      fmt(endDate),
      page:          1,
      page_size:     100
    };

    const resp = await fetch('https://business-api.tiktok.com/open_api/v1.3/report/integrated/get/', {
      method: 'POST',
      headers: {
        'Access-Token': token,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body)
    });

    const data = await resp.json();
    if (data.code !== 0) return res.status(400).json({ error: data.message, code: data.code });

    // Normalize to BTA format
    const rows = (data.data?.list || []).map(r => ({
      platform:     'tiktok',
      ad_id:        r.dimensions?.ad_id,
      ad_name:      r.metrics?.ad_name,
      adset_name:   r.metrics?.adgroup_name,
      campaign_name:r.metrics?.campaign_name,
      date:         r.dimensions?.stat_time_day,
      impressions:  parseInt(r.metrics?.impressions || 0),
      clicks:       parseInt(r.metrics?.clicks || 0),
      spend:        parseFloat(r.metrics?.spend || 0).toFixed(2),
      ctr:          parseFloat(r.metrics?.ctr || 0).toFixed(4),
      cpc:          parseFloat(r.metrics?.cpc || 0).toFixed(2),
      cpm:          parseFloat(r.metrics?.cpm || 0).toFixed(2),
      conversions:  parseInt(r.metrics?.conversion || 0),
      cpl:          parseFloat(r.metrics?.cost_per_conversion || 0).toFixed(2)
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
// GET /nextdoor/insights?days=7
app.get('/nextdoor/insights', requireSecret, async (req, res) => {
  try {
    const token    = process.env.NEXTDOOR_ACCESS_TOKEN;
    const clientId = process.env.NEXTDOOR_CLIENT_ID;
    if (!token || !clientId) return res.status(500).json({ error: 'Nextdoor credentials not configured' });

    const { days = '7' } = req.query;
    const endDate   = new Date();
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - parseInt(days));
    const fmt = d => d.toISOString().split('T')[0];

    // Nextdoor uses GraphQL
    const query = `
      query {
        partnerCampaigns(clientId: "${clientId}") {
          id
          name
          status
          lineItems {
            id
            name
            status
            stats(startDate: "${fmt(startDate)}", endDate: "${fmt(endDate)}") {
              impressions
              clicks
              spend
              conversions
            }
          }
        }
      }
    `;

    const resp = await fetch('https://ads.nextdoor.com/v1/api', {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + token,
        'Content-Type':  'application/json'
      },
      body: JSON.stringify({ query })
    });

    const data = await resp.json();
    if (data.errors) return res.status(400).json({ error: data.errors[0]?.message || 'Nextdoor API error' });

    // Normalize to BTA format
    const rows = [];
    for (const campaign of (data.data?.partnerCampaigns || [])) {
      for (const li of (campaign.lineItems || [])) {
        const s = li.stats || {};
        const spend   = parseFloat(s.spend || 0);
        const clicks  = parseInt(s.clicks || 0);
        const convs   = parseInt(s.conversions || 0);
        rows.push({
          platform:     'nextdoor',
          campaign_id:  campaign.id,
          campaign_name:campaign.name,
          ad_id:        li.id,
          ad_name:      li.name,
          status:       li.status,
          impressions:  parseInt(s.impressions || 0),
          clicks,
          spend:        spend.toFixed(2),
          ctr:          clicks && s.impressions ? (clicks / s.impressions * 100).toFixed(4) : '0.0000',
          cpc:          clicks ? (spend / clicks).toFixed(2) : '0.00',
          conversions:  convs,
          cpl:          convs ? (spend / convs).toFixed(2) : '0.00'
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
// GET /insights/all?days=7
app.get('/insights/all', requireSecret, async (req, res) => {
  const { days = '7' } = req.query;
  const results = { meta: null, google: null, tiktok: null, nextdoor: null, errors: {} };

  const callPlatform = async (platform, url) => {
    try {
      const resp = await fetch(`http://localhost:${PORT}${url}`, {
        headers: { 'x-relay-secret': process.env.RELAY_SECRET }
      });
      const data = await resp.json();
      if (data.error) results.errors[platform] = data.error;
      else results[platform] = data;
    } catch (e) {
      results.errors[platform] = e.message;
    }
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
  console.log(`[BTA Relay] RELAY_SECRET: ${process.env.RELAY_SECRET ? '✓ set' : '✗ MISSING — server will reject all requests'}`);
  console.log(`[BTA Relay] Meta:     ${process.env.META_ACCESS_TOKEN     ? '✓' : '✗ not configured'}`);
  console.log(`[BTA Relay] Google:   ${process.env.GOOGLE_DEVELOPER_TOKEN ? '✓' : '✗ not configured'}`);
  console.log(`[BTA Relay] TikTok:   ${process.env.TIKTOK_ACCESS_TOKEN    ? '✓' : '✗ not configured'}`);
  console.log(`[BTA Relay] Nextdoor: ${process.env.NEXTDOOR_ACCESS_TOKEN  ? '✓' : '✗ not configured'}\n`);
});
