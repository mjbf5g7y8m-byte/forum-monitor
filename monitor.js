#!/usr/bin/env node
/**
 * Multi-Forum Monitor with Gemini AI + Nansen Token Data
 * Sleduje Gnosis, COW, Safe, StakeWise + ceny + AI summary + Nansen transfers/trades
 */

const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright-core');
const Browserbase = require('@browserbasehq/sdk').default;

// ========== BROWSERBASE CLIENT ==========
const BROWSERBASE_API_KEY = process.env.BROWSERBASE_API_KEY;
const BROWSERBASE_PROJECT_ID = process.env.BROWSERBASE_PROJECT_ID;

let browserbaseClient = null;
let browserbaseSession = null;
let browserbaseBrowser = null;
let browserbasePage = null;

async function initBrowserbase() {
  if (!BROWSERBASE_API_KEY || !BROWSERBASE_PROJECT_ID) {
    console.log('⚠️ Browserbase credentials not configured');
    return false;
  }
  
  try {
    browserbaseClient = new Browserbase({ apiKey: BROWSERBASE_API_KEY });
    console.log('✅ Browserbase client initialized');
    return true;
  } catch (e) {
    console.error('❌ Browserbase init error:', e.message);
    return false;
  }
}

async function createBrowserbaseSession() {
  if (!browserbaseClient) {
    await initBrowserbase();
  }
  
  if (!browserbaseClient) return null;
  
  try {
    // Create new session
    browserbaseSession = await browserbaseClient.sessions.create({
      projectId: BROWSERBASE_PROJECT_ID,
      browserSettings: {
        fingerprint: { devices: ['desktop'], locales: ['en-US'], operatingSystems: ['macos'] }
      }
    });
    
    // Connect browser
    browserbaseBrowser = await chromium.connectOverCDP(browserbaseSession.connectUrl);
    const context = browserbaseBrowser.contexts()[0];
    browserbasePage = context.pages()[0] || await context.newPage();
    
    console.log(`    🌐 Browserbase session: ${browserbaseSession.id}`);
    return browserbasePage;
  } catch (e) {
    console.error('    ❌ Browserbase session error:', e.message);
    return null;
  }
}

async function closeBrowserbaseSession() {
  try {
    if (browserbasePage) await browserbasePage.close().catch(() => {});
    if (browserbaseBrowser) await browserbaseBrowser.close().catch(() => {});
    if (browserbaseSession && browserbaseClient) {
      await browserbaseClient.sessions.update(browserbaseSession.id, { status: 'REQUEST_RELEASE' }).catch(() => {});
    }
    browserbasePage = null;
    browserbaseBrowser = null;
    browserbaseSession = null;
  } catch (e) {}
}

// Fetch page content using Browserbase
async function fetchWithBrowserbase(url, options = {}) {
  const page = await createBrowserbaseSession();
  if (!page) {
    console.log(`    ⚠️ Browserbase unavailable, falling back to HTTP`);
    return fetchHTML(url);
  }
  
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
    
    // Wait for content to load
    if (options.waitFor) {
      await page.waitForSelector(options.waitFor, { timeout: 10000 }).catch(() => {});
    } else {
      await page.waitForTimeout(2000);
    }
    
    const html = await page.content();
    await closeBrowserbaseSession();
    return html;
  } catch (e) {
    console.log(`    ⚠️ Browserbase fetch error: ${e.message}`);
    await closeBrowserbaseSession();
    return fetchHTML(url); // Fallback
  }
}

// Login to a site using Browserbase
async function loginWithBrowserbase(url, credentials, selectors) {
  const page = await createBrowserbaseSession();
  if (!page) return null;
  
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
    
    // Fill credentials
    if (selectors.email) {
      await page.fill(selectors.email, credentials.email);
    }
    if (selectors.password) {
      await page.fill(selectors.password, credentials.password);
    }
    if (selectors.submit) {
      await page.click(selectors.submit);
      await page.waitForNavigation({ timeout: 15000 }).catch(() => {});
    }
    
    return page; // Return page for further use
  } catch (e) {
    console.log(`    ⚠️ Browserbase login error: ${e.message}`);
    await closeBrowserbaseSession();
    return null;
  }
}

// Scrape data from a page using Browserbase
async function scrapeWithBrowserbase(url, extractFn, options = {}) {
  const page = await createBrowserbaseSession();
  if (!page) return null;
  
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
    
    if (options.waitFor) {
      await page.waitForSelector(options.waitFor, { timeout: options.timeout || 15000 }).catch(() => {});
    }
    // Always wait a bit for dynamic content
    await page.waitForTimeout(5000);
    
    // Execute extraction function in browser context
    const data = await page.evaluate(extractFn);
    await closeBrowserbaseSession();
    return data;
  } catch (e) {
    console.log(`    ⚠️ Browserbase scrape error: ${e.message}`);
    await closeBrowserbaseSession();
    return null;
  }
}

const STATE_FILE = path.join(__dirname, '.forum-monitor-state.json');
const CHECK_INTERVAL = 60 * 1000;
const SUMMARY_INTERVAL = 60 * 60 * 1000; // 1 hodina
const NANSEN_INTERVAL = 10 * 60 * 1000;  // 10 minut
const DASHBOARD_URL = 'http://localhost:3000/api/push';
const DASHBOARD_REFRESH_URL = 'http://localhost:3000/api/check-refresh';
const API_KEY = 'gnosis-monitor-key-2026';
const GEMINI_API_KEY = process.env.gemini;
const GEMINI_MODEL = 'gemini-2.0-flash'; // Rychlý model pro všechny operace
const GEMINI_PRO_MODEL = 'gemini-2.0-flash'; // Používáme stejný rychlý model
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
const ETHERSCAN_API_KEY = process.env.ETHERSCAN_API_KEY;
const DUNE_API_KEY = process.env.DUNE_API_KEY;
const INFURA_API_KEY = process.env.INFURA_API_KEY;

// Liquity V2 (Bold) Contract Addresses (Mainnet)
// Source: https://docs.liquity.org/v2-documentation/technical-resources
const LIQUITY_V2_CONTRACTS = {
  // CollateralRegistry - handles all redemptions across collateral types
  // Verified on Etherscan: https://etherscan.io/address/0xf949982B91C8c61e952B3bA942cbbfaef5386684
  collateralRegistry: '0xf949982B91C8c61e952B3bA942cbbfaef5386684'
};

// XTB Morning Commentary Config
const XTB_PLAYLIST_ID = 'PL0vgIgxC16y9uFiqIjIAzfYKQYIePJzBp'; // Ranní komentář XTB playlist
const XTB_CHECK_INTERVAL = 60 * 60 * 1000; // 1 hodina

// Fisher Investments / Ken Fisher Config
const FISHER_CHANNEL_ID = 'UCSzEl_17ueZesYmYVZqJq_w'; // @fisherinvestments
const FISHER_CHECK_INTERVAL = 4 * 60 * 60 * 1000; // 4 hodiny
const FISHER_MAX_VIDEOS = 3; // Analyzovat posledních 3 videa

// Watchlist stocks
const WATCHLIST_STOCKS = ['GOOGL', 'BRK.B', 'ASML', 'AMD', 'META', 'ADBE', 'UBER', 'JD'];
const WATCHLIST_CHECK_INTERVAL = 4 * 60 * 60 * 1000; // 4 hodiny

// Stooq - Free stock data (no credentials needed)
const GURUFOCUS_EMAIL = process.env.GURUFOCUS_EMAIL;
const GURUFOCUS_PASSWORD = process.env.GURUFOCUS_PASSWORD;

// Liquity Position Tracker
const LIQUITY_SAFE_ADDRESS = '0x66a7b66d7E823155660bDc6b83bEaaa11098Ea89'.toLowerCase();
const LIQUITY_CHECK_INTERVAL = 2 * 60 * 1000; // 2 minuty - časté kontroly
const LIQUITY_ALERT_THRESHOLD = 30_000_000; // 30M debt in front = problém
const LIQUITY_DEFISAVER_URL = `https://app.defisaver.com/liquityV2/smart-wallet/wsteth/manage?trackAddress=${LIQUITY_SAFE_ADDRESS}&chainId=1`;

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
  gnosis: { name: 'Gnosis', url: 'https://forum.gnosis.io', apiUrl: 'https://forum.gnosis.io/latest.json', token: 'gnosis', symbol: 'GNO', icon: '🦉', 
    // Note: Gnosis forum blocks datacenter IPs, using backup sources
    backupApiUrl: 'https://api.thegraph.com/subgraphs/name/gnosis/gnosis-safe' 
  },
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

function fetchJSON(url, retryWithProxy = true) {
  return new Promise((resolve, reject) => {
    const proto = url.startsWith('https') ? https : http;
    proto.get(url, { 
      headers: { 
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'application/json, text/plain, */*',
        'Accept-Language': 'en-US,en;q=0.9'
      } 
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => { 
        // Check for 403/blocked response
        if (res.statusCode === 403 || data.includes('403 Forbidden')) {
          if (retryWithProxy) {
            // Try with a different approach - fetch via allorigins proxy
            fetchJSONViaProxy(url).then(resolve).catch(reject);
          } else {
            reject(new Error('403 Forbidden'));
          }
          return;
        }
        try { 
          resolve(JSON.parse(data)); 
        } catch (e) { 
          reject(new Error('Invalid JSON')); 
        } 
      });
    }).on('error', reject);
  });
}

// Fallback to fetch via public CORS proxy for blocked sites
function fetchJSONViaProxy(url) {
  return new Promise((resolve, reject) => {
    // Try multiple proxies
    const proxies = [
      `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(url)}`,
      `https://thingproxy.freeboard.io/fetch/${url}`,
    ];
    
    const tryProxy = (index) => {
      if (index >= proxies.length) {
        reject(new Error('All proxies failed'));
        return;
      }
      
      https.get(proxies[index], { 
        headers: { 'User-Agent': 'Mozilla/5.0' },
        timeout: 10000
      }, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          try {
            // Some proxies wrap the response, others don't
            let parsed;
            if (data.startsWith('{') || data.startsWith('[')) {
              parsed = JSON.parse(data);
            } else {
              // Try to extract JSON from proxy response
              const match = data.match(/\{[\s\S]*\}/);
              if (match) {
                parsed = JSON.parse(match[0]);
              }
            }
            
            if (parsed && (parsed.topic_list || parsed.users)) {
              resolve(parsed);
            } else {
              tryProxy(index + 1);
            }
          } catch (e) {
            tryProxy(index + 1);
          }
        });
      }).on('error', () => tryProxy(index + 1))
        .on('timeout', () => tryProxy(index + 1));
    };
    
    tryProxy(0);
  });
}

// Get Gnosis governance activity from Snapshot (fallback when forum is blocked)
async function fetchGnosisFromSnapshot() {
  try {
    const query = `{
      proposals(first: 20, where: {space: "gnosis.eth"}, orderBy: "created", orderDirection: desc) {
        id
        title
        state
        created
        end
        votes
        scores_total
        author
        body
      }
    }`;
    
    const response = await postJSON('https://hub.snapshot.org/graphql', { query });
    if (response.status === 200) {
      const data = JSON.parse(response.body);
      return data.data?.proposals || [];
    }
  } catch (e) {
    console.error('Gnosis Snapshot fetch error:', e.message);
  }
  return [];
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
    const isSnapshot = forumState.source === 'snapshot';
    
    // For Snapshot data, use a different summary approach
    let summary;
    if (isSnapshot) {
      summary = await generateSnapshotSummary(id, forum.name, topics);
    } else {
      summary = await generateSummary(id, forum.name, topics);
    }
    
    if (summary) {
      summaries[id] = summary;
      console.log(`  ${forum.icon} ${forum.name}: ${summary.topics} topics summarized`);
    }
    await sleep(500);
  }
  
  return summaries;
}

// Generate summary for Snapshot governance data
async function generateSnapshotSummary(forumId, forumName, proposals) {
  if (!GEMINI_API_KEY) return null;
  
  if (proposals.length === 0) {
    return { text: 'Žádné governance návrhy.', topics: 0, generated: new Date().toISOString() };
  }
  
  // Get active and recent proposals
  const active = proposals.filter(p => p.state === 'active');
  const recent = proposals.slice(0, 10);
  
  const proposalList = recent.map(p => {
    const state = p.state === 'active' ? '🟢 AKTIVNÍ' : p.state === 'closed' ? '✓ uzavřeno' : p.state;
    return `${p.title} (${state}, ${p.posts_count || 0} hlasů)`;
  }).join('. ');
  
  const prompt = `Shrň governance aktivitu na ${forumName} (Snapshot hlasování). Návrhy: ${proposalList}. 
Napiš 2-3 věty česky. Zaměř se na: aktivní hlasování, důležité návrhy, trendy. Pokud jsou aktivní hlasování, zdůrazni je.`;

  try {
    const result = await postJSON(
      `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`,
      { contents: [{ parts: [{ text: prompt }] }] }
    );
    
    if (result.status !== 200) {
      console.error(`❌ Gemini API error for ${forumId}: HTTP ${result.status}`);
      return { text: 'API dočasně nedostupné.', topics: proposals.length, generated: new Date().toISOString() };
    }
    
    const response = JSON.parse(result.body);
    const text = response.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) {
      return { text: 'Nepodařilo se vygenerovat shrnutí.', topics: proposals.length, generated: new Date().toISOString() };
    }
    return { 
      text: text.trim(), 
      topics: proposals.length, 
      active: active.length,
      source: 'snapshot',
      generated: new Date().toISOString() 
    };
  } catch (e) {
    console.error(`❌ Gemini error for ${forumId}:`, e.message);
    return { text: 'Chyba při generování shrnutí.', topics: proposals.length, generated: new Date().toISOString() };
  }
}

// Token Transfers via Etherscan API
async function fetchTokenTransfers(tokenId, tokenConfig) {
  if (!ETHERSCAN_API_KEY) return null;
  
  const result = { sells: [], buys: [], transfers: [], updated: new Date().toISOString() };
  
  try {
    // Fetch token transfers from Etherscan
    const url = `https://api.etherscan.io/v2/api?chainid=1&module=account&action=tokentx&contractaddress=${tokenConfig.address}&page=1&offset=50&sort=desc&apikey=${ETHERSCAN_API_KEY}`;
    
    const response = await new Promise((resolve, reject) => {
      https.get(url, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          try {
            resolve({ status: res.statusCode, body: data });
          } catch (e) {
            reject(e);
          }
        });
      }).on('error', reject);
    });
    
    if (response.status !== 200) {
      console.log(`  ⚠️ Etherscan error for ${tokenId}: ${response.status}`);
      return result;
    }
    
    const data = JSON.parse(response.body);
    if (data.status !== '1' || !data.result || !Array.isArray(data.result)) {
      return result;
    }
    
    const transfers = data.result;
    const currentPrice = await getTokenPrice(tokenConfig.address);
    
    // Known addresses for classification
    const dexRouters = [
      '0x7a250d5630b4cf539739df2c5dacb4c659f2488d', // Uniswap V2
      '0xe592427a0aece92de3edee1f18e0157c05861564', // Uniswap V3
      '0x68b3465833fb72a70ecdf485e0e4c7bd8665fc45', // Uniswap Universal
      '0xdef1c0ded9bec7f1a1670819833240f027b25eff', // 0x Exchange
      '0x1111111254eeb25477b68fb85ed929f73a960582', // 1inch V5
      '0x881d40237659c251811cec9c364ef91dc08d300c', // Metamask Swap
      '0x3328f7f4a1d1c57c35df56bbf0c9dcafca309c49', // Banana Gun
      '0x80a64c6d7f12c47b7c66c5b4e20e72bc1fcd5d9e', // Maestro
      '0x6131b5fae19ea4f9d964eac0408e4408b66337b5', // Kyber
      '0xd9e1ce17f2641f24ae83637ab66a2cca9c378b9f', // SushiSwap
      '0x3fc91a3afd70395cd496c647d5a6cc9d4b2b7fad', // Uniswap Universal Router 2
    ].map(a => a.toLowerCase());
    
    // Major exchanges (tokens TO exchange = sell, FROM exchange = buy)
    const exchanges = [
      '0x28c6c06298d514db089934071355e5743bf21d60', // Binance 14
      '0x21a31ee1afc51d94c2efccaa2092ad1028285549', // Binance 15
      '0xdfd5293d8e347dfe59e90efd55b2956a1343963d', // Binance 16
      '0x56eddb7aa87536c09ccc2793473599fd21a8b17f', // Binance 17
      '0x9696f59e4d72e237be84ffd425dcad154bf96976', // Binance 18
      '0x4976a4a02f38326660d17bf34b431dc6e2eb2327', // Binance 19
      '0xf89d7b9c864f589bbf53a82105107622b35eaa40', // Bybit
      '0x1ab4973a48dc892cd9971ece8e01dcc7688f8f23', // Coinbase 2
      '0x71660c4005ba85c37ccec55d0c4493e66fe775d3', // Coinbase 3
      '0xa9d1e08c7793af67e9d92fe308d5697fb81d3e43', // Coinbase 10
      '0x503828976d22510aad0201ac7ec88293211d23da', // Coinbase Prime
      '0xeb2629a2734e272bcc07bda959863f316f4bd4cf', // Kraken
      '0x2910543af39aba0cd09dbb2d50200b3e800a63d2', // Kraken 13
      '0xae2d4617c862309a3d75a0ffb358c7a5009c673f', // Kraken 14
    ].map(a => a.toLowerCase());
    
    // Process transfers
    const allTransfers = transfers.map(tx => {
      const amount = parseFloat(tx.value) / Math.pow(10, parseInt(tx.tokenDecimal) || 18);
      const value_usd = currentPrice ? amount * currentPrice : null;
      const fromLower = tx.from.toLowerCase();
      const toLower = tx.to.toLowerCase();
      
      // Detect trade type based on DEX or exchange involvement
      const isDexTrade = dexRouters.includes(fromLower) || dexRouters.includes(toLower);
      const isExchangeTrade = exchanges.includes(fromLower) || exchanges.includes(toLower);
      let tradeType = 'transfer';
      
      if (isDexTrade) {
        // If tokens come FROM a DEX router, someone bought
        // If tokens go TO a DEX router, someone sold
        if (dexRouters.includes(fromLower)) {
          tradeType = 'buy';
        } else if (dexRouters.includes(toLower)) {
          tradeType = 'sell';
        }
      } else if (isExchangeTrade) {
        // If tokens go TO an exchange, someone is selling (depositing to sell)
        // If tokens come FROM an exchange, someone bought (withdrawing)
        if (exchanges.includes(toLower)) {
          tradeType = 'sell';
        } else if (exchanges.includes(fromLower)) {
          tradeType = 'buy';
        }
      }
      
      return {
        from_address: tx.from,
        to_address: tx.to,
        amount: amount,
        value_usd: value_usd,
        tx_hash: tx.hash,
        timestamp: new Date(parseInt(tx.timeStamp) * 1000).toISOString(),
        tradeType: tradeType
      };
    });
    
    // Sort by value and categorize
    const sorted = allTransfers.sort((a, b) => (b.value_usd || 0) - (a.value_usd || 0));
    
    // Get top 3 of each type
    result.sells = sorted
      .filter(t => t.tradeType === 'sell')
      .slice(0, 3)
      .map(s => ({
        address: s.from_address,
        label: null,
        amount: s.amount,
        value_usd: s.value_usd,
        tx_hash: s.tx_hash,
        timestamp: s.timestamp
      }));
    
    result.buys = sorted
      .filter(t => t.tradeType === 'buy')
      .slice(0, 3)
      .map(b => ({
        address: b.to_address,
        label: null,
        amount: b.amount,
        value_usd: b.value_usd,
        tx_hash: b.tx_hash,
        timestamp: b.timestamp
      }));
    
    result.transfers = sorted
      .filter(t => t.tradeType === 'transfer')
      .slice(0, 3)
      .map(t => ({
        from_address: t.from_address,
        from_label: null,
        to_address: t.to_address,
        to_label: null,
        amount: t.amount,
        value_usd: t.value_usd,
        tx_hash: t.tx_hash,
        timestamp: t.timestamp
      }));
    
    return result;
  } catch (e) {
    console.error(`❌ Etherscan error for ${tokenId}:`, e.message);
    return null;
  }
}

// Get token price from CoinGecko
async function getTokenPrice(contractAddress) {
  try {
    const url = `https://api.coingecko.com/api/v3/simple/token_price/ethereum?contract_addresses=${contractAddress}&vs_currencies=usd`;
    const response = await new Promise((resolve, reject) => {
      https.get(url, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => resolve({ status: res.statusCode, body: data }));
      }).on('error', reject);
    });
    
    if (response.status === 200) {
      const data = JSON.parse(response.body);
      const price = data[contractAddress.toLowerCase()]?.usd;
      return price || null;
    }
  } catch (e) {
    // Silently fail - price is optional
  }
  return null;
}

async function fetchAllTokenData() {
  console.log('📊 Fetching token transfers (Etherscan)...');
  const tokenData = {};
  
  for (const [id, config] of Object.entries(TOKEN_ADDRESSES)) {
    const data = await fetchTokenTransfers(id, config);
    if (data) {
      tokenData[id] = data;
      console.log(`  ${FORUMS[id]?.icon || '•'} ${id}: ${data.sells.length} sells, ${data.buys.length} buys, ${data.transfers.length} transfers`);
    }
    await sleep(300); // Rate limit for Etherscan
  }
  
  return tokenData;
}

// Snapshot Governance Proposals
async function fetchSnapshotProposals(spaceId) {
  const query = `{
    proposals(first: 5, where: {space: "${spaceId}", state: "active"}, orderBy: "end", orderDirection: asc) {
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

// ========== XTB RANNÍ KOMENTÁŘ ==========

// Simple HTTP fetch (for APIs, RSS feeds, etc.)
function fetchHTMLSimple(url) {
  return new Promise((resolve, reject) => {
    const proto = url.startsWith('https') ? https : http;
    proto.get(url, { headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36' } }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve(data));
    }).on('error', reject);
  });
}

// Smart fetch - uses Browserbase for JS-heavy pages, simple HTTP for APIs/RSS
async function fetchHTML(url, options = {}) {
  // These patterns don't need Browserbase (APIs, RSS, XML, simple pages)
  const simplePatterns = [
    '/feeds/', '/api/', '/rss', '.xml', '.json', 'api.coingecko', 'api.etherscan',
    'snapshot.org', 'timedotcom.files', 'stooq.com', '/oembed', 'dune.com/api',
    'generativelanguage.googleapis.com', 'infura.io'
  ];
  
  // These patterns ALWAYS need Browserbase (JS-rendered pages)
  const browserbasePatterns = [
    'youtube.com/watch', 'youtube.com/results', 'finance.yahoo.com',
    'seekingalpha.com', 'gurufocus.com', 'tradingview.com', 'investing.com'
  ];
  
  const forceBrowserbase = browserbasePatterns.some(p => url.includes(p));
  const isSimple = simplePatterns.some(p => url.includes(p));
  
  if ((forceBrowserbase || !isSimple) && BROWSERBASE_API_KEY && BROWSERBASE_PROJECT_ID) {
    // Use Browserbase for JS-rendered pages
    return fetchWithBrowserbase(url, options);
  }
  
  // Simple HTTP for APIs and RSS
  return fetchHTMLSimple(url);
}

async function fetchLatestXTBVideo() {
  try {
    // Try playlist RSS feed first
    const rssUrl = `https://www.youtube.com/feeds/videos.xml?playlist_id=${XTB_PLAYLIST_ID}`;
    let rss = '';
    try {
      rss = await fetchHTML(rssUrl);
    } catch (e) {
      console.log('  ⚠️ Playlist RSS failed, trying alternative...');
    }
    
    if (rss && rss.includes('<entry>')) {
      const entries = rss.match(/<entry>[\s\S]*?<\/entry>/g) || [];
      
      // Get the first (latest) video from playlist
      if (entries.length > 0) {
        const entry = entries[0];
        const titleMatch = entry.match(/<title>([^<]+)<\/title>/);
        const videoIdMatch = entry.match(/<yt:videoId>([^<]+)<\/yt:videoId>/);
        const publishedMatch = entry.match(/<published>([^<]+)<\/published>/);
        
        if (titleMatch && videoIdMatch) {
          return { 
            videoId: videoIdMatch[1], 
            title: titleMatch[1], 
            published: publishedMatch ? publishedMatch[1] : new Date().toISOString(),
            url: `https://www.youtube.com/watch?v=${videoIdMatch[1]}`
          };
        }
      }
    }
    
    // Fallback: Search for recent XTB video via oembed
    const searchTerms = ['ranní+komentář+XTB', 'XTB+shrnutí+trhy'];
    for (const term of searchTerms) {
      try {
        const searchUrl = `https://www.youtube.com/results?search_query=${term}&sp=EgIIAQ%253D%253D`; // Last hour filter
        const html = await fetchHTML(searchUrl);
        const videoMatch = html.match(/"videoId":"([a-zA-Z0-9_-]{11})"/);
        if (videoMatch) {
          const videoId = videoMatch[1];
          // Get video title via oembed
          const oembedUrl = `https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${videoId}&format=json`;
          try {
            const oembed = await fetchJSON(oembedUrl);
            if (oembed.title && (oembed.title.toLowerCase().includes('ranní') || oembed.title.toLowerCase().includes('xtb'))) {
              return {
                videoId,
                title: oembed.title,
                published: new Date().toISOString(),
                url: `https://www.youtube.com/watch?v=${videoId}`
              };
            }
          } catch (e) {}
        }
      } catch (e) {}
    }
    
    return null;
  } catch (e) {
    console.error('❌ XTB video fetch error:', e.message);
    return null;
  }
}

async function fetchYouTubeVideoInfo(videoId) {
  try {
    const videoUrl = `https://www.youtube.com/watch?v=${videoId}`;
    const html = await fetchHTML(videoUrl);
    
    let transcript = null;
    let description = '';
    let timestamps = [];
    
    // Try to extract captions/transcript
    try {
      const captionsMatch = html.match(/"captionTracks":\s*\[(.*?)\]/);
      if (captionsMatch) {
        const captionsData = captionsMatch[1];
        const urlMatch = captionsData.match(/"baseUrl":\s*"([^"]+)"/);
        if (urlMatch) {
          let captionsUrl = urlMatch[1].replace(/\\u0026/g, '&').replace(/\\\//g, '/');
          const captionsXml = await fetchHTML(captionsUrl);
          const textMatches = captionsXml.match(/<text[^>]*>([^<]*)<\/text>/g) || [];
          transcript = textMatches.map(t => {
            const textContent = t.match(/>([^<]*)</)?.[1] || '';
            return textContent.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'");
          }).join(' ');
        }
      }
    } catch (e) {}
    
    // Extract description with timestamps
    const descMatch = html.match(/"shortDescription":\s*"([^"]+)"/);
    if (descMatch) {
      description = descMatch[1].replace(/\\n/g, '\n').replace(/\\"/g, '"');
      
      // Parse timestamps like "00:25 JPY, drahé kovy..."
      const timestampRegex = /(\d{1,2}:\d{2}(?::\d{2})?)\s+([^\n]+)/g;
      let match;
      while ((match = timestampRegex.exec(description)) !== null) {
        const time = match[1];
        const topic = match[2].trim();
        if (topic && !topic.toLowerCase().includes('úvod') && topic.length > 2) {
          timestamps.push({ time, topic });
        }
      }
    }
    
    return { transcript, description, timestamps };
  } catch (e) {
    console.error('❌ Video info fetch error:', e.message);
    return { transcript: null, description: '', timestamps: [] };
  }
}

async function analyzeXTBCommentary(videoInfo) {
  if (!GEMINI_API_KEY) return null;
  
  const prompt = `Jsi finanční analytik. Podívej se na toto YouTube video - je to ranní komentář od XTB (Jaroslav Brychta a kolegové).

VIDEO URL: ${videoInfo.url}

ÚKOL: Projdi CELÉ video a vytvoř DETAILNÍ výtah. NIC NEVYMÝŠLEJ - zajímá mě POUZE co skutečně říkají ve videu.

Pro KAŽDÉ téma které rozebírají vytvoř samostatnou sekci s:
- Co přesně k tématu řekli
- Konkrétní čísla, ceny, úrovně které zmínili
- Jejich názor/predikce
- Případná doporučení

Formát odpovědi (JSON):
{
  "celkovySouhrn": "2-3 věty - hlavní poselství celého videa",
  "temata": [
    {
      "nazev": "Přesný název tématu jak ho pojmenovali",
      "casVeVideu": "MM:SS - MM:SS",
      "typ": "akcie|index|komodita|forex|krypto|makro|geopolitika",
      "sentiment": "bullish|bearish|neutral",
      "coRekli": "PŘESNĚ co k tématu řekli - citace nebo přesná parafráze. Konkrétní čísla, úrovně, ceny.",
      "klicoveBody": ["konkrétní bod 1", "konkrétní bod 2"],
      "doporuceni": "Co doporučují (pokud zmínili)"
    }
  ],
  "dulezitaUpozorneni": ["Varování která explicitně zmínili"],
  "datumAnalyzy": "${new Date().toISOString()}"
}

DŮLEŽITÉ: Piš POUZE to co skutečně ve videu zaznělo. Žádné domněnky nebo obecné informace.`;

  try {
    // Use Gemini with video file
    const result = await postJSON(
      `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`,
      { 
        contents: [{ 
          parts: [
            { text: prompt },
            { 
              fileData: {
                mimeType: "video/mp4",
                fileUri: videoInfo.url
              }
            }
          ] 
        }]
      }
    );
    
    // If video direct analysis fails, try with YouTube URL as text reference
    if (result.status !== 200) {
      console.log('  ⚠️ Direct video analysis failed, trying URL reference...');
      
      const fallbackResult = await postJSON(
        `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`,
        { 
          contents: [{ 
            parts: [{ text: prompt }] 
          }],
          generationConfig: {
            temperature: 0.1
          }
        }
      );
      
      if (fallbackResult.status !== 200) {
        console.error('❌ Gemini XTB analysis error:', fallbackResult.status);
        return null;
      }
      
      const response = JSON.parse(fallbackResult.body);
      let text = response.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!text) return null;
      
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        try {
          const parsed = JSON.parse(jsonMatch[0]);
          parsed.sourceNote = "Analýza z URL reference - pro přesnější výsledky je potřeba přímý přístup k videu";
          return parsed;
        } catch (e) {
          return { celkovySouhrn: text, temata: [], raw: true };
        }
      }
      return { celkovySouhrn: text, temata: [], raw: true };
    }
    
    const response = JSON.parse(result.body);
    let text = response.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) return null;
    
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      try {
        return JSON.parse(jsonMatch[0]);
      } catch (e) {
        return { celkovySouhrn: text, temata: [], raw: true };
      }
    }
    
    return { celkovySouhrn: text, temata: [], raw: true };
  } catch (e) {
    console.error('❌ XTB analysis error:', e.message);
    return null;
  }
}

async function fetchXTBMorningCommentary() {
  console.log('📺 Fetching XTB Morning Commentary...');
  
  const video = await fetchLatestXTBVideo();
  if (!video) {
    console.log('  ⚠️ No XTB morning video found today');
    return null;
  }
  
  console.log(`  📹 Found: ${video.title}`);
  console.log(`  🔗 ${video.url}`);
  console.log('  🤖 Sending video to Gemini for analysis...');
  
  const analysis = await analyzeXTBCommentary(video);
  if (analysis) {
    console.log(`  ✅ Analysis complete: ${analysis.temata?.length || 0} topics extracted`);
    if (analysis.sourceNote) {
      console.log(`  ℹ️ ${analysis.sourceNote}`);
    }
  } else {
    console.log('  ⚠️ Analysis failed');
  }
  
  return {
    video,
    analysis,
    updated: new Date().toISOString()
  };
}

// ========== END XTB ==========

// ========== FISHER INVESTMENTS / KEN FISHER ==========

async function fetchFisherVideos() {
  try {
    // Fetch channel RSS feed
    const rssUrl = `https://www.youtube.com/feeds/videos.xml?channel_id=${FISHER_CHANNEL_ID}`;
    let rss = '';
    try {
      rss = await fetchHTML(rssUrl);
    } catch (e) {
      console.log('  ⚠️ Fisher channel RSS failed:', e.message);
      return [];
    }
    
    if (!rss || rss.length < 100) {
      console.log('  ⚠️ Fisher RSS response too short');
      return [];
    }
    
    // Parse all video entries from RSS
    const entries = [];
    const entryRegex = /<entry>([\s\S]*?)<\/entry>/g;
    let match;
    
    while ((match = entryRegex.exec(rss)) !== null) {
      const entry = match[1];
      const videoIdMatch = entry.match(/<yt:videoId>([^<]+)<\/yt:videoId>/);
      const titleMatch = entry.match(/<title>([^<]+)<\/title>/);
      const publishedMatch = entry.match(/<published>([^<]+)<\/published>/);
      const authorMatch = entry.match(/<author>[\s\S]*?<name>([^<]+)<\/name>/);
      
      if (videoIdMatch && titleMatch) {
        entries.push({
          videoId: videoIdMatch[1],
          title: titleMatch[1],
          published: publishedMatch ? publishedMatch[1] : null,
          author: authorMatch ? authorMatch[1] : 'Fisher Investments',
          url: `https://www.youtube.com/watch?v=${videoIdMatch[1]}`
        });
      }
    }
    
    // Filter for Ken Fisher videos (he's usually in the title or it's obvious market commentary)
    const kenFisherVideos = entries.filter(v => {
      const title = v.title.toLowerCase();
      return title.includes('ken fisher') || 
             title.includes('fisher:') ||
             title.includes('market') ||
             title.includes('stock') ||
             title.includes('invest') ||
             title.includes('economy') ||
             title.includes('bull') ||
             title.includes('bear');
    });
    
    // Return top videos (prefer Ken Fisher specific, fallback to all)
    const videosToReturn = kenFisherVideos.length >= FISHER_MAX_VIDEOS 
      ? kenFisherVideos.slice(0, FISHER_MAX_VIDEOS)
      : entries.slice(0, FISHER_MAX_VIDEOS);
    
    return videosToReturn;
  } catch (e) {
    console.error('❌ Fisher videos fetch error:', e.message);
    return [];
  }
}

async function analyzeFisherVideo(videoInfo) {
  if (!GEMINI_API_KEY) return null;
  
  const prompt = `Jsi zkušený investiční analytik. Podívej se na toto YouTube video od Fisher Investments (Ken Fisher nebo jeho tým).

VIDEO URL: ${videoInfo.url}
TITLE: ${videoInfo.title}

KEN FISHER je legendární investor, zakladatel Fisher Investments (správa >200 miliard USD), autor mnoha knih o investování, a pravidelně komentuje trhy.

ÚKOL: Projdi CELÉ video a vytvoř DETAILNÍ analýzu pro dlouhodobého investora. NIC NEVYMÝŠLEJ - zajímají mě POUZE věci, které skutečně říká ve videu.

Zaměř se na:
1. HLAVNÍ TEZE - Co je hlavní myšlenka/argument videa?
2. TRŽNÍ VÝHLED - Jak vidí trhy v blízké budoucnosti (6-18 měsíců)?
3. BULL/BEAR SIGNÁLY - Jaké indikátory nebo signály zmiňuje?
4. SEKTORY/AKCIE - Zmiňuje konkrétní sektory nebo akcie?
5. RIZIKA - Na co upozorňuje? Čeho se obávat?
6. KONTRARIÁNSKÉ POHLEDY - Ken Fisher je známý kontrariánským přístupem. Jaké běžné názory zpochybňuje?
7. KLÍČOVÉ CITÁTY - Doslovné citáty, které shrnují jeho pohled.

FORMÁT ODPOVĚDI (JSON):
{
  "hlavniTeze": "...",
  "trhniVyhled": "bullish/bearish/neutral + vysvětlení",
  "casovyHorizont": "na jak dlouho se jeho predikce vztahuje",
  "signaly": ["signál 1", "signál 2"],
  "sektoryAkcie": ["sektor/akcie: komentář"],
  "rizika": ["riziko 1", "riziko 2"],
  "kontrarianskePogledy": ["běžný názor → Fisherův názor"],
  "klicoveCitaty": ["citát 1", "citát 2"],
  "proInvestora": "co by měl dlouhodobý investor udělat/vědět",
  "dulezitost": "1-5 (5 = velmi důležité pro investiční rozhodování)"
}

DŮLEŽITÉ: Odpověz POUZE validním JSON objektem, bez dalšího textu.`;

  try {
    const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`;
    
    const response = await new Promise((resolve, reject) => {
      const data = JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.3 }
      });
      
      const req = https.request(apiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      }, (res) => {
        let body = '';
        res.on('data', chunk => body += chunk);
        res.on('end', () => resolve({ status: res.statusCode, body }));
      });
      
      req.on('error', reject);
      req.write(data);
      req.end();
    });
    
    if (response.status !== 200) {
      console.error('❌ Gemini Fisher analysis error:', response.status);
      return null;
    }
    
    const result = JSON.parse(response.body);
    let text = result.candidates?.[0]?.content?.parts?.[0]?.text;
    
    if (!text) return null;
    
    // Extract JSON from response
    text = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    
    try {
      const analysis = JSON.parse(text);
      return {
        ...analysis,
        videoId: videoInfo.videoId,
        videoTitle: videoInfo.title,
        videoUrl: videoInfo.url,
        published: videoInfo.published,
        analyzedAt: new Date().toISOString()
      };
    } catch (e) {
      // Return raw text if JSON parsing fails
      return {
        raw: text,
        videoId: videoInfo.videoId,
        videoTitle: videoInfo.title,
        videoUrl: videoInfo.url,
        published: videoInfo.published,
        analyzedAt: new Date().toISOString()
      };
    }
  } catch (e) {
    console.error('❌ Fisher analysis error:', e.message);
    return null;
  }
}

async function fetchKenFisherInsights() {
  console.log('🎣 Fetching Ken Fisher / Fisher Investments videos...');
  
  const videos = await fetchFisherVideos();
  if (!videos || videos.length === 0) {
    console.log('  ⚠️ No Fisher videos found');
    return null;
  }
  
  console.log(`  📹 Found ${videos.length} videos to analyze`);
  
  const analyses = [];
  for (const video of videos) {
    console.log(`  🔍 Analyzing: ${video.title.substring(0, 60)}...`);
    const analysis = await analyzeFisherVideo(video);
    if (analysis) {
      analyses.push(analysis);
      console.log(`    ✅ Analysis complete (importance: ${analysis.dulezitost || '?'}/5)`);
    }
    // Small delay between API calls
    await new Promise(r => setTimeout(r, 2000));
  }
  
  if (analyses.length === 0) {
    console.log('  ⚠️ No analyses completed');
    return null;
  }
  
  // Generate overall summary from all videos
  const overallSummary = generateFisherSummary(analyses);
  
  return {
    videos: analyses,
    summary: overallSummary,
    lastUpdate: new Date().toISOString(),
    videoCount: analyses.length
  };
}

function generateFisherSummary(analyses) {
  if (!analyses || analyses.length === 0) return null;
  
  // Aggregate key insights
  const allSignals = [];
  const allRisks = [];
  const allSectors = [];
  const allQuotes = [];
  let overallSentiment = 'neutral';
  let bullCount = 0, bearCount = 0;
  
  for (const a of analyses) {
    if (a.signaly) allSignals.push(...a.signaly);
    if (a.rizika) allRisks.push(...a.rizika);
    if (a.sektoryAkcie) allSectors.push(...a.sektoryAkcie);
    if (a.klicoveCitaty) allQuotes.push(...a.klicoveCitaty);
    
    if (a.trhniVyhled) {
      const outlook = a.trhniVyhled.toLowerCase();
      if (outlook.includes('bullish') || outlook.includes('pozitivní')) bullCount++;
      if (outlook.includes('bearish') || outlook.includes('negativní')) bearCount++;
    }
  }
  
  if (bullCount > bearCount) overallSentiment = 'bullish';
  else if (bearCount > bullCount) overallSentiment = 'bearish';
  
  return {
    overallSentiment,
    keySignals: [...new Set(allSignals)].slice(0, 5),
    keyRisks: [...new Set(allRisks)].slice(0, 5),
    sectorsOfInterest: [...new Set(allSectors)].slice(0, 5),
    memorableQuotes: [...new Set(allQuotes)].slice(0, 3),
    videosCovered: analyses.length
  };
}

// ========== END FISHER ==========

// ========== STOCK DATA FETCHING (BROWSERBASE) ==========

// Fetch analyst ratings and news from Seeking Alpha using Browserbase
async function fetchSeekingAlphaData(ticker) {
  if (!BROWSERBASE_API_KEY || !BROWSERBASE_PROJECT_ID) {
    return null;
  }
  
  const url = `https://seekingalpha.com/symbol/${ticker}`;
  
  try {
    const data = await scrapeWithBrowserbase(url, () => {
      const getText = (selector) => {
        const el = document.querySelector(selector);
        return el ? el.textContent.trim() : null;
      };
      
      // Get analyst ratings
      const ratings = {};
      const ratingElements = document.querySelectorAll('[data-test-id="rating-card"], .rating-card, [class*="rating"]');
      ratingElements.forEach(el => {
        const text = el.textContent;
        if (text.includes('Quant')) ratings.quantRating = text;
        if (text.includes('Wall Street')) ratings.wallStreetRating = text;
        if (text.includes('SA Authors')) ratings.authorsRating = text;
      });
      
      // Get recent news headlines
      const news = [];
      const newsElements = document.querySelectorAll('[data-test-id="post-list-item"], article h3, [class*="article-title"]');
      newsElements.forEach((el, i) => {
        if (i < 5) {
          const title = el.textContent?.trim();
          if (title && title.length > 10) news.push(title);
        }
      });
      
      // Get factor grades
      const factors = {};
      const factorElements = document.querySelectorAll('[data-test-id="factor-grade"], [class*="factor-grade"]');
      factorElements.forEach(el => {
        const text = el.textContent;
        if (text.includes('Value')) factors.value = text;
        if (text.includes('Growth')) factors.growth = text;
        if (text.includes('Profitability')) factors.profitability = text;
        if (text.includes('Momentum')) factors.momentum = text;
      });
      
      return { ratings, news, factors };
    }, { waitFor: '[data-test-id="rating-card"], .rating-card', timeout: 15000 });
    
    return data;
  } catch (e) {
    console.log(`    ⚠️ Seeking Alpha error for ${ticker}: ${e.message}`);
    return null;
  }
}

// Fetch financial news for a stock using Browserbase
async function fetchStockNews(ticker) {
  if (!BROWSERBASE_API_KEY || !BROWSERBASE_PROJECT_ID) {
    return [];
  }
  
  const url = `https://finance.yahoo.com/quote/${ticker}/news`;
  
  try {
    const news = await scrapeWithBrowserbase(url, () => {
      const articles = [];
      const newsElements = document.querySelectorAll('[data-testid="news-stream"] li, .news-stream article, [class*="news-item"]');
      newsElements.forEach((el, i) => {
        if (i < 10) {
          const title = el.querySelector('h3, [class*="title"]')?.textContent?.trim();
          const source = el.querySelector('[class*="source"], [class*="provider"]')?.textContent?.trim();
          const time = el.querySelector('time, [class*="time"]')?.textContent?.trim();
          if (title && title.length > 10) {
            articles.push({ title, source: source || 'Yahoo Finance', time: time || 'Recent' });
          }
        }
      });
      return articles;
    }, { waitFor: '[data-testid="news-stream"], .news-stream', timeout: 15000 });
    
    return news || [];
  } catch (e) {
    console.log(`    ⚠️ News fetch error for ${ticker}: ${e.message}`);
    return [];
  }
}

// Fetch stock data using Browserbase (Yahoo Finance with JS rendering)
async function fetchStockDataWithBrowserbase(ticker) {
  const url = `https://finance.yahoo.com/quote/${ticker}`;
  
  try {
    const data = await scrapeWithBrowserbase(url, () => {
      // This runs in browser context
      const getText = (selector) => {
        const el = document.querySelector(selector);
        return el ? el.textContent.trim() : null;
      };
      
      const getNumber = (selector) => {
        const text = getText(selector);
        if (!text) return null;
        const num = parseFloat(text.replace(/[^0-9.-]/g, ''));
        return isNaN(num) ? null : num;
      };
      
      // Yahoo Finance selectors (2026 version)
      const price = getNumber('[data-testid="qsp-price"]') || 
                   getNumber('[data-field="regularMarketPrice"]') ||
                   getNumber('.livePrice span');
      
      const change = getNumber('[data-testid="qsp-price-change"]') ||
                    getNumber('[data-field="regularMarketChange"]');
      
      const changePercent = getNumber('[data-testid="qsp-price-change-percent"]') ||
                           getNumber('[data-field="regularMarketChangePercent"]');
      
      // Get from quote summary
      const getStatValue = (label) => {
        const rows = document.querySelectorAll('[data-testid="quote-statistics"] li, .quote-summary li');
        for (const row of rows) {
          if (row.textContent.toLowerCase().includes(label.toLowerCase())) {
            const value = row.querySelector('span:last-child, fin-streamer');
            return value ? value.textContent.trim() : null;
          }
        }
        return null;
      };
      
      return {
        price,
        priceChange: changePercent || change,
        previousClose: getNumber('[data-field="regularMarketPreviousClose"]'),
        open: getNumber('[data-field="regularMarketOpen"]'),
        dayHigh: getNumber('[data-field="regularMarketDayHigh"]') || getNumber('[data-field="regularMarketDayRange"]'),
        dayLow: getNumber('[data-field="regularMarketDayLow"]'),
        volume: getNumber('[data-field="regularMarketVolume"]'),
        marketCap: getStatValue('Market Cap') || getStatValue('Market cap'),
        peRatio: getNumber('[data-field="trailingPE"]') || getStatValue('PE Ratio') || getStatValue('P/E'),
        forwardPE: getStatValue('Forward P/E'),
        eps: getStatValue('EPS'),
        dividend: getStatValue('Dividend'),
        dividendYield: getStatValue('Dividend Yield') || getStatValue('Yield'),
        week52High: getStatValue('52 Week High') || getStatValue('52-week high'),
        week52Low: getStatValue('52 Week Low') || getStatValue('52-week low'),
        beta: getStatValue('Beta'),
        targetPrice: getStatValue('1y Target Est'),
        name: document.querySelector('h1')?.textContent?.split('(')[0]?.trim(),
        sector: document.querySelector('[data-testid="sector"]')?.textContent?.trim()
      };
    }, { waitFor: '[data-testid="qsp-price"], .livePrice', timeout: 20000 });
    
    if (!data || !data.price) {
      console.log(`    ⚠️ Browserbase: No price data for ${ticker}`);
      return await fetchStooqDataFallback(ticker);
    }
    
    // Parse market cap string to billions
    let marketCapB = null;
    if (data.marketCap) {
      const mcStr = data.marketCap.toString().toUpperCase();
      const mcNum = parseFloat(mcStr.replace(/[^0-9.]/g, ''));
      if (mcStr.includes('T')) marketCapB = mcNum * 1000;
      else if (mcStr.includes('B')) marketCapB = mcNum;
      else if (mcStr.includes('M')) marketCapB = mcNum / 1000;
    }
    
    return {
      ticker,
      source: 'yahoo-browserbase',
      fetchedAt: new Date().toISOString(),
      price: data.price,
      priceChange: data.priceChange,
      previousClose: data.previousClose,
      open: data.open,
      dayHigh: data.dayHigh,
      dayLow: data.dayLow,
      volume: data.volume,
      marketCapB,
      peRatio: typeof data.peRatio === 'string' ? parseFloat(data.peRatio) : data.peRatio,
      forwardPE: typeof data.forwardPE === 'string' ? parseFloat(data.forwardPE) : data.forwardPE,
      eps: typeof data.eps === 'string' ? parseFloat(data.eps.replace(/[^0-9.-]/g, '')) : data.eps,
      dividendYield: typeof data.dividendYield === 'string' ? parseFloat(data.dividendYield) : data.dividendYield,
      week52High: typeof data.week52High === 'string' ? parseFloat(data.week52High.replace(/[^0-9.]/g, '')) : data.week52High,
      week52Low: typeof data.week52Low === 'string' ? parseFloat(data.week52Low.replace(/[^0-9.]/g, '')) : data.week52Low,
      targetPrice: typeof data.targetPrice === 'string' ? parseFloat(data.targetPrice.replace(/[^0-9.]/g, '')) : data.targetPrice,
      longName: data.name,
      shortName: data.name,
      sector: data.sector
    };
  } catch (e) {
    console.log(`    ⚠️ Browserbase Yahoo error for ${ticker}: ${e.message}`);
    return await fetchStooqDataFallback(ticker);
  }
}

// Fallback to Stooq (simple HTTP, no JS needed)
async function fetchStooqDataFallback(ticker) {
  const stooqTicker = ticker.includes('.') ? ticker : `${ticker}.US`;
  const url = `https://stooq.com/q/l/?s=${stooqTicker.toLowerCase()}&f=sd2t2ohlcvn&h&e=csv`;
  
  return new Promise((resolve) => {
    https.get(url, {
      headers: { 'User-Agent': 'Mozilla/5.0' }
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const lines = data.trim().split('\n');
          if (lines.length < 2) { resolve(null); return; }
          
          const values = lines[1].split(',');
          const close = parseFloat(values[6]);
          const open = parseFloat(values[3]);
          
          resolve({
            ticker, source: 'stooq-fallback', fetchedAt: new Date().toISOString(),
            price: close, priceChange: open > 0 ? ((close - open) / open * 100) : 0,
            open, dayHigh: parseFloat(values[4]), dayLow: parseFloat(values[5]),
            volume: parseInt(values[7]) || 0, shortName: values[8] || ticker, longName: values[8] || ticker
          });
        } catch (e) { resolve(null); }
      });
    }).on('error', () => resolve(null));
  });
}

// Main function to fetch stock data (tries Browserbase first, falls back to Stooq)
async function fetchStooqData(ticker) {
  // Try Browserbase with Yahoo Finance first
  if (BROWSERBASE_API_KEY && BROWSERBASE_PROJECT_ID) {
    const data = await fetchStockDataWithBrowserbase(ticker);
    if (data && data.price) return data;
  }
  
  // Fallback to simple Stooq
  return await fetchStooqDataFallback(ticker);
}

// Alias for compatibility
async function fetchYahooFinanceData(ticker) {
  return fetchStooqData(ticker);
}

// Legacy function name for compatibility  
async function fetchGuruFocusData(ticker) {
  return fetchYahooFinanceData(ticker);
}

// ========== WATCHLIST STOCKS ==========

// Research jednotlivé akcie pomocí Browserbase + Gemini 2.5 Pro s Google Search
async function researchSingleStock(ticker) {
  if (!GEMINI_API_KEY) return null;
  
  const today = new Date().toISOString().split('T')[0];
  
  // Získáme data z Yahoo Finance přes Browserbase (jediný Browserbase call)
  console.log(`    📊 Fetching via Browserbase...`);
  const yfData = await fetchStooqData(ticker);
  
  // Sestavíme kontext z Yahoo Finance dat
  let dataContext = '';
  
  if (yfData) {
    dataContext += `
LIVE DATA (${today}):
- Aktuální cena: $${yfData.price?.toFixed(2) || 'N/A'} USD
- Denní změna: ${yfData.priceChange?.toFixed(2) || 'N/A'}%
- Open: $${yfData.open?.toFixed(2) || 'N/A'} | High: $${yfData.dayHigh?.toFixed(2) || 'N/A'} | Low: $${yfData.dayLow?.toFixed(2) || 'N/A'}
- Volume: ${yfData.volume?.toLocaleString() || 'N/A'}
- P/E: ${yfData.peRatio || 'N/A'} | Forward P/E: ${yfData.forwardPE || 'N/A'}
- Market Cap: ${yfData.marketCapB ? yfData.marketCapB.toFixed(1) + 'B' : 'N/A'}
- 52w High: $${yfData.week52High || 'N/A'} | 52w Low: $${yfData.week52Low || 'N/A'}
- Target Price: $${yfData.targetPrice || 'N/A'}
- Sector: ${yfData.sector || 'N/A'}
`;
  }
  
  // Legacy variable name for backward compatibility
  const yfContext = dataContext;
  
  const prompt = `Jsi špičkový finanční analytik. Proveď DŮKLADNÝ research akcie ${ticker}.
${yfContext}

DATUM: ${today}

ÚKOL: Vyhledej aktuální informace o firmě a její akcii. Zajímá mě:

1. ZÁKLADNÍ INFO:
   - Aktuální cena akcie (pokud ji najdeš)
   - P/E ratio, P/S ratio, Market Cap
   - 52-week high/low
   - Dividend yield (pokud vyplácí)

2. JAK SE FIRMĚ DAŘÍ:
   - Poslední kvartální výsledky (revenue, EPS, YoY změny)
   - Guidance managementu
   - Marže a jejich trend
   - Free cash flow

3. AKTUÁLNÍ UDÁLOSTI (poslední 2 týdny):
   - Důležité novinky o firmě
   - Nové produkty nebo služby
   - Partnerství, akvizice
   - Změny v managementu
   - Regulatorní záležitosti

4. KONKURENČNÍ POZICE:
   - Jak si stojí vůči konkurenci
   - Tržní podíl
   - Konkurenční výhody/nevýhody

5. RIZIKA A PŘÍLEŽITOSTI:
   - Hlavní rizika
   - Růstové příležitosti
   - Makro faktory ovlivňující firmu

6. NÁZORY ANALYTIKŮ:
   - Průměrný price target
   - Buy/Hold/Sell doporučení
   - Poslední upgrade/downgrade

7. TECHNICKÁ ANALÝZA (stručně):
   - Trend (uptrend/downtrend/sideways)
   - Klíčové support/resistance úrovně

FORMÁT ODPOVĚDI (JSON):
{
  "ticker": "${ticker}",
  "name": "název firmy",
  "sector": "sektor",
  "price": "aktuální cena nebo N/A",
  "priceChange": "změna za den (%)",
  "pe": "P/E ratio",
  "ps": "P/S ratio",
  "marketCap": "tržní kapitalizace",
  "week52High": "52w high",
  "week52Low": "52w low",
  "dividendYield": "dividend yield nebo N/A",
  
  "financials": {
    "lastQuarterRevenue": "tržby",
    "revenueGrowthYoY": "růst YoY %",
    "lastQuarterEPS": "EPS",
    "epsGrowthYoY": "růst EPS YoY %",
    "grossMargin": "hrubá marže %",
    "operatingMargin": "provozní marže %",
    "freeCashFlow": "FCF",
    "guidance": "guidance managementu"
  },
  
  "novinky": [
    {"datum": "YYYY-MM-DD", "titulek": "...", "dopad": "pozitivní|negativní|neutrální"}
  ],
  
  "konkurence": {
    "hlavniKonkurenti": ["konkurent1", "konkurent2"],
    "pozice": "popis konkurenční pozice",
    "vyhody": ["výhoda1"],
    "nevyhody": ["nevýhoda1"]
  },
  
  "rizika": ["riziko1", "riziko2"],
  "prilezitosti": ["příležitost1", "příležitost2"],
  
  "analytickyKonsensus": {
    "prumernyPriceTarget": "cena",
    "doporuceni": "Buy/Hold/Sell",
    "pocetAnalytiku": "počet",
    "posledniZmena": "upgrade/downgrade info"
  },
  
  "technicalAnalysis": {
    "trend": "uptrend|downtrend|sideways",
    "support": "support úroveň",
    "resistance": "resistance úroveň",
    "rsi": "RSI hodnota nebo N/A"
  },
  
  "sentiment": "bullish|bearish|neutral",
  "sentimentDuvod": "proč tento sentiment",
  
  "souhrn": "3-5 vět shrnující jak se firmě daří a co je klíčové pro investora",
  "actionItem": "konkrétní doporučení pro investora"
}

DŮLEŽITÉ: 
- Hledej AKTUÁLNÍ data, ne historická
- Pokud něco nenajdeš, napiš "N/A"
- Buď objektivní, ne přehnaně optimistický ani pesimistický`;

  try {
    // Použití Gemini 2.5 Pro s Google Search grounding
    const result = await postJSON(
      `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_PRO_MODEL}:generateContent?key=${GEMINI_API_KEY}`,
      { 
        contents: [{ parts: [{ text: prompt }] }],
        tools: [{ google_search: {} }], // Aktivace Google Search grounding
        generationConfig: { 
          temperature: 0.2,
          topP: 0.95,
          maxOutputTokens: 4096
        }
      }
    );
    
    if (result.status !== 200) {
      console.error(`  ❌ Gemini research error for ${ticker}: HTTP ${result.status}`);
      // Fallback na flash model bez groundingu
      return await researchStockFallback(ticker);
    }
    
    const response = JSON.parse(result.body);
    let text = response.candidates?.[0]?.content?.parts?.[0]?.text;
    
    if (!text) {
      console.error(`  ❌ Empty response for ${ticker}`);
      return await researchStockFallback(ticker);
    }
    
    // Parse JSON z odpovědi
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      try {
        const parsed = JSON.parse(jsonMatch[0]);
        parsed.researchedAt = new Date().toISOString();
        parsed.model = GEMINI_PRO_MODEL;
        parsed.grounded = true;
        
        // Přidej Stooq live data
        if (yfData) {
          parsed.stooqData = yfData;
          // Override with live Stooq data
          if (yfData.price) parsed.price = `$${yfData.price.toFixed(2)}`;
          if (yfData.priceChange != null) parsed.priceChange = `${yfData.priceChange > 0 ? '+' : ''}${yfData.priceChange.toFixed(2)}%`;
          if (yfData.peRatio) parsed.pe = yfData.peRatio.toFixed(2);
          if (yfData.pbRatio) parsed.pb = yfData.pbRatio.toFixed(2);
          if (yfData.marketCapB) parsed.marketCap = `$${yfData.marketCapB.toFixed(1)}B`;
          if (yfData.week52High) parsed.week52High = `$${yfData.week52High.toFixed(2)}`;
          if (yfData.week52Low) parsed.week52Low = `$${yfData.week52Low.toFixed(2)}`;
          if (yfData.dividendYield) parsed.dividendYield = `${yfData.dividendYield.toFixed(2)}%`;
          if (yfData.sector) parsed.sector = yfData.sector;
          if (yfData.longName) parsed.name = yfData.longName;
        }
        
        return parsed;
      } catch (e) {
        console.error(`  ❌ JSON parse error for ${ticker}:`, e.message);
        // Even on error, return Stooq data if available
        if (yfData) {
          return {
            ticker,
            name: yfData.longName || yfData.shortName || ticker,
            stooqData: yfData,
            price: yfData.price ? `$${yfData.price.toFixed(2)}` : 'N/A',
            priceChange: yfData.priceChange != null ? `${yfData.priceChange > 0 ? '+' : ''}${yfData.priceChange.toFixed(2)}%` : 'N/A',
            pe: yfData.peRatio?.toFixed(2) || 'N/A',
            pb: yfData.pbRatio?.toFixed(2) || 'N/A',
            marketCap: yfData.marketCapB ? `$${yfData.marketCapB.toFixed(1)}B` : 'N/A',
            week52High: yfData.week52High ? `$${yfData.week52High.toFixed(2)}` : 'N/A',
            week52Low: yfData.week52Low ? `$${yfData.week52Low.toFixed(2)}` : 'N/A',
            sector: yfData.sector || 'N/A',
            sentiment: yfData.priceChange > 2 ? 'bullish' : yfData.priceChange < -2 ? 'bearish' : 'neutral',
            souhrn: `Stooq live data. Price: $${yfData.price?.toFixed(2)}`,
            researchedAt: new Date().toISOString(),
            model: 'stooq-only',
            grounded: false,
            parseError: true
          };
        }
        return await researchStockFallback(ticker);
      }
    }
    
    // If no JSON match but we have Stooq data, return that
    if (yfData) {
      return {
        ticker,
        name: yfData.longName || yfData.shortName || ticker,
        stooqData: yfData,
        price: yfData.price ? `$${yfData.price.toFixed(2)}` : 'N/A',
        priceChange: yfData.priceChange != null ? `${yfData.priceChange > 0 ? '+' : ''}${yfData.priceChange.toFixed(2)}%` : 'N/A',
        pe: yfData.peRatio?.toFixed(2) || 'N/A',
        pb: yfData.pbRatio?.toFixed(2) || 'N/A',
        marketCap: yfData.marketCapB ? `$${yfData.marketCapB.toFixed(1)}B` : 'N/A',
        week52High: yfData.week52High ? `$${yfData.week52High.toFixed(2)}` : 'N/A',
        week52Low: yfData.week52Low ? `$${yfData.week52Low.toFixed(2)}` : 'N/A',
        sector: yfData.sector || 'N/A',
        sentiment: yfData.priceChange > 2 ? 'bullish' : yfData.priceChange < -2 ? 'bearish' : 'neutral',
        souhrn: `Stooq live data. Price: $${yfData.price?.toFixed(2)}`,
        researchedAt: new Date().toISOString(),
        model: 'stooq-only',
        grounded: false
      };
    }
    
    return await researchStockFallback(ticker);
  } catch (e) {
    console.error(`  ❌ Research error for ${ticker}:`, e.message);
    return await researchStockFallback(ticker, yfData);
  }
}

// Fallback research pomocí Flash modelu (bez groundingu)
async function researchStockFallback(ticker, existingGfData = null) {
  console.log(`    ⚠️ Using fallback for ${ticker}`);
  
  // If we have Stooq data, use it as primary source
  if (existingGfData) {
    const yfData = existingGfData;
    return {
      ticker,
      name: yfData.longName || yfData.shortName || ticker,
      stooqData: yfData,
      price: yfData.price ? `$${yfData.price.toFixed(2)}` : 'N/A',
      priceChange: yfData.priceChange != null ? `${yfData.priceChange > 0 ? '+' : ''}${yfData.priceChange.toFixed(2)}%` : 'N/A',
      pe: yfData.peRatio?.toFixed(2) || 'N/A',
      pb: yfData.pbRatio?.toFixed(2) || 'N/A',
      marketCap: yfData.marketCapB ? `$${yfData.marketCapB.toFixed(1)}B` : 'N/A',
      week52High: yfData.week52High ? `$${yfData.week52High.toFixed(2)}` : 'N/A',
      week52Low: yfData.week52Low ? `$${yfData.week52Low.toFixed(2)}` : 'N/A',
      sector: yfData.sector || 'N/A',
      sentiment: yfData.priceChange > 2 ? 'bullish' : yfData.priceChange < -2 ? 'bearish' : 'neutral',
      souhrn: `Yahoo Finance live data. Price: $${yfData.price?.toFixed(2)}, P/E: ${yfData.peRatio?.toFixed(2) || 'N/A'}`,
      researchedAt: new Date().toISOString(),
      model: 'stooq-fallback',
      grounded: false,
      fallback: true
    };
  }
  
  const prompt = `Jsi finanční analytik. Co víš o akcii ${ticker}? Dej mi základní info:
- Název firmy, sektor
- Přibližná tržní kapitalizace
- Hlavní produkty/služby
- Konkurenční pozice
- Obecný sentiment

Odpověz ve formátu JSON:
{
  "ticker": "${ticker}",
  "name": "název",
  "sector": "sektor",
  "marketCap": "přibližná hodnota",
  "price": "N/A",
  "pe": "N/A",
  "sentiment": "bullish|bearish|neutral",
  "souhrn": "co víš o firmě",
  "novinky": [],
  "rizika": [],
  "prilezitosti": []
}`;

  try {
    const result = await postJSON(
      `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`,
      { 
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.1 }
      }
    );
    
    if (result.status !== 200) return null;
    
    const response = JSON.parse(result.body);
    let text = response.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) return null;
    
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      parsed.researchedAt = new Date().toISOString();
      parsed.model = GEMINI_MODEL;
      parsed.grounded = false;
      parsed.fallback = true;
      return parsed;
    }
  } catch (e) {}
  
  return {
    ticker,
    name: ticker,
    sentiment: 'neutral',
    souhrn: 'Data nedostupná',
    researchedAt: new Date().toISOString(),
    error: true
  };
}

async function analyzeWatchlistStocks() {
  if (!GEMINI_API_KEY) return null;
  
  console.log('📈 Researching watchlist stocks...');
  console.log(`   📊 Primary source: Browserbase + Yahoo Finance (live data)`);
  console.log(`   🤖 AI Analysis: ${GEMINI_MODEL} (rychlý model)`);
  
  const stocks = [];
  
  for (const ticker of WATCHLIST_STOCKS) {
    console.log(`  🔍 Researching ${ticker}...`);
    
    const research = await researchSingleStock(ticker);
    if (research) {
      stocks.push(research);
      const gfStatus = research.gfScore ? `GF:${research.gfScore}/100` : 'No GF';
      const aiStatus = research.grounded ? '✅AI' : research.model === 'gurufocus-only' ? '📊GF' : '⚠️FB';
      const valStatus = research.valuationStatus || '';
      console.log(`    ${aiStatus} ${ticker}: ${research.sentiment || 'N/A'} | ${research.price || 'N/A'} | ${gfStatus} | ${valStatus}`);
    }
    
    // Pauza mezi API calls (rate limiting)
    await sleep(2500);
  }
  
  // Vygeneruj celkový market sentiment
  const bullish = stocks.filter(s => s.sentiment === 'bullish').length;
  const bearish = stocks.filter(s => s.sentiment === 'bearish').length;
  const neutral = stocks.filter(s => s.sentiment === 'neutral').length;
  
  const marketSentiment = bullish > bearish + neutral ? 'bullish' 
    : bearish > bullish + neutral ? 'bearish' 
    : 'mixed';
  
  console.log(`  📊 Research complete: ${stocks.length} stocks | ${bullish}🟢 ${bearish}🔴 ${neutral}⚪`);
  
  return {
    stocks,
    summary: {
      total: stocks.length,
      bullish,
      bearish,
      neutral,
      marketSentiment,
      groundedCount: stocks.filter(s => s.grounded).length,
      fallbackCount: stocks.filter(s => s.fallback).length
    },
    model: GEMINI_PRO_MODEL,
    updated: new Date().toISOString()
  };
}

// ========== END WATCHLIST ==========

// ========== LIQUITY TRACKER ==========

async function fetchLiquityPosition() {
  console.log('🏦 Checking Liquity V2 wstETH position...');
  
  // Try Liquity V2 Bold subgraph
  const v2Subgraphs = [
    'https://api.studio.thegraph.com/query/42319/bold-mainnet/version/latest',
    'https://gateway.thegraph.com/api/subgraphs/id/GdE86fy2EoEdGkYzqsRmswLbZpKwQ6RNFvnfpXBQqLdb'
  ];
  
  for (const subgraphUrl of v2Subgraphs) {
    try {
      // Query for troves in the wstETH collateral market
      const query = `{
        troves(where: {owner: "${LIQUITY_SAFE_ADDRESS}"}) {
          id
          owner
          collateral
          debt
          stake
          interestRate
          collIndex
        }
        troves(orderBy: interestRate, orderDirection: asc, first: 1000) {
          owner
          debt
          interestRate
          collIndex
        }
      }`;
      
      const result = await postJSON(subgraphUrl, { query });
      
      if (result.status === 200 && result.body) {
        const data = JSON.parse(result.body);
        if (data.data && data.data.troves) {
          return await processLiquityV2Data(data.data);
        }
      }
    } catch (e) {
      console.log(`  ⚠️ Subgraph error: ${e.message}`);
    }
  }
  
  // Fallback: try DeFi Saver API
  return await fetchDebtInFrontFromAPI();
}

async function processLiquityV2Data(data) {
  const allTroves = data.troves || [];
  
  // Find our trove and calculate debt in front
  // In Liquity V2, troves are sorted by interest rate (ascending)
  // Lower interest rate = higher priority for redemption
  let debtInFront = 0;
  let ourTrove = null;
  
  for (const t of allTroves) {
    if (t.owner?.toLowerCase() === LIQUITY_SAFE_ADDRESS) {
      ourTrove = t;
      break;
    }
    // Sum debt of all troves with lower interest rate
    debtInFront += parseFloat(t.debt || 0) / 1e18;
  }
  
  if (ourTrove) {
    const debt = parseFloat(ourTrove.debt || 0) / 1e18;
    const collateral = parseFloat(ourTrove.collateral || 0) / 1e18;
    const interestRate = parseFloat(ourTrove.interestRate || 0) / 1e16; // Convert to %
    
    console.log(`  📊 Debt in front: ${(debtInFront / 1e6).toFixed(2)}M BOLD`);
    console.log(`  📊 Interest rate: ${interestRate.toFixed(2)}%`);
    console.log(`  📊 Debt: ${(debt / 1e6).toFixed(2)}M BOLD`);
    
    return {
      address: LIQUITY_SAFE_ADDRESS,
      debtInFront,
      collateral,
      debt,
      interestRate,
      protocol: 'Liquity V2',
      collateralType: 'wstETH',
      url: LIQUITY_DEFISAVER_URL,
      updated: new Date().toISOString()
    };
  }
  
  console.log('  ℹ️ Trove not found in subgraph data');
  return await fetchDebtInFrontFromAPI();
}

async function fetchDebtInFrontFromAPI() {
  // Known position data from DeFi Saver (Liquity V2 wstETH)
  // Last scraped values - these should be updated via scraping
  // URL: https://app.defisaver.com/liquityV2/smart-wallet/wsteth/manage?trackAddress=0x66a7b66d7e823155660bdc6b83beaaa11098ea89&chainId=1
  
  // Load last known values from state file
  const state = loadState();
  const lastKnown = state.liquityLastKnown || {
    debtInFront: 33470000, // 33.47M BOLD (from DeFi Saver scrape)
    interestRate: 5.00,    // 5% (from DeFi Saver scrape)
    collateral: 2986.02,   // wstETH
    debt: 3560000,         // 3.56M BOLD
    cr: 306.54,            // Collateral ratio %
    balance: 7360000,      // $7.36M
    liquidationPrice: 1432.68,
    currentPrice: 3659.79
  };
  
  console.log(`  📊 Debt in front: ${(lastKnown.debtInFront / 1e6).toFixed(2)}M BOLD`);
  console.log(`  📊 Interest rate: ${lastKnown.interestRate}%`);
  
  return {
    address: LIQUITY_SAFE_ADDRESS,
    debtInFront: lastKnown.debtInFront,
    interestRate: lastKnown.interestRate,
    collateral: lastKnown.collateral,
    debt: lastKnown.debt,
    cr: lastKnown.cr,
    balance: lastKnown.balance,
    liquidationPrice: lastKnown.liquidationPrice,
    currentPrice: lastKnown.currentPrice,
    protocol: 'Liquity V2',
    collateralType: 'wstETH',
    url: LIQUITY_DEFISAVER_URL,
    updated: new Date().toISOString(),
    dataSource: 'cached' // Indicates this is cached data, not live
  };
}

async function checkLiquityAlert(liquityData, prevDebtInFront) {
  if (!liquityData) return;
  
  const debtInFront = liquityData.debtInFront;
  
  // Skip alerts if we don't have valid data
  if (debtInFront === null || debtInFront === undefined) {
    console.log('  ℹ️ No debt in front data available for alerts');
    return;
  }
  
  const debtInFrontM = debtInFront / 1e6;
  
  // Check for dramatic decrease (>20% drop)
  if (prevDebtInFront && prevDebtInFront > 0) {
    const change = ((debtInFront - prevDebtInFront) / prevDebtInFront) * 100;
    if (change < -20) {
      console.log(`  🚨 ALERT: Debt in front dropped ${Math.abs(change).toFixed(1)}%!`);
      await sendTelegram(`🚨 <b>LIQUITY ALERT</b>\n\nDebt in front dramaticky klesl o ${Math.abs(change).toFixed(1)}%!\n\nPředtím: ${(prevDebtInFront / 1e6).toFixed(2)}M\nNyní: ${debtInFrontM.toFixed(2)}M`);
    }
  }
  
  // Check threshold
  if (debtInFront < LIQUITY_ALERT_THRESHOLD) {
    console.log(`  🚨 CRITICAL: Debt in front below 30M! Currently: ${debtInFrontM.toFixed(2)}M`);
    await sendTelegram(`🚨🚨 <b>LIQUITY CRITICAL</b> 🚨🚨\n\nDebt in front je pod 30M!\n\n<b>Aktuální: ${debtInFrontM.toFixed(2)}M LUSD</b>\n\nKontroluj pozici IHNED!\n\nhttps://app.defisaver.com/liquity`);
  }
}

// ========== LIVE REDEMPTION & INTEREST RATE ANALYSIS ==========

async function fetchLiquityRedemptionData() {
  console.log('📊 Fetching Liquity V2 redemption data...');
  
  let etherscanData = null;
  let duneData = null;
  
  // Try Dune API for interest rate data
  if (DUNE_API_KEY) {
    try {
      duneData = await fetchDuneLiquityData();
    } catch (e) {
      console.log(`  ⚠️ Dune fetch failed: ${e.message}`);
    }
  }
  
  // Try Etherscan if API key available (for live redemption timestamps)
  if (ETHERSCAN_API_KEY) {
    try {
      etherscanData = await fetchEtherscanRedemptions();
    } catch (e) {
      console.log(`  ⚠️ Etherscan fetch failed: ${e.message}`);
    }
  }
  
  // Return combined data (Dune for rates + Etherscan for timestamps)
  return getEstimatedRedemptionAnalysis(etherscanData, duneData);
}

async function fetchDuneLiquityData() {
  if (!DUNE_API_KEY) return null;
  
  console.log('  🔍 Querying Dune Analytics for Liquity data...');
  
  try {
    // Query Dune for Liquity V2 interest rate data
    // Using query ID from liquity/liquity-v2 dashboard
    const queryId = '3521847'; // Liquity V2 interest rates query
    
    const response = await new Promise((resolve, reject) => {
      const options = {
        hostname: 'api.dune.com',
        path: `/api/v1/query/${queryId}/results?limit=1`,
        method: 'GET',
        headers: {
          'X-Dune-API-Key': DUNE_API_KEY
        }
      };
      
      https.get(options, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          try {
            resolve(JSON.parse(data));
          } catch (e) {
            reject(new Error('Invalid JSON from Dune'));
          }
        });
      }).on('error', reject);
    });
    
    if (response.result && response.result.rows && response.result.rows.length > 0) {
      const row = response.result.rows[0];
      console.log('  ✅ Dune data received');
      
      return {
        avgRateWstETH: row.wsteth_avg_rate || row.avg_interest_rate || 5.00,
        avgRateETH: row.eth_avg_rate || 3.64,
        avgRateRETH: row.reth_avg_rate || 0.90,
        lastRedemptionRate: row.last_redemption_rate || 4.85,
        totalBoldSupply: row.total_bold_supply,
        dataSource: 'dune'
      };
    }
  } catch (e) {
    console.log(`  ⚠️ Dune API error: ${e.message}`);
  }
  
  return null;
}

async function fetchEtherscanRedemptions() {
  if (!ETHERSCAN_API_KEY) {
    console.log('  ⚠️ No ETHERSCAN_API_KEY configured');
    return null;
  }
  
  console.log('  🔍 Querying Etherscan for redemptions...');
  
  // Liquity V2 CollateralRegistry contract (handles all redemptions)
  const collateralRegistryAddress = LIQUITY_V2_CONTRACTS.collateralRegistry;
  
  try {
    // Query transactions to CollateralRegistry using V2 API
    // Method 0xab6d53bd is redeemCollateral
    const txUrl = `https://api.etherscan.io/v2/api?chainid=1&module=account&action=txlist&address=${collateralRegistryAddress}&startblock=19000000&endblock=latest&page=1&offset=10&sort=desc&apikey=${ETHERSCAN_API_KEY}`;
    
    const txData = await fetchJSON(txUrl);
    
    if (txData.status === '1' && txData.result && Array.isArray(txData.result) && txData.result.length > 0) {
      // Find the most recent redemption transaction
      // Method ID 0xab6d53bd = redeemCollateral
      for (const tx of txData.result) {
        if (tx.input && tx.input.startsWith('0xab6d53bd')) {
          const timestamp = parseInt(tx.timeStamp) * 1000;
          const redemptionTime = new Date(timestamp);
          const hoursAgo = (Date.now() - timestamp) / (1000 * 60 * 60);
          const daysAgo = hoursAgo / 24;
          
          let timeAgoStr;
          if (daysAgo >= 30) {
            timeAgoStr = `${Math.floor(daysAgo / 30)} měsíců`;
          } else if (daysAgo >= 1) {
            timeAgoStr = `${Math.floor(daysAgo)} dní`;
          } else {
            timeAgoStr = `${Math.floor(hoursAgo)} hodin`;
          }
          
          console.log(`  📊 Last redemption: ${redemptionTime.toISOString()} (${timeAgoStr} ago)`);
          console.log(`  📊 TX: ${tx.hash}`);
          
          return {
            lastRedemptionTime: redemptionTime.toISOString(),
            lastRedemptionTimeAgo: timeAgoStr,
            lastRedemptionBlock: parseInt(tx.blockNumber),
            lastRedemptionTx: tx.hash,
            dataSource: 'etherscan',
            updated: new Date().toISOString()
          };
        }
      }
      console.log(`  ℹ️ No redeemCollateral transactions found in recent txs`);
    } else {
      console.log(`  ℹ️ Etherscan returned no transactions: ${txData.message || 'unknown'}`);
    }
  } catch (e) {
    console.log(`  ⚠️ Etherscan API error: ${e.message}`);
  }
  
  return null;
}

function getEstimatedRedemptionAnalysis(etherscanData = null, duneData = null) {
  // Use Dune data if available, otherwise use cached values from dashboard observation
  // Cached values from Dune dashboard (liquity/liquity-v2):
  // - wstETH avg interest rate: 5.00%
  // - Last redemption at: 4.85%
  // - ETH avg: 3.64%, last redemption: 2.90%
  // - rETH avg: 0.90%, last redemption: 0.50%
  
  const userRate = 5.00; // User's current rate
  const lastRedemptionWstETH = duneData?.lastRedemptionRate || 4.85;
  const avgRateWstETH = duneData?.avgRateWstETH || 5.00;
  
  // Calculate safety margin
  const safetyMargin = userRate - lastRedemptionWstETH;
  const isSafe = safetyMargin > 0.1; // At least 0.1% above last redemption
  
  // Estimate minimum safe rate (needs to be above last redemption)
  const minSafeRate = lastRedemptionWstETH + 0.05; // 4.90% minimum recommended
  
  // Calculate potential savings
  const userDebt = 3560000; // 3.56M BOLD
  const rateReduction = userRate - minSafeRate;
  const annualSavings = (rateReduction / 100) * userDebt;
  
  // Merge with Etherscan data if available
  const lastRedemptionTime = etherscanData?.lastRedemptionTime || null;
  const lastRedemptionTimeAgo = etherscanData?.lastRedemptionTimeAgo || 'N/A';
  const lastRedemptionTx = etherscanData?.lastRedemptionTx || null;
  
  // Determine data source
  let dataSource = 'estimated';
  if (etherscanData?.dataSource === 'etherscan' && duneData?.dataSource === 'dune') {
    dataSource = 'etherscan+dune';
  } else if (etherscanData?.dataSource === 'etherscan') {
    dataSource = 'etherscan';
  } else if (duneData?.dataSource === 'dune') {
    dataSource = 'dune';
  }
  
  return {
    // Interest rate data
    userRate: userRate,
    avgRateWstETH: avgRateWstETH,
    avgRateETH: duneData?.avgRateETH || 3.64,
    avgRateRETH: duneData?.avgRateRETH || 0.90,
    
    // Last redemption data
    lastRedemptionRate: lastRedemptionWstETH,
    lastRedemptionRateETH: 2.90,
    lastRedemptionRateRETH: 0.50,
    lastRedemptionTime: lastRedemptionTime,
    lastRedemptionTimeAgo: lastRedemptionTimeAgo,
    lastRedemptionTx: lastRedemptionTx,
    
    // Analysis
    safetyMargin: safetyMargin,
    safetyStatus: isSafe ? 'SAFE' : 'AT_RISK',
    minSafeRate: minSafeRate,
    
    // Recommendations
    recommendation: isSafe 
      ? `Tvůj úrok ${userRate}% je bezpečný (${safetyMargin.toFixed(2)}% nad poslední redemption)`
      : `⚠️ POZOR: Tvůj úrok ${userRate}% je příliš blízko poslední redemption (${lastRedemptionWstETH}%)`,
    
    potentialSavings: annualSavings,
    
    // Rate suggestions  
    rateSuggestions: [
      { rate: 5.00, risk: 'LOW', debtInFrontEstimate: '~33M', note: 'Aktuální - bezpečné' },
      { rate: 4.90, risk: 'LOW', debtInFrontEstimate: '~30M', note: 'Minimum doporučené' },
      { rate: 4.50, risk: 'MEDIUM', debtInFrontEstimate: '~20M', note: 'Pod poslední redemption!' },
      { rate: 4.00, risk: 'HIGH', debtInFrontEstimate: '~10M', note: '⚠️ Riskantní' },
    ],
    
    dataSource: dataSource,
    dataNote: dataSource === 'etherscan+dune' 
      ? 'Live data z Etherscan + Dune Analytics API'
      : dataSource === 'etherscan'
      ? 'Live data z Etherscan API'
      : dataSource === 'dune'
      ? 'Live data z Dune Analytics API'
      : 'Cached data z Dune Analytics dashboard',
    updated: new Date().toISOString()
  };
}

// ========== END LIQUITY ==========

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

// ========== LIVE FEED ==========
function buildLiveFeed(state) {
  const feed = [];
  const now = Date.now();
  
  // Add forum activity (last 20)
  if (state.activity && state.activity.length > 0) {
    state.activity.slice(0, 20).forEach(a => {
      feed.push({
        type: a.type === 'new' ? 'forum_new' : 'forum_update',
        icon: FORUMS[a.forumId]?.icon || '📌',
        title: a.title,
        subtitle: a.type === 'new' ? 'Nový příspěvek' : `+${a.newPosts} odpovědí`,
        forum: FORUMS[a.forumId]?.name || a.forumId,
        link: `${FORUMS[a.forumId]?.baseUrl || ''}/t/${a.slug}/${a.topicId}`,
        time: a.time,
        category: 'forum'
      });
    });
  }
  
  // Add price alerts (significant moves > 3%)
  if (state.prices) {
    for (const [id, price] of Object.entries(state.prices)) {
      const change = parseFloat(price.change24h) || 0;
      if (Math.abs(change) >= 3) {
        feed.push({
          type: change > 0 ? 'price_up' : 'price_down',
          icon: change > 0 ? '📈' : '📉',
          title: `${FORUMS[id]?.symbol || id.toUpperCase()} ${change > 0 ? '+' : ''}${change.toFixed(1)}%`,
          subtitle: `$${price.usd?.toFixed(2) || 'N/A'}`,
          forum: FORUMS[id]?.name || id,
          time: state.lastCheck,
          category: 'price'
        });
      }
    }
  }
  
  // Add Nansen top transactions (sells, buys, transfers)
  if (state.nansen) {
    for (const [id, tokenData] of Object.entries(state.nansen)) {
      const symbol = FORUMS[id]?.symbol || id.toUpperCase();
      const icon = FORUMS[id]?.icon || '🪙';
      
      // Top sells
      if (tokenData.sells && tokenData.sells.length > 0) {
        tokenData.sells.slice(0, 1).forEach(s => {
          feed.push({
            type: 'nansen_sell',
            icon: '📉',
            title: `${symbol} Prodej: $${(s.value_usd || 0).toLocaleString()}`,
            subtitle: `${s.label || s.address?.slice(0, 10)} prodal ${s.amount?.toFixed(1)} ${symbol}`,
            link: s.tx_hash ? `https://etherscan.io/tx/${s.tx_hash}` : null,
            time: s.timestamp || tokenData.updated,
            category: 'nansen'
          });
        });
      }
      
      // Top buys
      if (tokenData.buys && tokenData.buys.length > 0) {
        tokenData.buys.slice(0, 1).forEach(b => {
          feed.push({
            type: 'nansen_buy',
            icon: '📈',
            title: `${symbol} Nákup: $${(b.value_usd || 0).toLocaleString()}`,
            subtitle: `${b.label || b.address?.slice(0, 10)} koupil ${b.amount?.toFixed(1)} ${symbol}`,
            link: b.tx_hash ? `https://etherscan.io/tx/${b.tx_hash}` : null,
            time: b.timestamp || tokenData.updated,
            category: 'nansen'
          });
        });
      }
      
      // Top transfers
      if (tokenData.transfers && tokenData.transfers.length > 0) {
        tokenData.transfers.slice(0, 1).forEach(t => {
          feed.push({
            type: 'nansen_transfer',
            icon: '🔄',
            title: `${symbol} Transfer: $${(t.value_usd || 0).toLocaleString()}`,
            subtitle: `${t.from_label || t.from_address?.slice(0, 8)} → ${t.to_label || t.to_address?.slice(0, 8)}`,
            link: t.tx_hash ? `https://etherscan.io/tx/${t.tx_hash}` : null,
            time: t.timestamp || tokenData.updated,
            category: 'nansen'
          });
        });
      }
    }
  }
  
  // Add XTB commentary
  if (state.xtb && state.xtb.video) {
    feed.push({
      type: 'xtb',
      icon: '📺',
      title: 'XTB Ranní Komentář',
      subtitle: state.xtb.video.title?.substring(0, 50) + '...',
      link: state.xtb.video.url,
      time: state.lastXtb,
      category: 'analysis'
    });
  }
  
  // Add Ken Fisher insights
  if (state.fisher && state.fisher.videos && state.fisher.videos.length > 0) {
    const sentiment = state.fisher.summary?.overallSentiment || 'neutral';
    feed.push({
      type: 'fisher',
      icon: '🎣',
      title: `Ken Fisher: ${sentiment === 'bullish' ? '🐂 Bullish' : sentiment === 'bearish' ? '🐻 Bearish' : '➡️ Neutral'}`,
      subtitle: `${state.fisher.videos.length} videí analyzováno`,
      time: state.lastFisher,
      category: 'analysis'
    });
    
    // Add individual high-importance videos
    state.fisher.videos.filter(v => v.dulezitost >= 4).forEach(v => {
      feed.push({
        type: 'fisher_video',
        icon: '🎬',
        title: v.videoTitle?.substring(0, 60) || 'Ken Fisher Video',
        subtitle: v.hlavniTeze?.substring(0, 80) || '',
        link: v.videoUrl,
        time: v.published,
        category: 'analysis'
      });
    });
  }
  
  // Add Liquity position updates
  if (state.liquity) {
    const debtInFront = state.liquity.debtInFront;
    const isAlert = debtInFront && debtInFront < 30000000;
    
    feed.push({
      type: isAlert ? 'liquity_alert' : 'liquity',
      icon: isAlert ? '🚨' : '🏦',
      title: `Liquity: ${debtInFront ? (debtInFront / 1e6).toFixed(1) + 'M' : 'N/A'} Debt in Front`,
      subtitle: `Úrok: ${state.liquity.interestRate || 5}% | CR: ${state.liquity.collateralRatio || 'N/A'}%`,
      link: state.liquity.url,
      time: state.lastLiquity,
      category: 'defi'
    });
    
    // Add redemption info if recent
    const ra = state.liquity.redemptionAnalysis;
    if (ra && ra.lastRedemptionTx) {
      feed.push({
        type: 'liquity_redemption',
        icon: '⚡',
        title: `Poslední Redemption: ${ra.lastRedemptionRate}%`,
        subtitle: ra.lastRedemptionTimeAgo || 'N/A',
        link: `https://etherscan.io/tx/${ra.lastRedemptionTx}`,
        time: ra.lastRedemptionTime,
        category: 'defi'
      });
    }
  }
  
  // Add watchlist highlights
  if (state.watchlist && state.watchlist.stocks) {
    const bullish = state.watchlist.stocks.filter(s => s.sentiment === 'bullish');
    const bearish = state.watchlist.stocks.filter(s => s.sentiment === 'bearish');
    
    if (bullish.length > 0 || bearish.length > 0) {
      feed.push({
        type: 'watchlist',
        icon: '📊',
        title: `Watchlist: ${bullish.length}🟢 ${bearish.length}🔴`,
        subtitle: `${state.watchlist.stocks.length} akcií sledováno`,
        time: state.lastWatchlist,
        category: 'stocks'
      });
    }
  }
  
  // Add Snapshot proposals
  if (state.snapshot) {
    for (const [space, data] of Object.entries(state.snapshot)) {
      if (data.proposals && data.proposals.length > 0) {
        data.proposals.slice(0, 2).forEach(p => {
          const isActive = p.state === 'active';
          // Safely handle missing start timestamp
          let timeStr = null;
          try {
            if (p.start) {
              timeStr = new Date(p.start * 1000).toISOString();
            } else if (p.end) {
              timeStr = new Date(p.end * 1000).toISOString();
            }
          } catch (e) {
            timeStr = new Date().toISOString();
          }
          
          feed.push({
            type: 'snapshot',
            icon: '🗳️',
            title: p.title?.substring(0, 50) || 'Governance Proposal',
            subtitle: isActive ? '🟢 Aktivní hlasování' : `${p.state}`,
            link: `https://snapshot.org/#/${space}/proposal/${p.id}`,
            time: timeStr,
            category: 'governance'
          });
        });
      }
    }
  }
  
  // Sort by time (newest first)
  feed.sort((a, b) => {
    const timeA = a.time ? new Date(a.time).getTime() : 0;
    const timeB = b.time ? new Date(b.time).getTime() : 0;
    return timeB - timeA;
  });
  
  // Keep only last 50 items
  return feed.slice(0, 50);
}

// ========== END LIVE FEED ==========

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
      
      // Validate we got actual forum data
      if (!data || !data.topic_list || !data.topic_list.topics) {
        throw new Error('Invalid forum response');
      }
      
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
    } catch (e) { 
      console.error(`❌ ${forum.name}:`, e.message);
      // Keep previous data if available, mark as stale
      if (state.forums[id]) {
        state.forums[id].stale = true;
        state.forums[id].lastError = e.message;
      }
      
      // Special handling for Gnosis - blocked from datacenter IPs
      // Generate synthetic topics from Snapshot proposals
      if (id === 'gnosis') {
        try {
          const gnosisProposals = await fetchGnosisFromSnapshot();
          if (gnosisProposals && gnosisProposals.length > 0) {
            // Use created timestamp for recency, not end timestamp
            const topics = gnosisProposals.map((p, idx) => ({
              id: idx + 1,
              title: p.title,
              slug: p.id,
              posts_count: p.scores_total ? Math.round(p.scores_total) : 0,
              views: p.votes || 0,
              like_count: 0,
              last_posted_at: new Date(p.created * 1000).toISOString(), // Use created time for summary filtering
              last_poster: 'Snapshot',
              state: p.state,
              end: new Date(p.end * 1000).toISOString()
            }));
            const topicsMap = {};
            topics.forEach(t => topicsMap[t.id] = t);
            state.forums[id] = { 
              topics: topicsMap, 
              sentiment: { mood: '📊', score: 0 }, 
              lastCheck: now.toISOString(),
              source: 'snapshot',
              note: 'Forum blocked, using Snapshot governance data'
            };
            console.log(`  📊 ${forum.name}: Using Snapshot data (${topics.length} proposals)`);
          }
        } catch (e2) {
          console.error(`  ⚠️ Gnosis Snapshot fallback failed:`, e2.message);
        }
      }
    }
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
    state.nansen = await fetchAllTokenData();
    state.lastNansen = now.toISOString();
  }

  // Fetch Snapshot proposals every 5 minutes
  const SNAPSHOT_INTERVAL = 5 * 60 * 1000;
  const lastSnapshotTime = state.lastSnapshot ? new Date(state.lastSnapshot).getTime() : 0;
  if (now.getTime() - lastSnapshotTime > SNAPSHOT_INTERVAL || !state.lastSnapshot) {
    state.snapshot = await fetchAllSnapshotData();
    state.lastSnapshot = now.toISOString();
  }

  // Fetch XTB Morning Commentary every hour (or on refresh)
  const lastXtbTime = state.lastXtb ? new Date(state.lastXtb).getTime() : 0;
  if (now.getTime() - lastXtbTime > XTB_CHECK_INTERVAL || !state.lastXtb || refreshRequested) {
    const xtbData = await fetchXTBMorningCommentary();
    if (xtbData) {
      state.xtb = xtbData;
      state.lastXtb = now.toISOString();
    }
  }

  // Fetch Ken Fisher / Fisher Investments every 4 hours (or on refresh)
  const lastFisherTime = state.lastFisher ? new Date(state.lastFisher).getTime() : 0;
  if (now.getTime() - lastFisherTime > FISHER_CHECK_INTERVAL || !state.lastFisher || refreshRequested) {
    const fisherData = await fetchKenFisherInsights();
    if (fisherData) {
      state.fisher = fisherData;
      state.lastFisher = now.toISOString();
    }
  }

  // Fetch watchlist stocks every 4 hours (or on refresh)
  const lastWatchlistTime = state.lastWatchlist ? new Date(state.lastWatchlist).getTime() : 0;
  if (now.getTime() - lastWatchlistTime > WATCHLIST_CHECK_INTERVAL || !state.lastWatchlist || refreshRequested) {
    const watchlistData = await analyzeWatchlistStocks();
    if (watchlistData) {
      state.watchlist = watchlistData;
      state.lastWatchlist = now.toISOString();
    }
  }

  // Check Liquity position every 2 minutes
  const lastLiquityTime = state.lastLiquity ? new Date(state.lastLiquity).getTime() : 0;
  if (now.getTime() - lastLiquityTime > LIQUITY_CHECK_INTERVAL || !state.lastLiquity) {
    const prevDebtInFront = state.liquity?.debtInFront;
    const liquityData = await fetchLiquityPosition();
    if (liquityData) {
      // Also fetch redemption analysis
      const redemptionAnalysis = await fetchLiquityRedemptionData();
      if (redemptionAnalysis) {
        liquityData.redemptionAnalysis = redemptionAnalysis;
      }
      await checkLiquityAlert(liquityData, prevDebtInFront);
      state.liquity = liquityData;
      state.lastLiquity = now.toISOString();
    }
  }

  state.lastCheck = now.toISOString();
  state.activity = (state.activity || []).slice(0, 100);
  
  // Build live feed from all sources
  state.liveFeed = buildLiveFeed(state);
  
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
      xtb: state.xtb,
      fisher: state.fisher,
      watchlist: state.watchlist,
      liquity: state.liquity,
      liveFeed: state.liveFeed,
      lastCheck: state.lastCheck, 
      lastSummary: state.lastSummary,
      lastNansen: state.lastNansen,
      lastSnapshot: state.lastSnapshot,
      lastXtb: state.lastXtb,
      lastFisher: state.lastFisher,
      lastWatchlist: state.lastWatchlist,
      lastLiquity: state.lastLiquity,
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
