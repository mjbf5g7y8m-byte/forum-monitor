const express = require('express');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;
const path = require('path');
const DATA_FILE = path.join(__dirname, 'data.json');
const API_KEY = process.env.API_KEY || 'gnosis-monitor-key-2026';

const FORUMS = {
  gnosis: { name: 'Gnosis', symbol: 'GNO', icon: '🦉', color: '#3e6957', coingecko: 'gnosis' },
  cow: { name: 'CoW Protocol', symbol: 'COW', icon: '🐮', color: '#012f7a', coingecko: 'cow-protocol' },
  safe: { name: 'Safe', symbol: 'SAFE', icon: '🔐', color: '#12ff80', coingecko: 'safe' },
  stakewise: { name: 'StakeWise', symbol: 'SWISE', icon: '🥩', color: '#6b5ce7', coingecko: 'stakewise' },
  wnxm: { name: 'Nexus Mutual', symbol: 'wNXM', icon: '🛡️', color: '#1aab9b', coingecko: 'wrapped-nxm' },
  aave: { name: 'Aave', symbol: 'AAVE', icon: '👻', color: '#b6509e', coingecko: 'aave' }
};

app.use(express.json({ limit: '5mb' }));

function loadData() {
  try { if (fs.existsSync(DATA_FILE)) return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')); } catch (e) {}
  return { forums: {}, prices: {}, activity: [], summaries: {}, snapshot: {}, lastCheck: null, lastPush: null, refreshRequested: false };
}

function saveData(data) { fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2)); }
function escapeHtml(str) { return str ? str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;') : ''; }
function shortAddr(addr) { return addr ? `${addr.slice(0, 6)}...${addr.slice(-4)}` : ''; }
function timeAgo(isoStr) {
  if (!isoStr) return 'N/A';
  const mins = Math.floor((Date.now() - new Date(isoStr).getTime()) / 60000);
  if (mins < 1) return 'teď';
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d`;
  return `${Math.floor(days / 7)}w`;
}
function formatTimeLeft(endTimestamp) {
  const now = Date.now() / 1000;
  const diff = endTimestamp - now;
  if (diff < 0) return 'Skončilo';
  const hours = Math.floor(diff / 3600);
  const days = Math.floor(hours / 24);
  if (days > 0) return `${days}d ${hours % 24}h`;
  return hours > 0 ? `${hours}h` : `${Math.floor(diff / 60)}m`;
}

// API endpoints
app.post('/api/push', (req, res) => {
  if (req.headers['x-api-key'] !== API_KEY) return res.status(401).json({ error: 'Unauthorized' });
  const { forums, prices, activity, summaries, snapshot, xtb, fisher, watchlist, liquity, liveFeed, marketOverview, tokenEthHistory, m2sp500, lastCheck, lastSummary, lastSnapshot, lastXtb, lastFisher, lastWatchlist, lastLiquity, geminiModel } = req.body;
  const data = loadData();
  const wasRefreshRequested = data.refreshRequested || false;
  if (forums) data.forums = forums;
  if (prices) data.prices = prices;
  if (activity) data.activity = activity;
  if (summaries) data.summaries = summaries;
  if (snapshot) data.snapshot = snapshot;
  if (xtb) data.xtb = xtb;
  if (fisher) data.fisher = fisher;
  if (watchlist) data.watchlist = watchlist;
  if (liquity) data.liquity = liquity;
  if (liveFeed) data.liveFeed = liveFeed;
  if (marketOverview) data.marketOverview = marketOverview;
  if (tokenEthHistory) data.tokenEthHistory = tokenEthHistory;
  if (m2sp500) data.m2sp500 = m2sp500;
  if (lastCheck) data.lastCheck = lastCheck;
  if (lastSummary) data.lastSummary = lastSummary;
  if (lastSnapshot) data.lastSnapshot = lastSnapshot;
  if (lastXtb) data.lastXtb = lastXtb;
  if (lastFisher) data.lastFisher = lastFisher;
  if (lastWatchlist) data.lastWatchlist = lastWatchlist;
  if (lastLiquity) data.lastLiquity = lastLiquity;
  if (geminiModel) data.geminiModel = geminiModel;
  data.lastPush = new Date().toISOString();
  data.refreshRequested = false;
  saveData(data);
  res.json({ success: true, forums: Object.keys(forums || {}).length, refreshRequested: wasRefreshRequested });
});

app.post('/api/refresh', (req, res) => {
  const data = loadData();
  data.refreshRequested = true;
  data.refreshRequestedAt = new Date().toISOString();
  saveData(data);
  res.json({ success: true, message: 'Refresh requested' });
});

app.get('/api/check-refresh', (req, res) => {
  const data = loadData();
  const requested = data.refreshRequested || false;
  if (requested) { data.refreshRequested = false; saveData(data); }
  res.json({ refreshRequested: requested });
});

app.get('/api/data', (req, res) => res.json(loadData()));
app.get('/api/stats', (req, res) => {
  const d = loadData();
  res.json({ forums: Object.keys(d.forums).length, lastCheck: d.lastCheck, lastPush: d.lastPush, lastSummary: d.lastSummary, lastSnapshot: d.lastSnapshot, geminiModel: d.geminiModel });
});
app.get('/health', (req, res) => res.json({ status: 'ok', timestamp: new Date().toISOString() }));

// Dashboard
app.get('/', (req, res) => {
  const data = loadData();
  const prices = data.prices?.data || {};
  const summaries = data.summaries || {};
  const snapshot = data.snapshot || {};
  const m2sp500 = data.m2sp500 || {};
  const mo = data.marketOverview || {};
  const geminiModel = data.geminiModel || 'unknown';
  const gnoPrice = prices.gnosis;
  const ethPrice = prices.ethereum?.usd || 0;
  const tokenHistory = data.tokenEthHistory?.data || {};

  // Helper functions for view generation
  const formatPrice = (p) => p ? (p > 1000 ? p.toFixed(0).replace(/\B(?=(\d{3})+(?!\d))/g, ',') : p.toFixed(2)) : 'N/A';
  const formatEth = (p) => p != null ? (p >= 1 ? p.toFixed(2) : p >= 0.001 ? p.toFixed(4) : p.toFixed(6)) : '?';
  const formatChange = (c) => c != null ? `${c > 0 ? '+' : ''}${c.toFixed(1)}%` : '';
  const changeClass = (c) => c > 0 ? 'up' : c < 0 ? 'down' : '';

  // SVG sparkline chart generator for token/ETH history
  function generateEthChart(tokenId, width = 280, height = 80) {
    const points = tokenHistory[tokenId];
    if (!points || points.length < 10) return '';
    
    const vals = points.map(p => p[1]);
    const min = Math.min(...vals);
    const max = Math.max(...vals);
    const range = max - min || 1;
    
    // Generate SVG path
    const stepX = width / (vals.length - 1);
    const pathPoints = vals.map((v, i) => {
      const x = (i * stepX).toFixed(1);
      const y = (height - 4 - ((v - min) / range) * (height - 8)).toFixed(1);
      return `${i === 0 ? 'M' : 'L'}${x},${y}`;
    }).join(' ');
    
    // Color based on trend (first vs last)
    const isUp = vals[vals.length - 1] >= vals[0];
    const color = isUp ? '#22c55e' : '#ef4444';
    const change12m = ((vals[vals.length - 1] - vals[0]) / vals[0] * 100).toFixed(1);
    
    // Date labels
    const firstDate = new Date(points[0][0]);
    const lastDate = new Date(points[points.length - 1][0]);
    const fmtDate = (d) => `${d.getMonth() + 1}/${d.getFullYear().toString().slice(2)}`;
    
    return `
      <div class="eth-chart-container">
        <div class="eth-chart-header">
          <span class="eth-chart-label">vs ETH (12m)</span>
          <span class="eth-chart-change ${isUp ? 'up' : 'down'}">${isUp ? '+' : ''}${change12m}%</span>
        </div>
        <svg viewBox="0 0 ${width} ${height}" class="eth-chart">
          <defs>
            <linearGradient id="grad-${tokenId}" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stop-color="${color}" stop-opacity="0.3"/>
              <stop offset="100%" stop-color="${color}" stop-opacity="0"/>
            </linearGradient>
          </defs>
          <path d="${pathPoints} L${width},${height} L0,${height} Z" fill="url(#grad-${tokenId})" />
          <path d="${pathPoints}" fill="none" stroke="${color}" stroke-width="1.5"/>
          <circle cx="${width}" cy="${(height - 4 - ((vals[vals.length - 1] - min) / range) * (height - 8)).toFixed(1)}" r="2.5" fill="${color}"/>
        </svg>
        <div class="eth-chart-labels">
          <span>${fmtDate(firstDate)}</span>
          <span>Now: ${formatEth(vals[vals.length - 1])} ETH</span>
          <span>${fmtDate(lastDate)}</span>
        </div>
      </div>`;
  }

  // ============ DATA EXTRACTION ============
  const summaryEntries = Object.entries(summaries).filter(([id, s]) => s?.text && s.text.length > 10);
  const rawWl = data.watchlist;
  const watchlist = Array.isArray(rawWl) ? rawWl : Array.isArray(rawWl?.stocks) ? rawWl.stocks : Object.values(rawWl || {});
  const watchlistBulls = watchlist.filter(s => s.sentiment === 'bullish').length;
  const watchlistBears = watchlist.filter(s => s.sentiment === 'bearish').length;
  const xtb = data.xtb || {};
  const xtbAnalysis = xtb.analysis || {};
  const xtbTopics = xtbAnalysis.temata || [];
  const fisher = data.fisher || {};
  const fisherVideos = fisher.videos || [];
  const liquity = data.liquity || {};
  const liveFeed = data.liveFeed || [];

  // ============ PRE-BUILD BENTO SECTIONS ============
  const now = new Date();
  const greeting = now.getHours() < 12 ? 'Dobré ráno' : now.getHours() < 18 ? 'Dobré odpoledne' : 'Dobrý večer';
  const dateStr = now.toLocaleDateString('cs-CZ', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

  // KPI row
  const kpiCards = [];
  if (mo.sp500) kpiCards.push('<div class="kpi-card"><div class="kpi-label">S&amp;P 500</div><div class="kpi-value">' + formatPrice(mo.sp500.price) + '</div><div class="kpi-sub ' + changeClass(mo.sp500.change24h) + '">' + formatChange(mo.sp500.change24h) + '</div></div>');
  if (mo.nasdaq) kpiCards.push('<div class="kpi-card"><div class="kpi-label">NASDAQ</div><div class="kpi-value">' + formatPrice(mo.nasdaq.price) + '</div><div class="kpi-sub ' + changeClass(mo.nasdaq.change24h) + '">' + formatChange(mo.nasdaq.change24h) + '</div></div>');
  if (ethPrice) kpiCards.push('<div class="kpi-card"><div class="kpi-label">Ethereum</div><div class="kpi-value">$' + formatPrice(ethPrice) + '</div></div>');
  if (gnoPrice) kpiCards.push('<div class="kpi-card"><div class="kpi-label">GNO</div><div class="kpi-value">$' + (gnoPrice.usd?.toFixed(0)||'?') + '</div><div class="kpi-sub" style="color:var(--purple)">' + formatEth(gnoPrice.eth) + ' Ξ</div></div>');

  // Watchlist bento card
  let watchlistBentoHtml = '';
  if (watchlist.length > 0) {
    const stockCards = watchlist.map(s => {
      const pctChange = parseFloat(s.priceChange) || 0;
      const isHot = Math.abs(pctChange) >= 5;
      const sentimentIcon = s.sentiment === 'bullish' ? '🐂' : s.sentiment === 'bearish' ? '🐻' : '➡️';
      const newsHtml = (s.recentNews24h||[]).slice(0,2).map(n => '<div class="stock-news ' + (n.dopad||'') + '">' + escapeHtml(n.titulek||'') + '</div>').join('');
      return '<div class="stock-card ' + (s.sentiment||'') + '" onclick="event.stopPropagation();this.classList.toggle(\'open\')">'
        + '<div class="stock-header"><span class="stock-ticker">' + escapeHtml(s.ticker) + '</span><span class="stock-sentiment">' + sentimentIcon + '</span></div>'
        + '<div class="stock-price">' + escapeHtml(s.price || 'N/A') + '</div>'
        + '<div class="stock-change ' + changeClass(pctChange) + '">' + escapeHtml(s.priceChange || '') + (isHot ? (pctChange>0?' 🔥':' ⚠️') : '') + '</div>'
        + '<div class="stock-name">' + escapeHtml(s.name?.substring(0,20)||'') + '</div>'
        + '<div class="stock-details">'
        + (s.souhrn ? '<div class="stock-detail-item"><strong>Souhrn:</strong> ' + escapeHtml(s.souhrn) + '</div>' : '')
        + (s.actionItem ? '<div class="stock-detail-item highlight">💡 ' + escapeHtml(s.actionItem) + '</div>' : '')
        + newsHtml
        + '<div class="stock-meta">P/E: ' + (s.pe||'N/A') + ' | MCap: ' + (s.marketCap||'N/A') + '</div>'
        + '</div></div>';
    }).join('');
    watchlistBentoHtml = '<div class="bento-card span-8 open" data-section="watchlist">'
      + '<div class="card-head" onclick="toggleCard(this)"><div class="card-head-left"><span class="card-icon">📈</span><span class="card-title">Watchlist</span><span class="card-badge count">' + watchlist.length + '</span></div>'
      + '<div class="card-head-right"><span class="card-stat bull">🐂 ' + watchlistBulls + '</span><span class="card-stat bear">🐻 ' + watchlistBears + '</span><span class="card-toggle">▼</span></div></div>'
      + '<div class="card-body"><div class="stock-grid">' + stockCards + '</div></div></div>';
  }

  // M2 bento card
  let m2BentoHtml = '';
  if (m2sp500.m2?.length > 1 && m2sp500.sp500tr?.length > 1) {
    const m2Data = m2sp500.m2, spData = m2sp500.sp500tr;
    const m2First = m2Data[0].value, spFirst = spData[0].value;
    const m2Indexed = m2Data.map(p => ({ date: p.date, value: (p.value / m2First) * 100 }));
    const spIndexed = spData.map(p => ({ date: p.date, value: (p.value / spFirst) * 100 }));
    const cW = 460, cH = 160, pad = 4;
    const allV = [...m2Indexed.map(p=>p.value),...spIndexed.map(p=>p.value)];
    const mnV = Math.min(...allV), mxV = Math.max(...allV), rng = mxV - mnV || 1;
    const mkP = (s,c) => { if(s.length<2) return ''; const sx=(cW-pad*2)/(s.length-1); return '<path d="'+s.map((p,i)=>{const x=(pad+i*sx).toFixed(1);const y=(cH-pad-((p.value-mnV)/rng)*(cH-pad*2)).toFixed(1);return (i===0?'M':'L')+x+','+y;}).join(' ')+'" fill="none" stroke="'+c+'" stroke-width="2"/>'; };
    const m2Latest = m2Data[m2Data.length-1].value;
    const m2G = (((m2Latest - m2First)/m2First)*100).toFixed(1);
    const spG = (((spData[spData.length-1].value - spFirst)/spFirst)*100).toFixed(1);
    let m2YoY = '';
    if (m2Data.length >= 13) { const prev = m2Data[m2Data.length-13].value; m2YoY = (((m2Latest-prev)/prev)*100).toFixed(1); }

    kpiCards.push('<div class="kpi-card"><div class="kpi-label">M2 Supply</div><div class="kpi-value">$' + (m2Latest/1000).toFixed(1) + 'T</div>' + (m2YoY ? '<div class="kpi-sub ' + (parseFloat(m2YoY)>0?'up':'down') + '">YoY ' + m2YoY + '%</div>' : '') + '</div>');
    kpiCards.push('<div class="kpi-card"><div class="kpi-label">S&amp;P TR 5y</div><div class="kpi-value">+' + spG + '%</div></div>');

    m2BentoHtml = '<div class="bento-card span-4 open" data-section="m2">'
      + '<div class="card-head" onclick="toggleCard(this)"><div class="card-head-left"><span class="card-icon">💵</span><span class="card-title">M2 vs S&amp;P 500 TR</span></div><div class="card-head-right"><span class="card-toggle">▼</span></div></div>'
      + '<div class="card-body"><div class="m2-wrap">'
      + '<svg viewBox="0 0 ' + cW + ' ' + cH + '" class="m2-chart">' + mkP(m2Indexed,'#f59e0b') + mkP(spIndexed,'#818cf8') + '</svg>'
      + '<div class="m2-legend"><span style="color:var(--amber)">● M2 Money Supply</span><span style="color:var(--accent2)">● S&amp;P 500 TR</span></div>'
      + '<div class="m2-labels"><span>' + m2Data[0].date.substring(0,7) + '</span><span>Indexed 100</span><span>' + m2Data[m2Data.length-1].date.substring(0,7) + '</span></div>'
      + '</div>'
      + '<div class="metric-row">'
      + '<div class="metric-box"><div class="label">M2 5Y Growth</div><div class="val glow-amber">+' + m2G + '%</div></div>'
      + '<div class="metric-box"><div class="label">S&amp;P TR 5Y</div><div class="val glow-blue">+' + spG + '%</div></div>'
      + (m2YoY ? '<div class="metric-box"><div class="label">M2 YoY</div><div class="val">' + m2YoY + '%</div></div>' : '')
      + '</div>'
      + '<div class="meta-line">FRED M2SL + Yahoo ^SP500TR | ' + (m2sp500.updated ? timeAgo(m2sp500.updated) : '') + '</div>'
      + '</div></div>';
  }

  // AI Overview bento
  let aiBentoHtml = '';
  if (summaryEntries.length > 0) {
    const aiCards = summaryEntries.map(([id, summary]) => {
      const cfg = FORUMS[id]; if(!cfg) return '';
      const price = prices[cfg.coingecko]; const change = price?.usd_24h_change || 0;
      return '<div class="ai-card" style="--accent:' + cfg.color + '"><div class="ai-card-head"><span>' + cfg.icon + ' ' + cfg.name + '</span><span class="card-stat ' + changeClass(change) + '">' + formatChange(change) + '</span></div><div class="ai-card-text">' + escapeHtml(summary.text) + '</div><div class="ai-card-meta">' + (summary.topics||0) + ' topics | ' + timeAgo(summary.generated) + '</div></div>';
    }).join('');
    aiBentoHtml = '<div class="section-group" id="group-ai"><div class="section-group-title">AI Insights</div><div class="bento">'
      + '<div class="bento-card span-12 always-open"><div class="card-head"><div class="card-head-left"><span class="card-icon">🤖</span><span class="card-title">AI Overview</span><span class="card-badge count">' + summaryEntries.length + ' fór</span></div></div>'
      + '<div class="card-body"><div class="ai-grid">' + aiCards + '</div></div></div></div></div>';
  }

  // Liquity bento
  let liquityBentoHtml = '';
  if (liquity.debtInFront != null) {
    const debtM = (liquity.debtInFront / 1e6).toFixed(1);
    const isLow = liquity.debtInFront < 30000000;
    const ra = liquity.redemptionAnalysis || {};
    liquityBentoHtml = '<div class="bento-card span-4' + (isLow?' alert-border':'') + '" data-section="liquity">'
      + '<div class="card-head" onclick="toggleCard(this)"><div class="card-head-left"><span class="card-icon">🏦</span><span class="card-title">Liquity V2</span>' + (isLow?'<span class="card-badge alert">⚠️ LOW</span>':'') + '</div>'
      + '<div class="card-head-right"><a href="https://app.defisaver.com/liquity-v2" target="_blank" class="card-link" onclick="event.stopPropagation()">DeFi Saver ↗</a><span class="card-toggle">▼</span></div></div>'
      + '<div class="card-stats"><span class="card-stat">Debt: ' + debtM + 'M</span><span class="card-stat">Úrok: ' + (liquity.interestRate?.toFixed(1)||'?') + '%</span>'
      + (ra.lastRedemptionRate ? '<span class="card-stat">Last Redemp: ' + ra.lastRedemptionRate.toFixed(2) + '%</span>' : '')
      + '</div>'
      + '<div class="card-body"><div class="detail-grid">'
      + '<div class="metric-box"><div class="label">Debt in Front</div><div class="val' + (isLow?' glow-red':'') + '">' + debtM + 'M</div></div>'
      + '<div class="metric-box"><div class="label">Interest Rate</div><div class="val">' + (liquity.interestRate?.toFixed(2)||'?') + '%</div></div>'
      + (liquity.cr ? '<div class="metric-box"><div class="label">Coll. Ratio</div><div class="val">' + liquity.cr.toFixed(0) + '%</div></div>' : '')
      + '</div><div class="meta-line">' + timeAgo(liquity.updated) + '</div></div></div>';
  }

  // Forums bento
  const forumUrls = { gnosis: 'https://forum.gnosis.io', cow: 'https://forum.cow.fi', safe: 'https://forum.safe.global', stakewise: 'https://forum.stakewise.io', wnxm: 'https://forum.nexusmutual.io', aave: 'https://governance.aave.com' };
  const forumStatChips = Object.entries(FORUMS).map(([id, cfg]) => {
    const p = prices[cfg.coingecko]; const change = p?.usd_24h_change || 0;
    return '<span class="card-stat ' + changeClass(change) + '">' + cfg.icon + ' ' + formatChange(change) + '</span>';
  }).join('');
  const forumCards = Object.entries(FORUMS).map(([id, cfg]) => {
    const forum = data.forums[id] || {};
    const topics = Object.values(forum.topics || {}).sort((a,b)=>new Date(b.last_posted_at)-new Date(a.last_posted_at)).slice(0,3);
    const price = prices[cfg.coingecko]; const change = price?.usd_24h_change || 0;
    const tokenSnapshot = snapshot[id] || {}; const activeVotes = tokenSnapshot.proposals || [];
    const summary = summaries[id]; const ethPr = price?.eth; const chartHtml = generateEthChart(cfg.coingecko);
    const topicsHtml = topics.map(t => '<a href="' + escapeHtml((forumUrls[id]||'') + '/t/' + t.slug + '/' + t.id) + '" target="_blank" class="forum-topic">' + escapeHtml(t.title?.substring(0,50)||'') + '</a>').join('');
    return '<div class="forum-card" style="--accent:' + cfg.color + '" onclick="this.classList.toggle(\'expanded\')">'
      + '<div class="forum-header"><span class="forum-icon">' + cfg.icon + '</span><span class="forum-name">' + cfg.name + '</span><span class="forum-price ' + changeClass(change) + '">$' + (price?.usd?.toFixed(2)||'?') + ' ' + formatChange(change) + '</span></div>'
      + (ethPr!=null ? '<div class="forum-eth-price">' + formatEth(ethPr) + ' Ξ</div>' : '')
      + (activeVotes.length>0 ? '<div class="forum-votes">🗳️ ' + activeVotes.length + ' active vote' + (activeVotes.length>1?'s':'') + '</div>' : '')
      + (summary ? '<div class="ai-summary"><span class="ai-label">🤖 AI</span> ' + escapeHtml(summary.text) + '</div>' : '')
      + '<div class="forum-topics">' + topicsHtml + '</div>'
      + '<div class="forum-chart-area">' + chartHtml + '</div></div>';
  }).join('');
  const forumsBentoHtml = '<div class="bento-card span-8" data-section="forums">'
    + '<div class="card-head" onclick="toggleCard(this)"><div class="card-head-left"><span class="card-icon">💬</span><span class="card-title">DAO Forums</span><span class="card-badge count">' + Object.keys(FORUMS).length + '</span></div><div class="card-head-right"><span class="card-toggle">▼</span></div></div>'
    + '<div class="card-stats">' + forumStatChips + '</div>'
    + '<div class="card-body"><div class="forums-grid">' + forumCards + '</div></div></div>';

  // XTB bento
  let xtbBentoHtml = '';
  if (xtb.video?.title) {
    const xtbTopicItems = xtbTopics.map(t => {
      const sc = t.sentiment==='bullish'?'bull':t.sentiment==='bearish'?'bear':'';
      const points = (t.klicoveBody||[]).map(b => '<div class="key-point">• ' + escapeHtml(b) + '</div>').join('');
      return '<div class="topic-item ' + sc + '" onclick="toggleTopic(this)"><div class="topic-header"><span class="topic-icon">' + escapeHtml(t.ikona||'📌') + '</span><span class="topic-name">' + escapeHtml(t.nazev||'') + '</span><span class="topic-time">' + (t.casovyRozsah||'') + '</span></div><div class="topic-content">' + points + (t.citat?'<div class="quote">"' + escapeHtml(t.citat) + '"</div>':'') + '</div></div>';
    }).join('');
    xtbBentoHtml = '<div class="bento-card span-6" data-section="xtb">'
      + '<div class="card-head" onclick="toggleCard(this)"><div class="card-head-left"><span class="card-icon">📺</span><span class="card-title">XTB Ranní Komentář</span><span class="card-badge new">DNES</span></div>'
      + '<div class="card-head-right"><a href="' + escapeHtml(xtb.video?.url||'') + '" target="_blank" class="card-link" onclick="event.stopPropagation()">▶️ Video</a><span class="card-toggle">▼</span></div></div>'
      + '<div class="card-stats"><span class="card-stat">' + xtbTopics.length + ' témat</span></div>'
      + '<div class="card-body">'
      + (xtbAnalysis.celkovySouhrn ? '<div class="detail-summary">' + escapeHtml(xtbAnalysis.celkovySouhrn) + '</div>' : '')
      + '<div class="topics-list">' + xtbTopicItems + '</div></div></div>';
  }

  // Fisher bento
  let fisherBentoHtml = '';
  if (fisherVideos.length > 0) {
    const fisherItems = fisherVideos.map(v => {
      const title = v.videoTitle||v.title||''; const url = v.videoUrl||v.url||'';
      const imp = parseInt(v.dulezitost)||v.importance||3; const thesis = v.hlavniTeze||v.analysis?.celkovySouhrn||'';
      const signals = v.signaly||v.analysis?.klicoveBody||[]; const quotes = v.klicoveCitaty||[];
      const stars = '★'.repeat(Math.min(imp,5));
      const sigHtml = signals.slice(0,3).map(b => '<div class="key-point">• ' + escapeHtml(b) + '</div>').join('');
      return '<div class="fisher-video" onclick="toggleTopic(this)"><div class="topic-header"><span class="topic-icon">' + stars + '</span><span class="topic-name">' + escapeHtml(title.substring(0,50)) + '</span><a href="' + escapeHtml(url) + '" target="_blank" class="card-link" onclick="event.stopPropagation()">▶️</a></div><div class="topic-content">' + (thesis?'<div class="detail-summary">' + escapeHtml(thesis) + '</div>':'') + sigHtml + (quotes.length>0?'<div class="quote">"' + escapeHtml(quotes[0]) + '"</div>':'') + '</div></div>';
    }).join('');
    const sentBadge = fisher.summary?.overallSentiment==='bullish' ? '<span class="card-badge" style="background:rgba(34,197,94,.2);color:var(--green)">BULL</span>' : fisher.summary?.overallSentiment==='bearish' ? '<span class="card-badge alert">BEAR</span>' : '';
    fisherBentoHtml = '<div class="bento-card span-6" data-section="fisher">'
      + '<div class="card-head" onclick="toggleCard(this)"><div class="card-head-left"><span class="card-icon">🎣</span><span class="card-title">Ken Fisher</span>' + sentBadge + '</div>'
      + '<div class="card-head-right"><span class="card-stat">' + fisherVideos.length + ' videí</span><span class="card-toggle">▼</span></div></div>'
      + '<div class="card-body"><div class="topics-list">' + fisherItems + '</div></div></div>';
  }

  // Feed items
  const feedItems = liveFeed.slice(0, 40).map(item => {
    const catClass = item.category || 'forum';
    return '<a href="' + escapeHtml(item.link||item.url||'#') + '" target="_blank" class="feed-item ' + catClass + '"><span class="feed-icon">' + escapeHtml(item.icon||'📌') + '</span><span class="feed-title">' + escapeHtml(item.title?.substring(0,60)||'') + '</span><span class="feed-time">' + timeAgo(item.time||item.timestamp) + '</span></a>';
  }).join('');

  // ============ GENERATE FINAL HTML ============
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(`<!DOCTYPE html><html lang="cs"><head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Command Center</title>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&display=swap" rel="stylesheet">
<style>
*{margin:0;padding:0;box-sizing:border-box}
:root{--bg:#060608;--surface:#0c0c10;--card:#12121a;--card-hover:#16161f;--border:#1e1e2a;--border-light:#2a2a3a;--t:#e8e8ed;--t2:#8888a0;--t3:#55556a;--accent:#6366f1;--accent2:#818cf8;--green:#22c55e;--red:#ef4444;--amber:#f59e0b;--cyan:#06b6d4;--purple:#a855f7;--rose:#f43f5e;--radius:10px;--radius-lg:14px}
body{font-family:'Inter',system-ui,sans-serif;background:var(--bg);color:var(--t);min-height:100vh;overflow-x:hidden}
::selection{background:var(--accent);color:#fff}
::-webkit-scrollbar{width:6px}
::-webkit-scrollbar-track{background:transparent}
::-webkit-scrollbar-thumb{background:var(--border);border-radius:3px}
.shell{display:flex;min-height:100vh}
.sidebar{width:64px;background:var(--surface);border-right:1px solid var(--border);display:flex;flex-direction:column;align-items:center;padding:16px 0;position:fixed;top:0;left:0;bottom:0;z-index:100}
.sidebar-logo{font-size:22px;margin-bottom:24px;cursor:default}
.nav-items{display:flex;flex-direction:column;gap:4px;flex:1}
.nav-item{width:44px;height:44px;display:flex;align-items:center;justify-content:center;border-radius:var(--radius);cursor:pointer;transition:all .2s;font-size:18px;color:var(--t3);position:relative}
.nav-item:hover{background:var(--card);color:var(--t2)}
.nav-item.active{background:rgba(99,102,241,.15);color:var(--accent)}
.nav-item.active::before{content:'';position:absolute;left:-8px;width:3px;height:20px;background:var(--accent);border-radius:0 3px 3px 0}
.nav-item .tooltip{display:none;position:absolute;left:56px;background:var(--card);border:1px solid var(--border);padding:6px 10px;border-radius:6px;font-size:11px;color:var(--t);white-space:nowrap;z-index:200}
.nav-item:hover .tooltip{display:block}
.nav-bottom{display:flex;flex-direction:column;gap:4px;align-items:center}
.main{margin-left:64px;flex:1;padding:20px 24px;max-width:1600px}
.topbar{display:flex;justify-content:space-between;align-items:center;margin-bottom:24px}
.topbar-left h1{font-size:22px;font-weight:600;letter-spacing:-.3px}
.topbar-left p{font-size:13px;color:var(--t2);margin-top:2px}
.topbar-right{display:flex;gap:10px;align-items:center}
.topbar-btn{padding:8px 14px;background:var(--card);border:1px solid var(--border);color:var(--t2);font-size:12px;font-weight:500;cursor:pointer;border-radius:8px;transition:all .2s;font-family:inherit}
.topbar-btn:hover{border-color:var(--accent);color:var(--t)}
.topbar-btn.primary{background:var(--accent);border-color:var(--accent);color:#fff}
.topbar-btn.primary:hover{filter:brightness(1.1)}
.countdown-pill{font-size:12px;font-weight:600;color:var(--accent);background:rgba(99,102,241,.12);padding:6px 12px;border-radius:8px}
.kpi-row{display:flex;gap:12px;margin-bottom:24px;overflow-x:auto;padding-bottom:4px}
.kpi-card{background:var(--card);border:1px solid var(--border);border-radius:var(--radius);padding:14px 18px;min-width:150px;flex-shrink:0;transition:border-color .2s}
.kpi-card:hover{border-color:var(--border-light)}
.kpi-label{font-size:10px;font-weight:600;color:var(--t3);text-transform:uppercase;letter-spacing:.5px;margin-bottom:6px}
.kpi-value{font-size:18px;font-weight:700;letter-spacing:-.3px}
.kpi-sub{font-size:11px;font-weight:600;margin-top:2px}
.kpi-sub.up{color:var(--green)}
.kpi-sub.down{color:var(--red)}
.section-group{margin-bottom:32px}
.section-group-title{font-size:11px;font-weight:700;color:var(--t3);text-transform:uppercase;letter-spacing:1.2px;margin-bottom:14px;padding-left:2px;display:flex;align-items:center;gap:8px}
.section-group-title::after{content:'';flex:1;height:1px;background:var(--border)}
.bento{display:grid;grid-template-columns:repeat(12,1fr);gap:14px}
.bento-card{background:var(--card);border:1px solid var(--border);border-radius:var(--radius-lg);overflow:hidden;transition:border-color .2s}
.bento-card:hover{border-color:var(--border-light)}
.bento-card.span-4{grid-column:span 4}
.bento-card.span-5{grid-column:span 5}
.bento-card.span-6{grid-column:span 6}
.bento-card.span-7{grid-column:span 7}
.bento-card.span-8{grid-column:span 8}
.bento-card.span-12{grid-column:span 12}
.bento-card.alert-border{border-color:rgba(239,68,68,.4)}
.card-head{display:flex;align-items:center;justify-content:space-between;padding:16px 18px 12px;cursor:pointer}
.card-head-left{display:flex;align-items:center;gap:10px}
.card-icon{font-size:16px}
.card-title{font-size:13px;font-weight:600}
.card-badge{font-size:9px;font-weight:700;padding:3px 7px;border-radius:4px;text-transform:uppercase;letter-spacing:.3px}
.card-badge.live{background:rgba(239,68,68,.2);color:var(--red);animation:pulse 2s infinite}
.card-badge.alert{background:rgba(239,68,68,.2);color:var(--red)}
.card-badge.count{background:rgba(99,102,241,.15);color:var(--accent2)}
.card-badge.new{background:rgba(34,197,94,.2);color:var(--green)}
.card-head-right{display:flex;align-items:center;gap:8px}
.card-toggle{font-size:10px;color:var(--t3);transition:transform .2s}
.bento-card.open .card-toggle{transform:rotate(180deg)}
.card-link{padding:4px 10px;background:rgba(99,102,241,.12);color:var(--accent);text-decoration:none;border-radius:6px;font-size:10px;font-weight:600}
.card-link:hover{background:rgba(99,102,241,.2)}
.card-body{padding:0 18px 16px}
.bento-card:not(.open):not(.always-open) .card-body{display:none}
.always-open .card-body{display:block}
.card-stats{display:flex;flex-wrap:wrap;gap:6px;padding:0 18px 14px;font-size:12px;color:var(--t2)}
.card-stat{display:inline-flex;align-items:center;gap:3px}
.card-stat em{font-style:normal}
.card-stat.up{color:var(--green)}
.card-stat.down{color:var(--red)}
@keyframes pulse{0%,100%{opacity:1}50%{opacity:.5}}
.ai-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:12px}
.ai-card{background:var(--surface);border-radius:var(--radius);padding:14px;border-left:3px solid var(--purple);transition:background .2s}
.ai-card:hover{background:var(--card-hover)}
.ai-card-head{display:flex;justify-content:space-between;align-items:center;margin-bottom:8px}
.ai-card-head span:first-child{font-weight:600;font-size:13px}
.ai-card-text{font-size:12px;line-height:1.7;color:var(--t)}
.ai-card-meta{font-size:10px;color:var(--t3);margin-top:8px}
.m2-wrap{background:var(--surface);border-radius:var(--radius);padding:16px}
.m2-chart{width:100%;height:auto;display:block}
.m2-legend{display:flex;gap:16px;justify-content:center;margin-top:10px;font-size:11px;font-weight:600}
.m2-legend span{display:flex;align-items:center;gap:5px}
.m2-labels{display:flex;justify-content:space-between;font-size:9px;color:var(--t3);margin-top:6px}
.metric-row{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:10px;margin-top:14px}
.metric-box{background:var(--surface);padding:10px 12px;border-radius:8px}
.metric-box .label{font-size:9px;color:var(--t3);text-transform:uppercase;letter-spacing:.4px;margin-bottom:3px}
.metric-box .val{font-size:15px;font-weight:700}
.metric-box .val.glow-amber{color:var(--amber)}
.metric-box .val.glow-blue{color:var(--accent2)}
.metric-box .val.glow-red{color:var(--red)}
.meta-line{font-size:10px;color:var(--t3);margin-top:12px;text-align:right}
.stock-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(155px,1fr));gap:10px}
.stock-card{background:var(--surface);border-radius:var(--radius);padding:12px;cursor:pointer;transition:background .2s;border-left:3px solid var(--border)}
.stock-card:hover{background:var(--card-hover)}
.stock-card.bullish{border-left-color:var(--green)}
.stock-card.bearish{border-left-color:var(--red)}
.stock-header{display:flex;justify-content:space-between;align-items:center;margin-bottom:5px}
.stock-ticker{font-weight:700;font-size:13px}
.stock-sentiment{font-size:13px}
.stock-price{font-size:17px;font-weight:700}
.stock-change{font-size:11px;font-weight:600}
.stock-change.up{color:var(--green)}
.stock-change.down{color:var(--red)}
.stock-name{font-size:10px;color:var(--t3);margin-top:3px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.stock-details{display:none;margin-top:10px;padding-top:10px;border-top:1px solid var(--border);font-size:11px}
.stock-card.open .stock-details{display:block}
.stock-detail-item{margin-bottom:5px;line-height:1.5}
.stock-detail-item.highlight{color:var(--amber);background:rgba(245,158,11,.08);padding:6px 8px;border-radius:6px}
.stock-news{padding:3px 0;border-left:2px solid var(--t3);padding-left:8px;margin:3px 0}
.stock-news.pozitivní{border-color:var(--green)}
.stock-news.negativní{border-color:var(--red)}
.stock-meta{color:var(--t3);margin-top:6px}
.topics-list{display:flex;flex-direction:column;gap:6px}
.topic-item,.fisher-video{background:var(--surface);border-radius:8px;overflow:hidden}
.topic-header{display:flex;align-items:center;gap:8px;padding:10px 12px;cursor:pointer}
.topic-icon{font-size:14px}
.topic-name{flex:1;font-size:12px;font-weight:500}
.topic-time{font-size:10px;color:var(--t3);background:var(--card);padding:2px 6px;border-radius:4px}
.topic-content{display:none;padding:0 12px 12px;font-size:12px}
.topic-item.open .topic-content,.fisher-video.open .topic-content{display:block}
.topic-item.bull{border-left:3px solid var(--green)}
.topic-item.bear{border-left:3px solid var(--red)}
.key-point{color:var(--t2);margin:4px 0;line-height:1.5}
.quote{font-style:italic;color:var(--purple);padding:8px;background:rgba(168,85,247,.08);border-radius:6px;margin-top:8px}
.detail-summary{padding:12px;background:var(--surface);border-radius:8px;font-size:12px;line-height:1.6;border-left:3px solid var(--purple);margin-bottom:10px}
.forums-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:12px}
.forum-card{background:var(--surface);border-radius:var(--radius);padding:14px;border-left:3px solid var(--accent,#333);cursor:pointer;transition:background .2s}
.forum-card:hover{background:var(--card-hover)}
.forum-header{display:flex;align-items:center;gap:8px;margin-bottom:6px}
.forum-icon{font-size:16px}
.forum-name{font-weight:600;font-size:13px;flex:1}
.forum-price{font-size:12px;font-weight:600}
.forum-price.up{color:var(--green)}
.forum-price.down{color:var(--red)}
.forum-votes{font-size:11px;color:var(--accent);margin-bottom:5px}
.forum-eth-price{font-size:10px;color:var(--purple);margin-bottom:4px;font-weight:500}
.ai-summary{font-size:11px;color:var(--t);line-height:1.6;margin-bottom:8px;padding:8px 10px;background:rgba(168,85,247,.06);border-left:2px solid var(--purple);border-radius:0 6px 6px 0}
.ai-label{font-size:9px;font-weight:700;color:var(--purple);text-transform:uppercase;margin-right:3px}
.forum-topics{display:flex;flex-direction:column;gap:3px}
.forum-topic{font-size:11px;color:var(--t2);text-decoration:none;padding:5px 8px;background:var(--card);border-radius:4px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;transition:color .2s}
.forum-topic:hover{color:var(--t)}
.forum-chart-area{display:none;margin-top:8px;padding-top:8px;border-top:1px solid var(--border)}
.forum-card.expanded .forum-chart-area{display:block}
.eth-chart-container{padding:8px}
.eth-chart-header{display:flex;justify-content:space-between;align-items:center;margin-bottom:4px}
.eth-chart-label{font-size:9px;color:var(--t3);text-transform:uppercase;font-weight:600}
.eth-chart-change{font-size:11px;font-weight:700}
.eth-chart-change.up{color:var(--green)}
.eth-chart-change.down{color:var(--red)}
.eth-chart{width:100%;height:auto;display:block}
.eth-chart-labels{display:flex;justify-content:space-between;font-size:8px;color:var(--t3);margin-top:3px}
.eth-sub{font-style:normal;font-size:9px;color:var(--purple);margin-left:3px}
.detail-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:8px}
.main-with-feed{display:grid;grid-template-columns:1fr 320px;gap:20px}
.feed-col{position:sticky;top:20px;align-self:start;max-height:calc(100vh - 40px);display:flex;flex-direction:column}
.feed-card{background:var(--card);border:1px solid var(--border);border-radius:var(--radius-lg);flex:1;display:flex;flex-direction:column;overflow:hidden}
.feed-head{padding:14px 16px;border-bottom:1px solid var(--border);display:flex;align-items:center;gap:8px}
.feed-head-title{font-size:13px;font-weight:600;flex:1}
.feed-body{flex:1;overflow-y:auto;padding:10px}
.feed-list{display:flex;flex-direction:column;gap:5px}
.feed-item{display:flex;align-items:center;gap:8px;padding:8px 10px;background:var(--surface);border-radius:8px;text-decoration:none;color:var(--t);transition:background .2s;border-left:2px solid var(--border)}
.feed-item:hover{background:var(--card-hover)}
.feed-item.forum{border-left-color:var(--accent)}
.feed-item.analysis{border-left-color:var(--purple)}
.feed-item.price{border-left-color:var(--amber)}
.feed-item.governance{border-left-color:var(--cyan)}
.feed-item.defi{border-left-color:var(--green)}
.feed-item.stocks{border-left-color:var(--rose)}
.feed-icon{font-size:13px}
.feed-title{flex:1;font-size:11px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.feed-time{font-size:9px;color:var(--t3);white-space:nowrap}
.placeholder-card{border:1px dashed var(--border);background:transparent;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:32px 20px;text-align:center;min-height:120px}
.placeholder-card .ph-icon{font-size:28px;margin-bottom:10px;opacity:.5}
.placeholder-card .ph-title{font-size:13px;font-weight:600;color:var(--t2);margin-bottom:4px}
.placeholder-card .ph-sub{font-size:11px;color:var(--t3)}
@media(max-width:1400px){.main-with-feed{grid-template-columns:1fr 280px}}
@media(max-width:1100px){
  .main-with-feed{grid-template-columns:1fr}
  .feed-col{position:static;max-height:500px}
  .bento-card.span-4,.bento-card.span-5{grid-column:span 6}
  .bento-card.span-7,.bento-card.span-8{grid-column:span 12}
}
@media(max-width:768px){
  .sidebar{display:none}
  .main{margin-left:0;padding:12px}
  .bento{gap:10px}
  .bento-card.span-4,.bento-card.span-5,.bento-card.span-6,.bento-card.span-7,.bento-card.span-8{grid-column:span 12}
  .kpi-row{gap:8px}
  .stock-grid{grid-template-columns:repeat(2,1fr)}
  .forums-grid{grid-template-columns:1fr}
  .ai-grid{grid-template-columns:1fr}
}
</style>
</head>
<body>
<div class="shell">
  <nav class="sidebar">
    <div class="sidebar-logo">⌘</div>
    <div class="nav-items">
      <div class="nav-item active" onclick="scrollToGroup('markets')">📊<span class="tooltip">Markets &amp; Macro</span></div>
      <div class="nav-item" onclick="scrollToGroup('ai')">🤖<span class="tooltip">AI Insights</span></div>
      <div class="nav-item" onclick="scrollToGroup('crypto')">💎<span class="tooltip">DeFi &amp; Crypto</span></div>
      <div class="nav-item" onclick="scrollToGroup('analysis')">📺<span class="tooltip">Analysis</span></div>
      <div class="nav-item" onclick="scrollToGroup('personal')">💰<span class="tooltip">Personal Finance</span></div>
      <div class="nav-item" onclick="scrollToGroup('geopolitics')">🌍<span class="tooltip">Geopolitics</span></div>
    </div>
    <div class="nav-bottom">
      <div class="nav-item" onclick="requestRefresh()">🔄<span class="tooltip">Refresh</span></div>
    </div>
  </nav>
  <div class="main">
    <div class="topbar">
      <div class="topbar-left"><h1>${greeting}</h1><p>${dateStr}</p></div>
      <div class="topbar-right"><span class="countdown-pill" id="countdown">60s</span><button class="topbar-btn primary" onclick="requestRefresh()">Refresh Data</button></div>
    </div>
    <div class="kpi-row">${kpiCards.join('')}</div>
    <div class="main-with-feed">
      <div class="content-col">
        <div class="section-group" id="group-markets">
          <div class="section-group-title">Markets &amp; Macro</div>
          <div class="bento">${watchlistBentoHtml}${m2BentoHtml}</div>
        </div>
        ${aiBentoHtml}
        <div class="section-group" id="group-crypto">
          <div class="section-group-title">DeFi &amp; Crypto</div>
          <div class="bento">${liquityBentoHtml}${forumsBentoHtml}</div>
        </div>
        <div class="section-group" id="group-analysis">
          <div class="section-group-title">Analysis &amp; Research</div>
          <div class="bento">${xtbBentoHtml}${fisherBentoHtml}</div>
        </div>
        <div class="section-group" id="group-personal">
          <div class="section-group-title">Personal Finance</div>
          <div class="bento">
            <div class="bento-card span-4 placeholder-card"><div class="ph-icon">💳</div><div class="ph-title">Výdaje &amp; Budget</div><div class="ph-sub">Měsíční přehled výdajů, kategorie, trendy</div></div>
            <div class="bento-card span-4 placeholder-card"><div class="ph-icon">📋</div><div class="ph-title">Daňový přehled</div><div class="ph-sub">Odhad daní, deadliny, přehledy</div></div>
            <div class="bento-card span-4 placeholder-card"><div class="ph-icon">🏠</div><div class="ph-title">Čistá hodnota</div><div class="ph-sub">Assets, liabilities, net worth tracker</div></div>
          </div>
        </div>
        <div class="section-group" id="group-geopolitics">
          <div class="section-group-title">Geopolitics &amp; World</div>
          <div class="bento">
            <div class="bento-card span-6 placeholder-card"><div class="ph-icon">🌍</div><div class="ph-title">Geopolitický přehled</div><div class="ph-sub">Klíčové události, konflikty, obchodní vztahy</div></div>
            <div class="bento-card span-6 placeholder-card"><div class="ph-icon">📰</div><div class="ph-title">Macro &amp; News Digest</div><div class="ph-sub">AI souhrn důležitých zpráv ze světa investování</div></div>
          </div>
        </div>
      </div>
      <div class="feed-col">
        <div class="feed-card">
          <div class="feed-head"><span style="font-size:14px">📡</span><span class="feed-head-title">Activity</span><span class="card-badge live">LIVE</span><span class="card-badge count">${liveFeed.length}</span></div>
          <div class="feed-body"><div class="feed-list">${feedItems}</div></div>
        </div>
      </div>
    </div>
  </div>
</div>
<script>
function toggleCard(h){h.closest('.bento-card').classList.toggle('open')}
function toggleSection(id){var s=document.querySelector('[data-section="'+id+'"]');if(s)s.classList.toggle('open')}
function toggleTopic(el){el.classList.toggle('open')}
function scrollToGroup(id){document.querySelectorAll('.nav-item').forEach(function(n){n.classList.remove('active')});event.currentTarget.classList.add('active');var el=document.getElementById('group-'+id);if(el)el.scrollIntoView({behavior:'smooth',block:'start'})}
function requestRefresh(){fetch('/api/refresh',{method:'POST'}).then(function(){location.reload()}).catch(function(){})}
var countdown=60;
function updateCountdown(){var el=document.getElementById('countdown');if(el)el.textContent=countdown+'s';if(countdown<=0)location.reload();else{countdown--;setTimeout(updateCountdown,1000)}}
updateCountdown();
var observer=new IntersectionObserver(function(entries){entries.forEach(function(e){if(e.isIntersecting){var id=e.target.id.replace('group-','');document.querySelectorAll('.nav-item').forEach(function(n){n.classList.remove('active')});var nav=document.querySelector('.nav-item[onclick*=\"'+id+'\"]');if(nav)nav.classList.add('active')}})},{threshold:0.3});
document.querySelectorAll('.section-group').forEach(function(g){observer.observe(g)});
</script>
</body></html>`);
});

app.listen(PORT, () => console.log(`Dashboard: http://localhost:${PORT}`));
