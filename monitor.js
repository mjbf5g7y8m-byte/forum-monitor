#!/usr/bin/env node
/**
 * Multi-Forum Monitor with Gemini AI + Nansen Token Data
 * Sleduje Gnosis, COW, Safe, StakeWise + ceny + AI summary + Nansen transfers/trades
 */

const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');

const STATE_FILE = path.join(__dirname, '.forum-monitor-state.json');
const CHECK_INTERVAL = 60 * 1000;
const SUMMARY_INTERVAL = 60 * 60 * 1000; // 1 hodina
const NANSEN_INTERVAL = 10 * 60 * 1000;  // 10 minut
const DASHBOARD_URL = 'http://46.101.110.155:3000/api/push';
const DASHBOARD_REFRESH_URL = 'http://46.101.110.155:3000/api/check-refresh';
const API_KEY = 'gnosis-monitor-key-2026';
const GEMINI_API_KEY = process.env.gemini;
const GEMINI_MODEL = 'gemini-2.5-flash';
// Load NANSEN_API_KEY from env or .mogra/.env file
let NANSEN_API_KEY = process.env.NANSEN_API_KEY;
if (!NANSEN_API_KEY) {
  try {
    const envContent = require('fs').readFileSync('/workspace/.mogra/.env', 'utf8');
    const match = envContent.match(/NANSEN_API_KEY="([^"]+)"/);
    if (match) NANSEN_API_KEY = match[1];
  } catch (e) {}
}

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;

// Token addresses for Nansen
const TOKEN_ADDRESSES = {
  gnosis: { address: '0x6810e776880c02933d47db1b9fc05908e5386b96', chain: 'ethereum' },
  cow: { address: '0xDEf1CA1fb7FBcDC777520aa7f396b4E015F497aB', chain: 'ethereum' },
  safe: { address: '0x5afe3855358e112b5647b952709e6165e1c1eeee', chain: 'ethereum' },
  stakewise: { address: '0x48c3399719b582dd63eb5aadf12a40b4c3f52fa2', chain: 'ethereum' },
  wnxm: { address: '0x0d438f3b5175bebc262bf23753c1e53d03432bde', chain: 'ethereum' }
};

// Snapshot spaces for governance
const SNAPSHOT_SPACES = {
  gnosis: 'gnosis.eth',
  cow: 'cow.eth',
  safe: 'safe.eth',
  stakewise: 'stakewise.eth'
  // wNXM uses on-chain governance, not Snapshot
};

const FORUMS = {
  gnosis: { name: 'Gnosis', url: 'https://forum.gnosis.io', apiUrl: 'https://forum.gnosis.io/latest.json', token: 'gnosis', symbol: 'GNO', icon: '🦉' },
  cow: { name: 'CoW Protocol', url: 'https://forum.cow.fi', apiUrl: 'https://forum.cow.fi/latest.json', token: 'cow-protocol', symbol: 'COW', icon: '🐮' },
  safe: { name: 'Safe', url: 'https://forum.safe.global', apiUrl: 'https://forum.safe.global/latest.json', token: 'safe', symbol: 'SAFE', icon: '🔐' },
  stakewise: { name: 'StakeWise', url: 'https://forum.stakewise.io', apiUrl: 'https://forum.stakewise.io/latest.json', token: 'stakewise', symbol: 'SWISE', icon: '🥩' },
  wnxm: { name: 'Nexus Mutual', url: 'https://forum.nexusmutual.io', apiUrl: 'https://forum.nexusmutual.io/latest.json', token: 'wrapped-nxm', symbol: 'wNXM', icon: '🛡️' }
};

const SENTIMENT_KEYWORDS = {
  positive: ['bullish', 'growth', 'adoption', 'partnership', 'launch', 'upgrade', 'success', 'milestone', 'approved', 'passed'],
  negative: ['bearish', 'hack', 'exploit', 'dump', 'concern', 'issue', 'bug', 'delay', 'rejected', 'failed']
};

function loadState() {
  try { 
    if (fs.existsSync(STATE_FILE)) {
      const data = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
      data.activity = data.activity || [];
      data.summaries = data.summaries || {};
      data.nansen = data.nansen || {};
      return data;
    }
  } catch (e) {}
  return { forums: {}, prices: {}, activity: [], summaries: {}, nansen: {}, lastCheck: null, lastSummary: null, lastNansen: null };
}

function saveState(state) { fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2)); }

function fetchJSON(url) {
  return new Promise((resolve, reject) => {
    const proto = url.startsWith('https') ? https : http;
    proto.get(url, { headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36' } }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => { try { resolve(JSON.parse(data)); } catch (e) { reject(new Error('Invalid JSON')); } });
    }).on('error', reject);
  });
}

function postJSON(url, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const proto = urlObj.protocol === 'https:' ? https : http;
    const postData = JSON.stringify(body);
    const req = proto.request({
      hostname: urlObj.hostname, port: urlObj.port || (urlObj.protocol === 'https:' ? 443 : 80),
      path: urlObj.pathname + urlObj.search, method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(postData), ...headers }
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve({ status: res.statusCode, body: data }));
    });
    req.on('error', reject);
    req.write(postData); req.end();
  });
}

async function sendTelegram(message) {
  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) return;
  const postData = JSON.stringify({ chat_id: TELEGRAM_CHAT_ID, text: message, parse_mode: 'HTML', disable_web_page_preview: true });
  return new Promise(resolve => {
    const req = https.request(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(postData) }
    }, () => resolve());
    req.on('error', () => resolve());
    req.write(postData); req.end();
  });
}

function analyzeSentiment(title) {
  const text = title.toLowerCase();
  let score = 0;
  SENTIMENT_KEYWORDS.positive.forEach(w => { if (text.includes(w)) score++; });
  SENTIMENT_KEYWORDS.negative.forEach(w => { if (text.includes(w)) score--; });
  return { score, mood: score > 0 ? '🟢 Bullish' : score < 0 ? '🔴 Bearish' : '😐 Neutral' };
}

function calculateForumSentiment(topics) {
  const recent = topics.slice(0, 20);
  let totalScore = 0, activity = 0;
  const now = Date.now();
  for (const t of recent) {
    totalScore += analyzeSentiment(t.title).score;
    if (now - new Date(t.last_posted_at).getTime() < 24 * 60 * 60 * 1000) activity += t.posts_count;
  }
  const avg = totalScore / recent.length;
  return { score: avg.toFixed(2), mood: avg > 0.3 ? '🟢 Bullish' : avg < -0.3 ? '🔴 Bearish' : '😐 Neutral', activity24h: activity };
}

async function fetchPrices() {
  try {
    const ids = Object.values(FORUMS).map(f => f.token).join(',');
    return await fetchJSON(`https://api.coingecko.com/api/v3/simple/price?ids=${ids}&vs_currencies=usd&include_24hr_change=true&include_market_cap=true`);
  } catch (e) { console.error('❌ Price fetch error:', e.message); return null; }
}

// Gemini AI Summary
async function generateSummary(forumId, forumName, topics) {
  if (!GEMINI_API_KEY) return null;
  
  const now = Date.now();
  const recent = topics.filter(t => now - new Date(t.last_posted_at).getTime() < 24 * 60 * 60 * 1000);
  
  if (recent.length === 0) return { text: 'Žádná aktivita za posledních 24 hodin.', topics: 0, generated: new Date().toISOString() };
  
  const topicList = recent.slice(0, 10).map(t => `${t.title} (${t.posts_count} posts)`).join('. ');
  
  const prompt = `Shrň aktivitu na krypto fóru ${forumName}. Témata: ${topicList}. Napiš 2-3 věty česky o governance návrzích, updatech nebo rizicích. Buď stručný.`;

  try {
    const result = await postJSON(
      `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`,
      { contents: [{ parts: [{ text: prompt }] }] }
    );
    
    if (result.status !== 200) {
      console.error(`❌ Gemini API error for ${forumId}: HTTP ${result.status}`);
      return { text: 'API dočasně nedostupné.', topics: recent.length, generated: new Date().toISOString() };
    }
    
    const response = JSON.parse(result.body);
    const text = response.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) {
      console.error(`❌ Gemini empty response for ${forumId}:`, result.body.substring(0, 200));
      return { text: 'Nepodařilo se vygenerovat shrnutí.', topics: recent.length, generated: new Date().toISOString() };
    }
    return { text: text.trim(), topics: recent.length, generated: new Date().toISOString() };
  } catch (e) {
    console.error(`❌ Gemini error for ${forumId}:`, e.message);
    return { text: 'Chyba při generování shrnutí.', topics: recent.length, generated: new Date().toISOString() };
  }
}

async function generateAllSummaries(state) {
  console.log('🤖 Generating AI summaries...');
  const summaries = {};
  
  for (const [id, forum] of Object.entries(FORUMS)) {
    const forumState = state.forums[id];
    if (!forumState?.topics) continue;
    
    const topics = Object.values(forumState.topics);
    const summary = await generateSummary(id, forum.name, topics);
    if (summary) {
      summaries[id] = summary;
      console.log(`  ${forum.icon} ${forum.name}: ${summary.topics} topics summarized`);
    }
    await sleep(500);
  }
  
  return summaries;
}

// Nansen Token God Mode
async function fetchNansenData(tokenId, tokenConfig) {
  if (!NANSEN_API_KEY) return null;
  
  const today = new Date().toISOString().split('T')[0];
  const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().split('T')[0];
  
  const result = { sells: [], transfers: [], updated: new Date().toISOString() };
  
  try {
    // Fetch top sells (DEX trades)
    const sellsResp = await postJSON(
      'https://api.nansen.ai/api/beta/api/v1/tgm/dex-trades',
      {
        token_address: tokenConfig.address,
        chain: tokenConfig.chain,
        date: { from: yesterday, to: today },
        filters: { action: 'SELL' },
        pagination: { limit: 10 }
      },
      { apiKey: NANSEN_API_KEY }
    );
    
    if (sellsResp.status === 200) {
      const data = JSON.parse(sellsResp.body);
      // Sort by value and take top 3
      const sells = (data.data || data || [])
        .sort((a, b) => (b.estimated_value_usd || 0) - (a.estimated_value_usd || 0))
        .slice(0, 3)
        .map(s => ({
          address: s.trader_address,
          label: s.trader_address_label || null,
          amount: s.token_amount,
          value_usd: s.estimated_value_usd,
          tx_hash: s.transaction_hash,
          timestamp: s.block_timestamp
        }));
      result.sells = sells;
    }
    
    await sleep(300);
    
    // Fetch top transfers
    const transfersResp = await postJSON(
      'https://api.nansen.ai/api/beta/api/v1/tgm/transfers',
      {
        token_address: tokenConfig.address,
        chain: tokenConfig.chain,
        date: { from: yesterday, to: today },
        pagination: { limit: 10 }
      },
      { apiKey: NANSEN_API_KEY }
    );
    
    if (transfersResp.status === 200) {
      const data = JSON.parse(transfersResp.body);
      // Sort by value and take top 3
      const transfers = (data.data || data || [])
        .sort((a, b) => (b.transfer_value_usd || 0) - (a.transfer_value_usd || 0))
        .slice(0, 3)
        .map(t => ({
          from_address: t.from_address,
          from_label: t.from_address_label || null,
          to_address: t.to_address,
          to_label: t.to_address_label || null,
          amount: t.transfer_amount,
          value_usd: t.transfer_value_usd,
          tx_hash: t.transaction_hash,
          timestamp: t.block_timestamp
        }));
      result.transfers = transfers;
    }
    
    return result;
  } catch (e) {
    console.error(`❌ Nansen error for ${tokenId}:`, e.message);
    return null;
  }
}

async function fetchAllNansenData() {
  console.log('📊 Fetching Nansen data...');
  const nansenData = {};
  
  for (const [id, config] of Object.entries(TOKEN_ADDRESSES)) {
    const data = await fetchNansenData(id, config);
    if (data) {
      nansenData[id] = data;
      console.log(`  ${FORUMS[id]?.icon || '•'} ${id}: ${data.sells.length} sells, ${data.transfers.length} transfers`);
    }
    await sleep(500);
  }
  
  return nansenData;
}

// Snapshot Governance Proposals
async function fetchSnapshotProposals(spaceId) {
  const query = `{
    proposals(first: 5, where: {space: "${spaceId}", state: "active"}, orderBy: "end", orderDirection: "asc") {
      id
      title
      state
      end
      choices
      scores
      scores_total
      link
    }
  }`;
  
  try {
    const result = await postJSON('https://hub.snapshot.org/graphql', { query });
    if (result.status === 200) {
      const data = JSON.parse(result.body);
      return (data.data?.proposals || []).map(p => ({
        id: p.id,
        title: p.title,
        end: p.end,
        choices: p.choices,
        scores: p.scores,
        scores_total: p.scores_total,
        link: p.link || `https://snapshot.org/#/${spaceId}/proposal/${p.id}`
      }));
    }
    return [];
  } catch (e) {
    console.error(`❌ Snapshot error for ${spaceId}:`, e.message);
    return [];
  }
}

async function fetchAllSnapshotData() {
  console.log('🗳️ Fetching Snapshot proposals...');
  const snapshotData = {};
  
  for (const [id, spaceId] of Object.entries(SNAPSHOT_SPACES)) {
    const proposals = await fetchSnapshotProposals(spaceId);
    snapshotData[id] = { proposals, updated: new Date().toISOString() };
    if (proposals.length > 0) {
      console.log(`  ${FORUMS[id]?.icon || '•'} ${id}: ${proposals.length} active votes`);
    }
    await sleep(300);
  }
  
  return snapshotData;
}

async function checkRefreshRequested() {
  try {
    const res = await new Promise((resolve, reject) => {
      http.get(DASHBOARD_REFRESH_URL, (r) => {
        let data = '';
        r.on('data', chunk => data += chunk);
        r.on('end', () => {
          try { resolve(JSON.parse(data)); }
          catch (e) { reject(e); }
        });
      }).on('error', reject);
    });
    return res.refreshRequested || false;
  } catch (e) { return false; }
}

async function checkAll() {
  const now = new Date();
  console.log(`\n🔍 [${now.toLocaleTimeString('cs-CZ')}] Checking forums...`);
  
  const state = loadState();
  const isFirstRun = !state.lastCheck;
  const newTopics = [], updatedTopics = [];
  
  // Check for manual refresh request
  const refreshRequested = await checkRefreshRequested();
  if (refreshRequested) {
    console.log('🔄 Manual refresh requested - will regenerate AI summaries and Nansen data');
    state.lastSummary = null;
    state.lastNansen = null;
  }

  // Fetch all forums (skip those without apiUrl like wNXM)
  for (const [id, forum] of Object.entries(FORUMS)) {
    if (!forum.apiUrl) continue; // Skip tokens without forums
    try {
      const data = await fetchJSON(forum.apiUrl);
      const topics = (data.topic_list?.topics || []).slice(0, 30).map(t => ({
        id: t.id, title: t.title, slug: t.slug, posts_count: t.posts_count, views: t.views || 0,
        like_count: t.like_count || 0, last_posted_at: t.last_posted_at, last_poster: t.last_poster_username
      }));

      const prevTopics = state.forums[id]?.topics || {};
      for (const topic of topics) {
        const prev = prevTopics[topic.id];
        if (!prev && !isFirstRun) {
          newTopics.push({ ...topic, forumId: id, forum });
          state.activity.unshift({ type: 'new', forumId: id, title: topic.title, slug: topic.slug, topicId: topic.id, time: now.toISOString() });
        } else if (prev && prev.posts_count < topic.posts_count) {
          updatedTopics.push({ ...topic, forumId: id, forum, newPosts: topic.posts_count - prev.posts_count });
          state.activity.unshift({ type: 'update', forumId: id, title: topic.title, slug: topic.slug, topicId: topic.id, newPosts: topic.posts_count - prev.posts_count, time: now.toISOString() });
        }
      }

      const topicsMap = {}; topics.forEach(t => topicsMap[t.id] = t);
      state.forums[id] = { topics: topicsMap, sentiment: calculateForumSentiment(topics), lastCheck: now.toISOString() };
    } catch (e) { console.error(`❌ ${forum.name}:`, e.message); }
    await sleep(200);
  }

  // Fetch prices
  const prices = await fetchPrices();
  if (prices) state.prices = { timestamp: now.toISOString(), data: prices };

  // Generate summaries every hour
  const lastSummaryTime = state.lastSummary ? new Date(state.lastSummary).getTime() : 0;
  if (now.getTime() - lastSummaryTime > SUMMARY_INTERVAL || !state.lastSummary) {
    state.summaries = await generateAllSummaries(state);
    state.lastSummary = now.toISOString();
  }

  // Fetch Nansen data every 10 minutes
  const lastNansenTime = state.lastNansen ? new Date(state.lastNansen).getTime() : 0;
  if (now.getTime() - lastNansenTime > NANSEN_INTERVAL || !state.lastNansen) {
    state.nansen = await fetchAllNansenData();
    state.lastNansen = now.toISOString();
  }

  // Fetch Snapshot proposals every 5 minutes
  const SNAPSHOT_INTERVAL = 5 * 60 * 1000;
  const lastSnapshotTime = state.lastSnapshot ? new Date(state.lastSnapshot).getTime() : 0;
  if (now.getTime() - lastSnapshotTime > SNAPSHOT_INTERVAL || !state.lastSnapshot) {
    state.snapshot = await fetchAllSnapshotData();
    state.lastSnapshot = now.toISOString();
  }

  state.lastCheck = now.toISOString();
  state.activity = (state.activity || []).slice(0, 100);
  saveState(state);

  // Log status
  console.log('📊 Status:');
  for (const [id, forum] of Object.entries(FORUMS)) {
    const f = state.forums[id];
    const p = prices?.[forum.token];
    const topicCount = Object.keys(f?.topics || {}).length;
    const snapshotVotes = state.snapshot?.[id]?.proposals?.length || 0;
    if (forum.apiUrl) {
      console.log(`  ${forum.icon} ${forum.name}: ${topicCount} topics | ${f?.sentiment?.mood || '?'} | ${p?.usd?.toFixed(3) || '?'} (${p?.usd_24h_change?.toFixed(1) || '?'}%)${snapshotVotes ? ` | 🗳️${snapshotVotes}` : ''}`);
    } else {
      console.log(`  ${forum.icon} ${forum.name}: ${p?.usd?.toFixed(3) || '?'} (${p?.usd_24h_change?.toFixed(1) || '?'}%)`);
    }
  }

  // Push to dashboard
  try {
    const pushData = { 
      forums: state.forums, 
      prices: state.prices, 
      activity: state.activity, 
      summaries: state.summaries, 
      nansen: state.nansen,
      snapshot: state.snapshot,
      lastCheck: state.lastCheck, 
      lastSummary: state.lastSummary,
      lastNansen: state.lastNansen,
      lastSnapshot: state.lastSnapshot,
      geminiModel: GEMINI_MODEL
    };
    const result = await postJSON(DASHBOARD_URL, pushData, { 'X-API-Key': API_KEY });
    console.log(`📤 Dashboard: ${result.status === 200 ? '✅' : '❌ ' + result.status}`);
  } catch (e) { console.log(`📤 Push failed: ${e.message}`); }

  // Telegram notifications
  if (newTopics.length || updatedTopics.length) {
    console.log(`📢 ${newTopics.length} new, ${updatedTopics.length} updated`);
    for (const t of newTopics.slice(0, 3)) {
      await sendTelegram(`🆕 <b>${t.forum.name}</b>\n\n<b>${t.title}</b>\n\n🔗 ${t.forum.url}/t/${t.slug}/${t.id}`);
      await sleep(300);
    }
  } else { console.log('✅ No changes'); }

  // Price alerts (>5%)
  if (prices) {
    for (const [id, forum] of Object.entries(FORUMS)) {
      const change = prices[forum.token]?.usd_24h_change;
      if (Math.abs(change) > 5) console.log(`${change > 0 ? '🚀' : '📉'} ${forum.symbol} ${change > 0 ? '+' : ''}${change.toFixed(1)}%`);
    }
  }
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

console.log('🚀 Multi-Forum Monitor with AI + Nansen');
console.log('📡 Forums:', Object.values(FORUMS).map(f => f.name).join(', '));
console.log('💰 Tokens:', Object.values(FORUMS).map(f => f.symbol).join(', '));
console.log(`🤖 Gemini: ${GEMINI_API_KEY ? 'ON' : 'OFF'}`);
console.log(`📊 Nansen: ${NANSEN_API_KEY ? 'ON' : 'OFF'}`);
console.log(`📈 Dashboard: ${DASHBOARD_URL}`);
console.log(`📱 Telegram: ${TELEGRAM_BOT_TOKEN ? 'ON' : 'OFF'}`);

checkAll();
setInterval(checkAll, CHECK_INTERVAL);
process.on('SIGINT', () => { console.log('\n👋 Bye'); process.exit(0); });
