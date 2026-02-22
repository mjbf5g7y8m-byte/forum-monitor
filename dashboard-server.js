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

  // ============ SECTION: Market Overview ============
  const marketHtml = `
    <div class="section-card market-section">
      <div class="section-summary">
        <div class="section-icon">📊</div>
        <div class="section-info">
          <div class="section-title">Market Overview</div>
          <div class="section-stats">
            ${mo.sp500 ? `<span class="stat">S&P ${formatPrice(mo.sp500.price)} <em class="${changeClass(mo.sp500.change24h)}">${formatChange(mo.sp500.change24h)}</em></span>` : ''}
            ${mo.nasdaq ? `<span class="stat">NDX ${formatPrice(mo.nasdaq.price)} <em class="${changeClass(mo.nasdaq.change24h)}">${formatChange(mo.nasdaq.change24h)}</em></span>` : ''}
            ${ethPrice ? `<span class="stat">ETH $${formatPrice(ethPrice)}</span>` : ''}
            ${gnoPrice ? `<span class="stat">GNO $${gnoPrice.usd?.toFixed(0)} <em class="eth-sub">${formatEth(gnoPrice.eth)} Ξ</em></span>` : ''}
          </div>
        </div>
        <div class="section-right">
          <span class="countdown" id="countdown">60s</span>
        </div>
      </div>
    </div>`;

  // ============ SECTION: M2 vs S&P 500 ============
  let m2Html = '';
  if (m2sp500.m2?.length > 1 && m2sp500.sp500tr?.length > 1) {
    const m2Data = m2sp500.m2;
    const spData = m2sp500.sp500tr;
    const m2First = m2Data[0].value;
    const spFirst = spData[0].value;

    // Build aligned indexed series (both start at 100)
    const m2Indexed = m2Data.map(p => ({ date: p.date, value: (p.value / m2First) * 100 }));
    const spIndexed = spData.map(p => ({ date: p.date, value: (p.value / spFirst) * 100 }));

    // SVG dual-line chart
    const chartW = 560, chartH = 200, pad = 4;
    const allVals = [...m2Indexed.map(p => p.value), ...spIndexed.map(p => p.value)];
    const minV = Math.min(...allVals);
    const maxV = Math.max(...allVals);
    const rangeV = maxV - minV || 1;

    const toPath = (series, color) => {
      if (series.length < 2) return '';
      const stepX = (chartW - pad * 2) / (series.length - 1);
      const pts = series.map((p, i) => {
        const x = (pad + i * stepX).toFixed(1);
        const y = (chartH - pad - ((p.value - minV) / rangeV) * (chartH - pad * 2)).toFixed(1);
        return `${i === 0 ? 'M' : 'L'}${x},${y}`;
      }).join(' ');
      return `<path d="${pts}" fill="none" stroke="${color}" stroke-width="2"/>`;
    };

    const m2Path = toPath(m2Indexed, '#f59e0b');
    const spPath = toPath(spIndexed, '#3b82f6');

    const m2Latest = m2Data[m2Data.length - 1].value;
    const m2Yoy = m2sp500.m2YoY;
    const m2G = m2sp500.m2Growth;
    const spG = m2sp500.sp500Growth;
    const spBeatsM2 = parseFloat(spG) > parseFloat(m2G);

    const firstDate = m2Data[0].date;
    const lastDate = m2Data[m2Data.length - 1].date;

    m2Html = `
    <div class="section-card" data-section="m2sp500">
      <div class="section-summary" onclick="toggleSection('m2sp500')">
        <div class="section-icon">💵</div>
        <div class="section-info">
          <div class="section-title">M2 vs S&P 500 Total Return</div>
          <div class="section-stats">
            <span class="stat" style="color:var(--y)">M2 $${(m2Latest / 1000).toFixed(1)}T</span>
            ${m2Yoy ? `<span class="stat ${parseFloat(m2Yoy) > 0 ? 'up' : 'down'}">YoY ${m2Yoy}%</span>` : ''}
            <span class="stat" style="color:var(--y)">5y +${m2G}%</span>
            <span class="stat" style="color:var(--b)">S&P TR 5y +${spG}%</span>
            <span class="stat ${spBeatsM2 ? 'up' : 'down'}">${spBeatsM2 ? 'S&P vede' : 'M2 vede'}</span>
          </div>
        </div>
        <div class="section-right"><span class="expand-icon">▼</span></div>
      </div>
      <div class="section-details">
        <div class="m2-chart-wrap">
          <svg viewBox="0 0 ${chartW} ${chartH}" class="m2-chart">
            ${m2Path}
            ${spPath}
          </svg>
          <div class="m2-chart-legend">
            <span class="m2-legend-item" style="color:var(--y)">● M2 Money Supply</span>
            <span class="m2-legend-item" style="color:var(--b)">● S&P 500 Total Return</span>
          </div>
          <div class="m2-chart-labels">
            <span>${firstDate.substring(0, 7)}</span>
            <span>Indexed to 100 at start</span>
            <span>${lastDate.substring(0, 7)}</span>
          </div>
        </div>
        <div class="detail-grid" style="margin-top:12px">
          <div class="detail-item"><span class="label">M2 Money Supply</span><span class="value" style="color:var(--y)">$${(m2Latest / 1000).toFixed(2)}T</span></div>
          <div class="detail-item"><span class="label">M2 5-Year Growth</span><span class="value">+${m2G}%</span></div>
          ${m2Yoy ? `<div class="detail-item"><span class="label">M2 Year-over-Year</span><span class="value ${parseFloat(m2Yoy) > 0 ? '' : 'alert'}">${m2Yoy}%</span></div>` : ''}
          <div class="detail-item"><span class="label">S&P 500 TR 5-Year</span><span class="value" style="color:var(--b)">+${spG}%</span></div>
        </div>
        <div class="detail-meta">Data: FRED (M2SL) + Yahoo Finance (^SP500TR) | Updated: ${m2sp500.updated ? timeAgo(m2sp500.updated) : 'N/A'}</div>
      </div>
    </div>`;
  }

  // ============ SECTION: Watchlist ============
  const rawWl = data.watchlist;
  const watchlist = Array.isArray(rawWl) ? rawWl : Array.isArray(rawWl?.stocks) ? rawWl.stocks : Object.values(rawWl || {});
  const watchlistBulls = watchlist.filter(s => s.sentiment === 'bullish').length;
  const watchlistBears = watchlist.filter(s => s.sentiment === 'bearish').length;
  const bigMovers = watchlist.filter(s => Math.abs(parseFloat(s.priceChange)) >= 3).slice(0, 3);
  
  let watchlistHtml = '';
  if (watchlist.length > 0) {
    watchlistHtml = `
    <div class="section-card" data-section="watchlist">
      <div class="section-summary" onclick="toggleSection('watchlist')">
        <div class="section-icon">📈</div>
        <div class="section-info">
          <div class="section-title">Watchlist <span class="badge">${watchlist.length}</span></div>
          <div class="section-stats">
            <span class="stat bull">🐂 ${watchlistBulls}</span>
            <span class="stat bear">🐻 ${watchlistBears}</span>
            ${bigMovers.map(s => `<span class="stat mover ${parseFloat(s.priceChange) > 0 ? 'up' : 'down'}">${s.ticker} ${s.priceChange}</span>`).join('')}
          </div>
        </div>
        <div class="section-right">
          <span class="expand-icon">▼</span>
        </div>
      </div>
      <div class="section-details">
        <div class="stock-grid">
          ${watchlist.map(s => {
            const pctChange = parseFloat(s.priceChange) || 0;
            const isHot = Math.abs(pctChange) >= 5;
            const sentimentIcon = s.sentiment === 'bullish' ? '🐂' : s.sentiment === 'bearish' ? '🐻' : '➡️';
            return `
            <div class="stock-card ${s.sentiment}" onclick="toggleStock('${s.ticker}')">
              <div class="stock-header">
                <span class="stock-ticker">${escapeHtml(s.ticker)}</span>
                <span class="stock-sentiment">${sentimentIcon}</span>
              </div>
              <div class="stock-price">${escapeHtml(s.price || 'N/A')}</div>
              <div class="stock-change ${changeClass(pctChange)}">${escapeHtml(s.priceChange || '')} ${isHot ? (pctChange > 0 ? '🔥' : '⚠️') : ''}</div>
              <div class="stock-name">${escapeHtml(s.name?.substring(0, 20) || '')}</div>
              <div class="stock-details" id="stock-${s.ticker}">
                ${s.souhrn ? `<div class="stock-detail-item"><strong>Souhrn:</strong> ${escapeHtml(s.souhrn)}</div>` : ''}
                ${s.actionItem ? `<div class="stock-detail-item highlight">💡 ${escapeHtml(s.actionItem)}</div>` : ''}
                ${(s.recentNews24h || []).slice(0, 2).map(n => `<div class="stock-news ${n.dopad}">${escapeHtml(n.titulek)}</div>`).join('')}
                <div class="stock-meta">P/E: ${s.pe || 'N/A'} | MCap: ${s.marketCap || 'N/A'}</div>
              </div>
            </div>`;
          }).join('')}
        </div>
      </div>
    </div>`;
  }

  // ============ SECTION: XTB Morning Commentary ============
  const xtb = data.xtb || {};
  const xtbAnalysis = xtb.analysis || {};
  const xtbTopics = xtbAnalysis.temata || [];
  let xtbHtml = '';
  if (xtb.video?.title) {
    const keyPoints = xtbTopics.slice(0, 3).map(t => t.nazev).join(' • ');
    xtbHtml = `
    <div class="section-card" data-section="xtb">
      <div class="section-summary" onclick="toggleSection('xtb')">
        <div class="section-icon">📺</div>
        <div class="section-info">
          <div class="section-title">XTB Ranní Komentář <span class="badge new">DNES</span></div>
          <div class="section-stats">
            <span class="stat">${xtbTopics.length} témat</span>
            <span class="stat preview">${escapeHtml(keyPoints.substring(0, 60))}...</span>
          </div>
        </div>
        <div class="section-right">
          <a href="${escapeHtml(xtb.video?.url || '')}" target="_blank" class="action-btn" onclick="event.stopPropagation()">▶️</a>
          <span class="expand-icon">▼</span>
        </div>
      </div>
      <div class="section-details">
        ${xtbAnalysis.celkovySouhrn ? `<div class="detail-summary">${escapeHtml(xtbAnalysis.celkovySouhrn)}</div>` : ''}
        <div class="topics-list">
          ${xtbTopics.map(t => {
            const sentColor = t.sentiment === 'bullish' ? 'bull' : t.sentiment === 'bearish' ? 'bear' : '';
            return `
            <div class="topic-item ${sentColor}" onclick="toggleTopic(this)">
              <div class="topic-header">
                <span class="topic-icon">${escapeHtml(t.ikona || '📌')}</span>
                <span class="topic-name">${escapeHtml(t.nazev)}</span>
                <span class="topic-time">${t.casovyRozsah || ''}</span>
              </div>
              <div class="topic-content">
                ${(t.klicoveBody || []).map(b => `<div class="key-point">• ${escapeHtml(b)}</div>`).join('')}
                ${t.citat ? `<div class="quote">"${escapeHtml(t.citat)}"</div>` : ''}
              </div>
            </div>`;
          }).join('')}
        </div>
      </div>
    </div>`;
  }

  // ============ SECTION: Ken Fisher ============
  const fisher = data.fisher || {};
  const fisherVideos = fisher.videos || [];
  let fisherHtml = '';
  if (fisherVideos.length > 0) {
    const avgImportance = (fisherVideos.reduce((a, v) => a + (parseInt(v.dulezitost) || v.importance || 3), 0) / fisherVideos.length).toFixed(1);
    const fisherSentiment = fisher.summary?.overallSentiment;
    fisherHtml = `
    <div class="section-card" data-section="fisher">
      <div class="section-summary" onclick="toggleSection('fisher')">
        <div class="section-icon">🎣</div>
        <div class="section-info">
          <div class="section-title">Ken Fisher Insights ${fisherSentiment === 'bullish' ? '<span class="badge" style="background:#22c55e;color:#000">🐂 BULL</span>' : fisherSentiment === 'bearish' ? '<span class="badge" style="background:#ef4444;color:#fff">🐻 BEAR</span>' : ''}</div>
          <div class="section-stats">
            <span class="stat">${fisherVideos.length} videí</span>
            <span class="stat">★ ${avgImportance}</span>
            <span class="stat preview">${escapeHtml((fisherVideos[0]?.videoTitle || fisherVideos[0]?.title || '').substring(0, 40))}...</span>
          </div>
        </div>
        <div class="section-right"><span class="expand-icon">▼</span></div>
      </div>
      <div class="section-details">
        ${fisherVideos.map(v => {
          const title = v.videoTitle || v.title || '';
          const url = v.videoUrl || v.url || '';
          const imp = parseInt(v.dulezitost) || v.importance || 3;
          const mainThesis = v.hlavniTeze || v.analysis?.celkovySouhrn || '';
          const signals = v.signaly || v.analysis?.klicoveBody || [];
          const quotes = v.klicoveCitaty || [];
          return `
          <div class="fisher-video" onclick="toggleTopic(this)">
            <div class="topic-header">
              <span class="topic-icon">${'★'.repeat(Math.min(imp, 5))}</span>
              <span class="topic-name">${escapeHtml(title.substring(0, 50))}</span>
              <a href="${escapeHtml(url)}" target="_blank" class="action-btn" onclick="event.stopPropagation()">▶️</a>
            </div>
            <div class="topic-content">
              ${mainThesis ? `<div class="summary-text">${escapeHtml(mainThesis)}</div>` : ''}
              ${signals.slice(0, 3).map(b => `<div class="key-point">• ${escapeHtml(b)}</div>`).join('')}
              ${quotes.length > 0 ? `<div class="quote">"${escapeHtml(quotes[0])}"</div>` : ''}
            </div>
          </div>`;
        }).join('')}
      </div>
    </div>`;
  }

  // ============ SECTION: Liquity DeFi ============
  const liquity = data.liquity || {};
  let liquityHtml = '';
  if (liquity.debtInFront != null || liquity.interestRate != null) {
    const debtM = (liquity.debtInFront / 1e6).toFixed(1);
    const isAlert = liquity.debtInFront < 30000000;
    const ra = liquity.redemptionAnalysis || {};
    liquityHtml = `
    <div class="section-card ${isAlert ? 'alert' : ''}" data-section="liquity">
      <div class="section-summary" onclick="toggleSection('liquity')">
        <div class="section-icon">🏦</div>
        <div class="section-info">
          <div class="section-title">Liquity V2 ${isAlert ? '<span class="badge alert">⚠️ LOW</span>' : ''}</div>
          <div class="section-stats">
            <span class="stat">Debt: ${debtM}M</span>
            <span class="stat">Úrok: ${liquity.interestRate?.toFixed(1) || '?'}%</span>
            ${ra.lastRedemptionRate ? `<span class="stat">Last Redemp: ${ra.lastRedemptionRate.toFixed(2)}%</span>` : ''}
          </div>
        </div>
        <div class="section-right">
          <a href="https://app.defisaver.com/liquity-v2" target="_blank" class="action-btn" onclick="event.stopPropagation()">↗</a>
          <span class="expand-icon">▼</span>
        </div>
      </div>
      <div class="section-details">
        <div class="detail-grid">
          <div class="detail-item"><span class="label">Debt in Front</span><span class="value ${isAlert ? 'alert' : ''}">${debtM}M BOLD</span></div>
          <div class="detail-item"><span class="label">Úroková sazba</span><span class="value">${liquity.interestRate?.toFixed(2) || '?'}%</span></div>
          ${liquity.cr ? `<div class="detail-item"><span class="label">Collateral Ratio</span><span class="value">${liquity.cr.toFixed(0)}%</span></div>` : ''}
          ${ra.lastRedemptionRate ? `<div class="detail-item"><span class="label">Poslední redemption</span><span class="value">${ra.lastRedemptionRate.toFixed(2)}% (${ra.lastRedemptionTimeAgo || '?'})</span></div>` : ''}
        </div>
        <div class="detail-meta">Updated: ${timeAgo(liquity.updated)}</div>
      </div>
    </div>`;
  }

  // ============ SECTION: Forums ============
  const forumUrls = { gnosis: 'https://forum.gnosis.io', cow: 'https://forum.cow.fi', safe: 'https://forum.safe.global', stakewise: 'https://forum.stakewise.io', wnxm: 'https://forum.nexusmutual.io', aave: 'https://governance.aave.com' };
  
  let forumsHtml = `
    <div class="section-card" data-section="forums">
      <div class="section-summary" onclick="toggleSection('forums')">
        <div class="section-icon">💬</div>
        <div class="section-info">
          <div class="section-title">DAO Forums <span class="badge">${Object.keys(FORUMS).length}</span></div>
          <div class="section-stats">
            ${Object.entries(FORUMS).map(([id, cfg]) => {
              const p = prices[cfg.coingecko];
              const change = p?.usd_24h_change || 0;
              const ethPr = p?.eth;
              return `<span class="stat ${changeClass(change)}">${cfg.icon} ${ethPr != null ? formatEth(ethPr) + 'Ξ' : ''} ${formatChange(change)}</span>`;
            }).join('')}
          </div>
        </div>
        <div class="section-right"><span class="expand-icon">▼</span></div>
      </div>
      <div class="section-details">
        <div class="forums-grid">
          ${Object.entries(FORUMS).map(([id, cfg]) => {
            const forum = data.forums[id] || {};
            const topics = Object.values(forum.topics || {}).sort((a, b) => new Date(b.last_posted_at) - new Date(a.last_posted_at)).slice(0, 3);
            const price = prices[cfg.coingecko];
            const change = price?.usd_24h_change || 0;
            const tokenSnapshot = snapshot[id] || {};
            const activeVotes = tokenSnapshot.proposals || [];
            const summary = summaries[id];
            
            const ethPr = price?.eth;
            const chartHtml = generateEthChart(cfg.coingecko);
            
            return `
            <div class="forum-card" style="--accent:${cfg.color}" onclick="this.classList.toggle('expanded')">
              <div class="forum-header">
                <span class="forum-icon">${cfg.icon}</span>
                <span class="forum-name">${cfg.name}</span>
                <span class="forum-price ${changeClass(change)}">$${price?.usd?.toFixed(2) || '?'} ${formatChange(change)}</span>
              </div>
              ${ethPr != null ? `<div class="forum-eth-price">${formatEth(ethPr)} Ξ</div>` : ''}
              ${activeVotes.length > 0 ? `<div class="forum-votes">🗳️ ${activeVotes.length} active vote${activeVotes.length > 1 ? 's' : ''}</div>` : ''}
              ${summary ? `<div class="ai-summary"><span class="ai-label">🤖 AI</span> ${escapeHtml(summary.text)}</div>` : ''}
              <div class="forum-topics">
                ${topics.map(t => `<a href="${forumUrls[id]}/t/${t.slug}/${t.id}" target="_blank" class="forum-topic">${escapeHtml(t.title?.substring(0, 50))}</a>`).join('')}
              </div>
              <div class="forum-chart-area">${chartHtml}</div>
            </div>`;
          }).join('')}
        </div>
      </div>
    </div>`;

  // ============ SECTION: Live Feed ============
  const liveFeed = data.liveFeed || [];
  const feedHtml = `
    <div class="section-card open" data-section="feed">
      <div class="section-summary feed-sidebar-header">
        <div class="section-icon">📡</div>
        <div class="section-info">
          <div class="section-title">Activity <span class="badge live">LIVE</span> <span class="badge">${liveFeed.length}</span></div>
        </div>
      </div>
      <div class="section-details">
        <div class="feed-list">
          ${liveFeed.slice(0, 30).map(item => {
            const catClass = item.category || 'forum';
            return `
            <a href="${escapeHtml(item.link || item.url || '#')}" target="_blank" class="feed-item ${catClass}">
              <span class="feed-icon">${escapeHtml(item.icon || '📌')}</span>
              <span class="feed-title">${escapeHtml(item.title?.substring(0, 60) || '')}</span>
              <span class="feed-time">${timeAgo(item.time || item.timestamp)}</span>
            </a>`;
          }).join('')}
        </div>
      </div>
    </div>`;

  // Generate full HTML
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(`<!DOCTYPE html><html lang="cs"><head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Dashboard</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
:root{--bg:#0a0a0a;--card:#111;--border:#222;--t:#fff;--t2:#999;--t3:#666;--g:#22c55e;--r:#ef4444;--b:#3b82f6;--p:#a855f7;--y:#f59e0b}
body{font-family:-apple-system,system-ui,sans-serif;background:var(--bg);color:var(--t);padding:16px;min-height:100vh}
.container{max-width:1600px;margin:0 auto}

/* 3-Column Layout */
.dashboard-grid{display:grid;grid-template-columns:1fr 1fr 340px;gap:16px}
.col-left,.col-mid{display:flex;flex-direction:column;gap:12px;min-width:0}
.dashboard-grid .section-card{margin-bottom:0}
.col-right{display:flex;flex-direction:column;gap:12px;position:sticky;top:16px;align-self:start;max-height:calc(100vh - 100px)}
.col-right .section-card{margin-bottom:0}
.col-right .section-details{display:block!important}
.col-right .feed-list{max-height:calc(100vh - 200px)}

/* Header */
.header{display:flex;justify-content:space-between;align-items:center;margin-bottom:20px;padding:12px 16px;background:var(--card);border-radius:12px;border:1px solid var(--border)}
.header h1{font-size:20px;font-weight:600}
.header-right{display:flex;gap:12px;align-items:center}
.view-switcher{display:flex;gap:4px;background:#1a1a1a;padding:4px;border-radius:8px}
.view-btn{padding:6px 12px;border:none;background:transparent;color:var(--t2);font-size:12px;cursor:pointer;border-radius:6px;transition:all 0.2s}
.view-btn.active{background:var(--b);color:#fff}
.refresh-btn{padding:8px 14px;background:var(--b);border:none;color:#fff;font-size:12px;font-weight:600;cursor:pointer;border-radius:8px}
.refresh-btn:hover{filter:brightness(1.1)}

/* Section Cards */
.section-card{background:var(--card);border:1px solid var(--border);border-radius:12px;margin-bottom:12px;overflow:hidden}
.section-card.alert{border-color:var(--r);background:rgba(239,68,68,0.1)}
.section-summary{display:flex;align-items:center;gap:12px;padding:14px 16px;cursor:pointer;transition:background 0.2s}
.section-summary:hover{background:rgba(255,255,255,0.03)}
.section-icon{font-size:20px;width:32px;text-align:center}
.section-info{flex:1;min-width:0}
.section-title{font-size:14px;font-weight:600;display:flex;align-items:center;gap:8px}
.section-stats{display:flex;flex-wrap:wrap;gap:8px;margin-top:4px;font-size:12px;color:var(--t2)}
.section-stats .stat{display:inline-flex;align-items:center;gap:4px}
.section-stats .stat em{font-style:normal}
.section-stats .stat.up,.section-stats .stat.bull{color:var(--g)}
.section-stats .stat.down,.section-stats .stat.bear{color:var(--r)}
.section-stats .stat.mover{padding:2px 6px;border-radius:4px;font-weight:600}
.section-stats .stat.mover.up{background:rgba(34,197,94,0.2)}
.section-stats .stat.mover.down{background:rgba(239,68,68,0.2)}
.section-stats .preview{color:var(--t3);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:300px}
.section-right{display:flex;align-items:center;gap:10px}
.expand-icon{font-size:10px;color:var(--t3);transition:transform 0.2s}
.section-card.open .expand-icon{transform:rotate(180deg)}
.action-btn{padding:4px 10px;background:var(--b);color:#fff;text-decoration:none;border-radius:6px;font-size:11px;font-weight:600}
.action-btn:hover{filter:brightness(1.2)}

/* Badges */
.badge{font-size:10px;padding:2px 6px;border-radius:4px;background:#333;color:var(--t2)}
.badge.new{background:var(--g);color:#000}
.badge.live{background:var(--r);color:#fff;animation:pulse 2s infinite}
.badge.alert{background:var(--r);color:#fff}
@keyframes pulse{0%,100%{opacity:1}50%{opacity:0.6}}

/* Section Details */
.section-details{display:none;padding:0 16px 16px;border-top:1px solid var(--border)}
.section-card.open .section-details{display:block}
.detail-summary{padding:12px;background:#0a0a0a;border-radius:8px;font-size:13px;line-height:1.6;margin-top:12px;border-left:3px solid var(--p)}

/* Stock Grid */
.stock-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:10px;margin-top:12px}
.stock-card{background:#0a0a0a;border-radius:10px;padding:12px;cursor:pointer;transition:all 0.2s;border:1px solid transparent}
.stock-card:hover{border-color:var(--border)}
.stock-card.bullish{border-left:3px solid var(--g)}
.stock-card.bearish{border-left:3px solid var(--r)}
.stock-header{display:flex;justify-content:space-between;align-items:center;margin-bottom:6px}
.stock-ticker{font-weight:700;font-size:14px}
.stock-sentiment{font-size:14px}
.stock-price{font-size:18px;font-weight:700}
.stock-change{font-size:12px;font-weight:600}
.stock-change.up{color:var(--g)}
.stock-change.down{color:var(--r)}
.stock-name{font-size:11px;color:var(--t3);margin-top:4px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.stock-details{display:none;margin-top:10px;padding-top:10px;border-top:1px solid var(--border);font-size:11px}
.stock-card.open .stock-details{display:block}
.stock-detail-item{margin-bottom:6px;line-height:1.5}
.stock-detail-item.highlight{color:var(--y);background:rgba(245,158,11,0.1);padding:6px 8px;border-radius:6px}
.stock-news{padding:4px 0;border-left:2px solid var(--t3);padding-left:8px;margin:4px 0}
.stock-news.pozitivní{border-color:var(--g)}
.stock-news.negativní{border-color:var(--r)}
.stock-meta{color:var(--t3);margin-top:8px}

/* Topics */
.topics-list{display:flex;flex-direction:column;gap:6px;margin-top:12px}
.topic-item,.fisher-video{background:#0a0a0a;border-radius:8px;overflow:hidden}
.topic-header{display:flex;align-items:center;gap:8px;padding:10px 12px;cursor:pointer}
.topic-icon{font-size:14px}
.topic-name{flex:1;font-size:13px;font-weight:500}
.topic-time{font-size:10px;color:var(--t3);background:#1a1a1a;padding:2px 6px;border-radius:4px}
.topic-content{display:none;padding:0 12px 12px;font-size:12px}
.topic-item.open .topic-content,.fisher-video.open .topic-content{display:block}
.topic-item.bull{border-left:3px solid var(--g)}
.topic-item.bear{border-left:3px solid var(--r)}
.key-point{color:var(--t2);margin:4px 0;line-height:1.5}
.quote{font-style:italic;color:var(--p);padding:8px;background:rgba(168,85,247,0.1);border-radius:6px;margin-top:8px}

/* Detail Grid */
.detail-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:10px;margin-top:12px}
.detail-item{background:#0a0a0a;padding:10px 12px;border-radius:8px}
.detail-item .label{display:block;font-size:10px;color:var(--t3);text-transform:uppercase;margin-bottom:4px}
.detail-item .value{font-size:14px;font-weight:600}
.detail-item .value.alert{color:var(--r)}
.detail-meta{font-size:11px;color:var(--t3);margin-top:12px;text-align:right}

/* Forums Grid */
.forums-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:12px;margin-top:12px}
.forum-card{background:#0a0a0a;border-radius:10px;padding:14px;border-left:3px solid var(--accent,#333)}
.forum-header{display:flex;align-items:center;gap:8px;margin-bottom:8px}
.forum-icon{font-size:18px}
.forum-name{font-weight:600;flex:1}
.forum-price{font-size:12px;font-weight:600}
.forum-price.up{color:var(--g)}
.forum-price.down{color:var(--r)}
.forum-votes{font-size:11px;color:var(--b);margin-bottom:6px}
.ai-summary{font-size:12px;color:var(--t);line-height:1.6;margin-bottom:10px;padding:10px 12px;background:rgba(168,85,247,0.08);border-left:3px solid var(--p);border-radius:0 8px 8px 0}
.ai-label{font-size:10px;font-weight:700;color:var(--p);text-transform:uppercase;margin-right:4px}
.forum-topics{display:flex;flex-direction:column;gap:4px}
.forum-topic{font-size:11px;color:var(--t);text-decoration:none;padding:6px 8px;background:#111;border-radius:4px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.forum-topic:hover{background:#1a1a1a}
.forum-eth-price{font-size:11px;color:var(--p);margin-bottom:6px;font-weight:500}
.forum-chart-area{display:none;margin-top:10px;padding-top:10px;border-top:1px solid var(--border)}
.forum-card.expanded .forum-chart-area{display:block}
.eth-chart-container{background:#0a0a0a;border-radius:8px;padding:10px 12px}
.eth-chart-header{display:flex;justify-content:space-between;align-items:center;margin-bottom:6px}
.eth-chart-label{font-size:10px;color:var(--t3);text-transform:uppercase;font-weight:600}
.eth-chart-change{font-size:12px;font-weight:700}
.eth-chart-change.up{color:var(--g)}
.eth-chart-change.down{color:var(--r)}
.eth-chart{width:100%;height:auto;display:block}
.eth-chart-labels{display:flex;justify-content:space-between;font-size:9px;color:var(--t3);margin-top:4px}
.eth-sub{font-style:normal;font-size:10px;color:var(--p);margin-left:4px}

/* M2 Chart */
.m2-chart-wrap{background:#0a0a0a;border-radius:8px;padding:14px}
.m2-chart{width:100%;height:auto;display:block}
.m2-chart-legend{display:flex;gap:16px;justify-content:center;margin-top:10px;font-size:11px;font-weight:600}
.m2-legend-item{display:flex;align-items:center;gap:4px}
.m2-chart-labels{display:flex;justify-content:space-between;font-size:9px;color:var(--t3);margin-top:6px}

/* Feed */
.feed-sidebar-header{cursor:default;border-bottom:1px solid var(--border)}
.feed-sidebar-header:hover{background:transparent}
.feed-list{display:flex;flex-direction:column;gap:6px;margin-top:12px;max-height:400px;overflow-y:auto}
.feed-item{display:flex;align-items:center;gap:10px;padding:10px 12px;background:#0a0a0a;border-radius:8px;text-decoration:none;color:var(--t);transition:background 0.2s;border-left:3px solid var(--border)}
.feed-item:hover{background:#1a1a1a}
.feed-item.forum{border-left-color:var(--b)}
.feed-item.analysis{border-left-color:var(--p)}
.feed-item.price{border-left-color:var(--y)}
.feed-item.governance{border-left-color:var(--p)}
.feed-item.defi{border-left-color:var(--g)}
.feed-icon{font-size:14px}
.feed-title{flex:1;font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.feed-time{font-size:10px;color:var(--t3)}

/* Market section special */
.market-section{background:linear-gradient(135deg,rgba(59,130,246,0.1),transparent)}
.market-section .section-summary{cursor:default}
.countdown{font-size:14px;font-weight:700;color:var(--b);background:rgba(59,130,246,0.2);padding:4px 10px;border-radius:6px}

/* Compact View */
.view-compact .section-details{display:none!important}
.view-compact .section-card.open .section-details{display:block!important}

/* List View */
.view-list .section-card{margin-bottom:2px;border-radius:0}
.view-list .section-card:first-child{border-radius:12px 12px 0 0}
.view-list .section-card:last-child{border-radius:0 0 12px 12px}
.view-list .section-summary{padding:10px 16px}
.view-list .section-icon{font-size:16px;width:24px}
.view-list .section-title{font-size:13px}
.view-list .section-stats{font-size:11px}

/* Responsive */
@media(max-width:1200px){
  .dashboard-grid{grid-template-columns:1fr 1fr;gap:12px}
  .col-right{position:static;max-height:none;grid-column:1/-1}
  .col-right .feed-list{max-height:400px}
}
@media(max-width:768px){
  .dashboard-grid{grid-template-columns:1fr}
  .section-stats .preview{display:none}
  .stock-grid{grid-template-columns:repeat(2,1fr)}
  .forums-grid{grid-template-columns:1fr}
}
</style>
</head>
<body>
<div class="container">
  <div class="header">
    <h1>📊 Dashboard</h1>
    <div class="header-right">
      <div class="view-switcher">
        <button class="view-btn active" onclick="setView('compact')">Compact</button>
        <button class="view-btn" onclick="setView('list')">List</button>
        <button class="view-btn" onclick="setView('expanded')">Expanded</button>
      </div>
      <button class="refresh-btn" onclick="requestRefresh()">🔄 Refresh</button>
    </div>
  </div>
  
  <div id="content" class="view-compact">
    ${marketHtml}
    <div class="dashboard-grid">
      <div class="col-left">
        ${forumsHtml}
        ${m2Html}
      </div>
      <div class="col-mid">
        ${watchlistHtml}
        ${xtbHtml}
        ${fisherHtml}
        ${liquityHtml}
      </div>
      <div class="col-right">
        ${feedHtml}
      </div>
    </div>
  </div>
</div>

<script>
// View switching
function setView(view) {
  const content = document.getElementById('content');
  content.className = 'view-' + view;
  document.querySelectorAll('.view-btn').forEach(b => b.classList.remove('active'));
  event.target.classList.add('active');
  localStorage.setItem('dashboardView', view);
  
  if (view === 'expanded') {
    document.querySelectorAll('.section-card').forEach(s => s.classList.add('open'));
  } else if (view === 'compact') {
    document.querySelectorAll('.section-card').forEach(s => s.classList.remove('open'));
  }
}

// Section toggle
function toggleSection(id) {
  const section = document.querySelector('[data-section="' + id + '"]');
  if (section) section.classList.toggle('open');
}

// Stock toggle
function toggleStock(ticker) {
  event.stopPropagation();
  const card = event.currentTarget;
  card.classList.toggle('open');
}

// Topic toggle
function toggleTopic(el) {
  el.classList.toggle('open');
}

// Refresh
async function requestRefresh() {
  try {
    await fetch('/api/refresh', { method: 'POST' });
    location.reload();
  } catch (e) {}
}

// Countdown
let countdown = 60;
function updateCountdown() {
  const el = document.getElementById('countdown');
  if (el) el.textContent = countdown + 's';
  if (countdown <= 0) location.reload();
  else { countdown--; setTimeout(updateCountdown, 1000); }
}
updateCountdown();

// Restore view
const savedView = localStorage.getItem('dashboardView') || 'compact';
if (savedView !== 'compact') {
  document.getElementById('content').className = 'view-' + savedView;
  document.querySelectorAll('.view-btn').forEach(b => {
    b.classList.toggle('active', b.textContent.toLowerCase() === savedView);
  });
  if (savedView === 'expanded') {
    document.querySelectorAll('.section-card').forEach(s => s.classList.add('open'));
  }
}
</script>
</body></html>`);
});

app.listen(PORT, () => console.log(`Dashboard: http://localhost:${PORT}`));
