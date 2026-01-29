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
  wnxm: { name: 'Nexus Mutual', symbol: 'wNXM', icon: '🛡️', color: '#1aab9b', coingecko: 'wrapped-nxm' }
};

app.use(express.json({ limit: '5mb' }));

function loadData() {
  try { if (fs.existsSync(DATA_FILE)) return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')); } catch (e) {}
  return { forums: {}, prices: {}, activity: [], summaries: {}, nansen: {}, snapshot: {}, lastCheck: null, lastPush: null, refreshRequested: false };
}

function saveData(data) { fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2)); }
function escapeHtml(str) { return str ? str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;') : ''; }
function shortAddr(addr) { return addr ? `${addr.slice(0, 6)}...${addr.slice(-4)}` : ''; }
function timeAgo(isoStr) {
  if (!isoStr) return 'N/A';
  const mins = Math.floor((Date.now() - new Date(isoStr).getTime()) / 60000);
  if (mins < 1) return 'právě teď';
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d`;
  const weeks = Math.floor(days / 7);
  return `${weeks}w`;
}
function formatTimeLeft(endTimestamp) {
  const now = Date.now() / 1000;
  const diff = endTimestamp - now;
  if (diff < 0) return 'Ended';
  const hours = Math.floor(diff / 3600);
  const days = Math.floor(hours / 24);
  if (days > 0) return `${days}d ${hours % 24}h left`;
  if (hours > 0) return `${hours}h left`;
  return `${Math.floor(diff / 60)}m left`;
}

// API: Receive data from Mogra
app.post('/api/push', (req, res) => {
  if (req.headers['x-api-key'] !== API_KEY) return res.status(401).json({ error: 'Unauthorized' });
  const { forums, prices, activity, summaries, nansen, snapshot, xtb, fisher, watchlist, liquity, liveFeed, lastCheck, lastSummary, lastNansen, lastSnapshot, lastXtb, lastFisher, lastWatchlist, lastLiquity, geminiModel } = req.body;
  const data = loadData();
  const wasRefreshRequested = data.refreshRequested || false;
  if (forums) data.forums = forums;
  if (prices) data.prices = prices;
  if (activity) data.activity = activity;
  if (summaries) data.summaries = summaries;
  if (nansen) data.nansen = nansen;
  if (snapshot) data.snapshot = snapshot;
  if (xtb) data.xtb = xtb;
  if (fisher) data.fisher = fisher;
  if (watchlist) data.watchlist = watchlist;
  if (liquity) data.liquity = liquity;
  if (liveFeed) data.liveFeed = liveFeed;
  if (lastCheck) data.lastCheck = lastCheck;
  if (lastSummary) data.lastSummary = lastSummary;
  if (lastNansen) data.lastNansen = lastNansen;
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

// Manual refresh request
app.post('/api/refresh', (req, res) => {
  const data = loadData();
  data.refreshRequested = true;
  data.refreshRequestedAt = new Date().toISOString();
  saveData(data);
  res.json({ success: true, message: 'Refresh requested, will process on next check cycle (~1 min)' });
});

app.get('/api/check-refresh', (req, res) => {
  const data = loadData();
  const requested = data.refreshRequested || false;
  if (requested) {
    data.refreshRequested = false;
    saveData(data);
  }
  res.json({ refreshRequested: requested });
});

app.get('/api/data', (req, res) => res.json(loadData()));
app.get('/api/stats', (req, res) => {
  const d = loadData();
  res.json({ forums: Object.keys(d.forums).length, lastCheck: d.lastCheck, lastPush: d.lastPush, lastSummary: d.lastSummary, lastNansen: d.lastNansen, lastSnapshot: d.lastSnapshot, geminiModel: d.geminiModel });
});
app.get('/health', (req, res) => res.json({ status: 'ok', timestamp: new Date().toISOString() }));

// Dashboard
app.get('/', (req, res) => {
  const data = loadData();
  const prices = data.prices?.data || {};
  const summaries = data.summaries || {};
  const nansen = data.nansen || {};
  const snapshot = data.snapshot || {};
  const geminiModel = data.geminiModel || 'unknown';

  let cardsHtml = '';
  for (const [id, cfg] of Object.entries(FORUMS)) {
    const forum = data.forums[id] || {};
    const topics = Object.values(forum.topics || {}).sort((a, b) => new Date(b.last_posted_at) - new Date(a.last_posted_at)).slice(0, 5);
    const price = prices[cfg.coingecko];
    const change = price?.usd_24h_change || 0;
    const sentiment = forum.sentiment || {};
    const summary = summaries[id];
    const tokenNansen = nansen[id] || {};
    const tokenSnapshot = snapshot[id] || {};
    const activeVotes = tokenSnapshot.proposals || [];

    // Topics section
    const forumUrls = { gnosis: 'https://forum.gnosis.io', cow: 'https://forum.cow.fi', safe: 'https://forum.safe.global', stakewise: 'https://forum.stakewise.io', wnxm: 'https://forum.nexusmutual.io' };
    const forumUrl = forumUrls[id] || '';
    let topicsHtml = topics.length === 0 ? '' :
      `<div class="topics">${topics.map(t => `<a href="${forumUrl}/t/${t.slug}/${t.id}" target="_blank" class="topic">
        <span class="topic-title">${escapeHtml(t.title?.substring(0, 55))}</span>
        <span class="topic-meta"><span class="topic-time">🕐${timeAgo(t.last_posted_at)}</span> 💬${t.posts_count} 👁️${t.views}</span>
      </a>`).join('')}</div>`;

    const summaryHtml = summary ? `
      <details class="summary-accordion">
        <summary class="summary-toggle">
          <span>🤖 AI Shrnutí (${summary.topics || 0} témat)</span>
          <span class="toggle-icon">▼</span>
        </summary>
        <div class="summary-content">${escapeHtml(summary.text)}</div>
      </details>` : '';

    // Snapshot Voting
    const snapshotHtml = activeVotes.length > 0 ? `
      <details class="snapshot-accordion" open>
        <summary class="snapshot-toggle">
          <span>🗳️ Aktivní hlasování (${activeVotes.length})</span>
          <span class="toggle-icon">▼</span>
        </summary>
        <div class="snapshot-content">
          ${activeVotes.map(v => {
            const totalVotes = v.scores_total || 0;
            const leadingIdx = v.scores?.indexOf(Math.max(...(v.scores || [0]))) || 0;
            const leadingChoice = v.choices?.[leadingIdx] || '?';
            const leadingPct = totalVotes > 0 ? ((v.scores?.[leadingIdx] || 0) / totalVotes * 100).toFixed(1) : 0;
            return `
            <a href="${v.link}" target="_blank" class="vote-item">
              <div class="vote-title">${escapeHtml(v.title?.substring(0, 50))}</div>
              <div class="vote-meta">
                <span class="vote-leading">${escapeHtml(leadingChoice)}: ${leadingPct}%</span>
                <span class="vote-time">${formatTimeLeft(v.end)}</span>
              </div>
            </a>`;
          }).join('')}
        </div>
      </details>` : '';

    // Nansen Sells
    const sells = tokenNansen.sells || [];
    const sellsHtml = sells.length > 0 ? `
      <details class="nansen-accordion sells">
        <summary class="nansen-toggle">
          <span>📉 Top Prodeje (${sells.length})</span>
          <span class="toggle-icon">▼</span>
        </summary>
        <div class="nansen-content">
          ${sells.map(s => `
            <div class="nansen-item sell">
              <div class="nansen-main">
                <a href="https://etherscan.io/address/${s.address}" target="_blank" class="addr">${escapeHtml(s.label || shortAddr(s.address))}</a>
                <span class="amount">-${s.amount?.toFixed(2)} ${cfg.symbol}</span>
              </div>
              <div class="nansen-meta">
                <span class="value">$${s.value_usd?.toLocaleString('en-US', {maximumFractionDigits: 0}) || '?'}</span>
                <a href="https://etherscan.io/tx/${s.tx_hash}" target="_blank" class="tx-link">TX ↗</a>
              </div>
            </div>
          `).join('')}
          <div class="nansen-age">Data: ${timeAgo(tokenNansen.updated)}</div>
        </div>
      </details>` : '';

    // Nansen Buys
    const buys = tokenNansen.buys || [];
    const buysHtml = buys.length > 0 ? `
      <details class="nansen-accordion buys">
        <summary class="nansen-toggle buys-toggle">
          <span>📈 Top Nákupy (${buys.length})</span>
          <span class="toggle-icon">▼</span>
        </summary>
        <div class="nansen-content buys-content">
          ${buys.map(b => `
            <div class="nansen-item buy">
              <div class="nansen-main">
                <a href="https://etherscan.io/address/${b.address}" target="_blank" class="addr">${escapeHtml(b.label || shortAddr(b.address))}</a>
                <span class="amount buy-amount">+${b.amount?.toFixed(2)} ${cfg.symbol}</span>
              </div>
              <div class="nansen-meta">
                <span class="value">$${b.value_usd?.toLocaleString('en-US', {maximumFractionDigits: 0}) || '?'}</span>
                <a href="https://etherscan.io/tx/${b.tx_hash}" target="_blank" class="tx-link">TX ↗</a>
              </div>
            </div>
          `).join('')}
          <div class="nansen-age">Data: ${timeAgo(tokenNansen.updated)}</div>
        </div>
      </details>` : '';

    // Nansen Transfers
    const transfers = tokenNansen.transfers || [];
    const transfersHtml = transfers.length > 0 ? `
      <details class="nansen-accordion transfers">
        <summary class="nansen-toggle">
          <span>🔄 Top Transfery (${transfers.length})</span>
          <span class="toggle-icon">▼</span>
        </summary>
        <div class="nansen-content">
          ${transfers.map(t => `
            <div class="nansen-item transfer">
              <div class="nansen-main">
                <a href="https://etherscan.io/address/${t.from_address}" target="_blank" class="addr">${escapeHtml(t.from_label || shortAddr(t.from_address))}</a>
                <span class="arrow">→</span>
                <a href="https://etherscan.io/address/${t.to_address}" target="_blank" class="addr">${escapeHtml(t.to_label || shortAddr(t.to_address))}</a>
              </div>
              <div class="nansen-meta">
                <span class="amount">${t.amount?.toFixed(2)} ${cfg.symbol}</span>
                <span class="value">$${t.value_usd?.toLocaleString('en-US', {maximumFractionDigits: 0}) || '?'}</span>
                <a href="https://etherscan.io/tx/${t.tx_hash}" target="_blank" class="tx-link">TX ↗</a>
              </div>
            </div>
          `).join('')}
          <div class="nansen-age">Data: ${timeAgo(tokenNansen.updated)}</div>
        </div>
      </details>` : '';

    cardsHtml += `<div class="card" style="--accent:${cfg.color}">
      <div class="card-header">
        <div class="card-title"><span class="icon">${cfg.icon}</span>${cfg.name}</div>
        <div class="sentiment">${sentiment.mood || ''}</div>
      </div>
      <div class="price-row">
        <span class="price">$${price?.usd?.toFixed(3) || '—'}</span>
        <span class="change ${change >= 0 ? 'up' : 'down'}">${change >= 0 ? '+' : ''}${change.toFixed(1)}%</span>
      </div>
      <div class="symbol">${cfg.symbol}</div>
      ${snapshotHtml}
      ${summaryHtml}
      ${sellsHtml}
      ${buysHtml}
      ${transfersHtml}
      ${topicsHtml}
    </div>`;
  }

  const getForumUrl = (id) => {
    const urls = { gnosis: 'https://forum.gnosis.io', cow: 'https://forum.cow.fi', safe: 'https://forum.safe.global', stakewise: 'https://forum.stakewise.io', wnxm: 'https://forum.nexusmutual.io' };
    return urls[id] || '';
  };

  // Legacy activity HTML (for backwards compat)
  let activityHtml = (data.activity || []).slice(0, 8).map(a => {
    const forum = FORUMS[a.forumId] || {};
    const url = a.slug && a.topicId ? `${getForumUrl(a.forumId)}/t/${a.slug}/${a.topicId}` : '';
    return `<a href="${url}" target="_blank" class="activity-item ${a.type}">
      <span class="activity-icon">${a.type === 'new' ? '🆕' : '💬'}</span>
      <span class="activity-forum">${forum.icon || ''}</span>
      <span class="activity-title">${escapeHtml(a.title?.substring(0, 45))}</span>
      <span class="activity-time">${a.time?.substring(11, 16) || ''}</span>
    </a>`;
  }).join('') || '<div class="no-data">No recent activity</div>';

  // Live Feed HTML
  const liveFeed = data.liveFeed || [];
  const categoryColors = {
    forum: '#60a5fa',      // blue
    price: '#f59e0b',      // amber
    analysis: '#a855f7',   // purple
    defi: '#22c55e',       // green
    stocks: '#3b82f6',     // blue
    governance: '#8b5cf6', // violet
    nansen: '#f59e0b'      // amber (same as price for token movements)
  };
  
  let liveFeedHtml = liveFeed.slice(0, 25).map(item => {
    const catColor = categoryColors[item.category] || '#888';
    const timeStr = item.time ? timeAgo(item.time) : '';
    const linkAttr = item.link ? `href="${item.link}" target="_blank"` : '';
    const isAlert = item.type?.includes('alert') || item.type?.includes('down');
    
    return `<a ${linkAttr} class="feed-item feed-${item.category || 'default'} ${isAlert ? 'feed-alert' : ''}">
      <span class="feed-icon">${item.icon || '📌'}</span>
      <div class="feed-content">
        <span class="feed-title">${escapeHtml(item.title || '')}</span>
        <span class="feed-subtitle">${escapeHtml(item.subtitle || '')}</span>
      </div>
      <div class="feed-meta">
        <span class="feed-category" style="background:${catColor}">${item.category || ''}</span>
        <span class="feed-time">${timeStr}</span>
      </div>
    </a>`;
  }).join('') || '<div class="no-data">Žádné události</div>';

  const summaryTime = data.lastSummary ? timeAgo(data.lastSummary) : 'N/A';
  const nansenTime = data.lastNansen ? timeAgo(data.lastNansen) : 'N/A';
  const refreshPending = data.refreshRequested ? ' (⏳ refresh pending)' : '';

  // XTB Morning Commentary Section
  const xtb = data.xtb || {};
  const xtbAnalysis = xtb.analysis || {};
  const xtbVideo = xtb.video || {};
  
  let xtbHtml = '';
  if (xtbVideo.title) {
    const sentimentColors = { bullish: '#30d158', bearish: '#ff453a', neutral: '#888' };
    const typeIcons = { akcie: '📈', index: '📊', komodita: '🛢️', forex: '💱', krypto: '₿', makro: '🌍', geopolitika: '🌐' };
    const xtbVideoId = xtbVideo.videoId || '';
    const topicCount = xtbAnalysis.temata?.length || 0;
    
    let topicsHtml = '';
    if (xtbAnalysis.temata && xtbAnalysis.temata.length > 0) {
      topicsHtml = xtbAnalysis.temata.map(t => `
        <details class="xtb-topic">
          <summary class="xtb-topic-header">
            <span class="xtb-topic-icon">${typeIcons[t.typ] || '📌'}</span>
            <span class="xtb-topic-name">${escapeHtml(t.nazev)}</span>
            ${t.casVeVideu ? `<span class="xtb-topic-time">⏱️ ${escapeHtml(t.casVeVideu)}</span>` : ''}
            <span class="xtb-topic-sentiment" style="color:${sentimentColors[t.sentiment] || '#888'}">${t.sentiment === 'bullish' ? '🟢' : t.sentiment === 'bearish' ? '🔴' : '⚪'}</span>
            <span class="xtb-topic-expand">▼</span>
          </summary>
          <div class="xtb-topic-content">
            <div class="xtb-topic-detail">${escapeHtml(t.coRekli || t.detail || '')}</div>
            ${t.klicoveBody && t.klicoveBody.length > 0 ? `<ul class="xtb-topic-points">${t.klicoveBody.map(b => `<li>${escapeHtml(b)}</li>`).join('')}</ul>` : ''}
            ${t.doporuceni && t.doporuceni !== 'N/A' ? `<div class="xtb-topic-recommendation">💡 ${escapeHtml(t.doporuceni)}</div>` : ''}
          </div>
        </details>
      `).join('');
    }
    
    xtbHtml = `
    <details class="xtb-accordion" id="xtbAccordion" data-video-id="${xtbVideoId}">
      <summary class="xtb-btn" onclick="markXtbRead('${xtbVideoId}')">
        <span class="xtb-btn-icon">📺</span>
        <span class="xtb-btn-text">XTB Ranní Komentář</span>
        <span class="xtb-btn-date">${xtbVideo.published?.substring(0, 10) || ''}</span>
        <span class="xtb-btn-count">${topicCount} témat</span>
        <span class="xtb-btn-new" id="xtbNewBadge">NOVÉ</span>
        <span class="xtb-btn-expand">▼</span>
      </summary>
      <div class="xtb-content">
        <div class="xtb-content-header">
          <div class="xtb-video-title">${escapeHtml(xtbVideo.title)}</div>
          <a href="${xtbVideo.url}" target="_blank" class="xtb-video-link">▶️ Video</a>
        </div>
        ${xtbAnalysis.celkovySouhrn ? `<div class="xtb-summary">${escapeHtml(xtbAnalysis.celkovySouhrn)}</div>` : ''}
        <div class="xtb-topics">${topicsHtml || '<div class="no-data">Analýza není k dispozici</div>'}</div>
      </div>
    </details>`;
  }

  // Fisher Investments / Ken Fisher Section
  const fisher = data.fisher || {};
  let fisherHtml = '';
  if (fisher.videos && fisher.videos.length > 0) {
    const sentimentColors = { bullish: '#30d158', bearish: '#ff453a', neutral: '#888' };
    const summary = fisher.summary || {};
    const overallSentimentColor = sentimentColors[summary.overallSentiment] || '#888';
    
    const videosHtml = fisher.videos.map((v, idx) => {
      const importance = v.dulezitost || 3;
      const importanceStars = '★'.repeat(importance) + '☆'.repeat(5 - importance);
      
      let contentHtml = '';
      if (v.raw) {
        contentHtml = `<div class="fisher-raw">${escapeHtml(v.raw)}</div>`;
      } else {
        contentHtml = `
          ${v.hlavniTeze ? `<div class="fisher-teze"><strong>📌 Hlavní teze:</strong> ${escapeHtml(v.hlavniTeze)}</div>` : ''}
          ${v.trhniVyhled ? `<div class="fisher-outlook"><strong>📈 Výhled:</strong> ${escapeHtml(v.trhniVyhled)}</div>` : ''}
          ${v.casovyHorizont ? `<div class="fisher-horizon"><strong>⏰ Horizont:</strong> ${escapeHtml(v.casovyHorizont)}</div>` : ''}
          ${v.signaly && v.signaly.length > 0 ? `<div class="fisher-signals"><strong>🚦 Signály:</strong><ul>${v.signaly.map(s => `<li>${escapeHtml(s)}</li>`).join('')}</ul></div>` : ''}
          ${v.sektoryAkcie && v.sektoryAkcie.length > 0 ? `<div class="fisher-sectors"><strong>🏢 Sektory/Akcie:</strong><ul>${v.sektoryAkcie.map(s => `<li>${escapeHtml(s)}</li>`).join('')}</ul></div>` : ''}
          ${v.rizika && v.rizika.length > 0 ? `<div class="fisher-risks"><strong>⚠️ Rizika:</strong><ul>${v.rizika.map(r => `<li>${escapeHtml(r)}</li>`).join('')}</ul></div>` : ''}
          ${v.kontrarianskePogledy && v.kontrarianskePogledy.length > 0 ? `<div class="fisher-contrarian"><strong>🔄 Kontrariánské pohledy:</strong><ul>${v.kontrarianskePogledy.map(c => `<li>${escapeHtml(c)}</li>`).join('')}</ul></div>` : ''}
          ${v.klicoveCitaty && v.klicoveCitaty.length > 0 ? `<div class="fisher-quotes"><strong>💬 Citáty:</strong><ul>${v.klicoveCitaty.map(q => `<li>"${escapeHtml(q)}"</li>`).join('')}</ul></div>` : ''}
          ${v.proInvestora ? `<div class="fisher-advice"><strong>👨‍💼 Pro investora:</strong> ${escapeHtml(v.proInvestora)}</div>` : ''}
        `;
      }
      
      return `
        <details class="fisher-video">
          <summary class="fisher-video-header">
            <span class="fisher-video-importance" title="Důležitost ${importance}/5">${importanceStars}</span>
            <span class="fisher-video-title">${escapeHtml(v.videoTitle?.substring(0, 70) || 'Video')}</span>
            <span class="fisher-video-date">${v.published?.substring(0, 10) || ''}</span>
            <span class="fisher-video-expand">▼</span>
          </summary>
          <div class="fisher-video-content">
            <a href="${v.videoUrl || '#'}" target="_blank" class="fisher-video-link">▶️ Sledovat video</a>
            ${contentHtml}
          </div>
        </details>
      `;
    }).join('');
    
    // Summary section
    let summaryHtml = '';
    if (summary.keySignals || summary.keyRisks || summary.memorableQuotes) {
      summaryHtml = `
        <div class="fisher-summary">
          <div class="fisher-summary-header">
            <span class="fisher-sentiment" style="color:${overallSentimentColor}">
              ${summary.overallSentiment === 'bullish' ? '🐂 BULLISH' : summary.overallSentiment === 'bearish' ? '🐻 BEARISH' : '➡️ NEUTRAL'}
            </span>
            <span class="fisher-videos-count">${fisher.videoCount || fisher.videos.length} videí analyzováno</span>
          </div>
          ${summary.keySignals && summary.keySignals.length > 0 ? `<div class="fisher-summary-item"><strong>🚦 Klíčové signály:</strong> ${summary.keySignals.join(' • ')}</div>` : ''}
          ${summary.keyRisks && summary.keyRisks.length > 0 ? `<div class="fisher-summary-item"><strong>⚠️ Rizika:</strong> ${summary.keyRisks.join(' • ')}</div>` : ''}
          ${summary.memorableQuotes && summary.memorableQuotes.length > 0 ? `<div class="fisher-summary-item fisher-quote">"${escapeHtml(summary.memorableQuotes[0])}"</div>` : ''}
        </div>
      `;
    }
    
    fisherHtml = `
    <details class="fisher-accordion">
      <summary class="fisher-btn">
        <span class="fisher-btn-icon">🎣</span>
        <span class="fisher-btn-text">Ken Fisher Insights</span>
        <span class="fisher-btn-sentiment" style="color:${overallSentimentColor}">
          ${summary.overallSentiment === 'bullish' ? '🐂' : summary.overallSentiment === 'bearish' ? '🐻' : '➡️'}
        </span>
        <span class="fisher-btn-count">${fisher.videos.length} videí</span>
        <span class="fisher-btn-expand">▼</span>
      </summary>
      <div class="fisher-content">
        ${summaryHtml}
        <div class="fisher-videos">${videosHtml}</div>
        <div class="fisher-updated">Aktualizováno: ${timeAgo(fisher.lastUpdate)}</div>
      </div>
    </details>`;
  }

  // Watchlist section - Enhanced with detailed research
  const watchlist = data.watchlist || {};
  let watchlistHtml = '';
  if (watchlist.stocks && watchlist.stocks.length > 0) {
    const sentimentColors = { bullish: '#30d158', bearish: '#ff453a', neutral: '#888', mixed: '#f59e0b' };
    const summary = watchlist.summary || {};
    
    const stocksHtml = watchlist.stocks.map(s => {
      const fin = s.financials || {};
      const tech = s.technicalAnalysis || {};
      const consensus = s.analytickyKonsensus || {};
      const konkurence = s.konkurence || {};
      const gf = s.guruFocus || {};
      
      // Novinky HTML
      let novinyHtml = '';
      if (s.novinky && s.novinky.length > 0) {
        novinyHtml = `<div class="wl-news-section">
          <div class="wl-section-title">📰 Poslední novinky</div>
          ${s.novinky.slice(0, 3).map(n => {
            const dopadClass = n.dopad === 'pozitivní' ? 'positive' : n.dopad === 'negativní' ? 'negative' : '';
            return `<div class="wl-news-item ${dopadClass}">
              ${n.datum ? `<span class="wl-news-date">${escapeHtml(n.datum)}</span>` : ''}
              <span class="wl-news-title">${escapeHtml(typeof n === 'string' ? n : n.titulek || '')}</span>
            </div>`;
          }).join('')}
        </div>`;
      }
      
      // Financials HTML
      let financialsHtml = '';
      if (fin.lastQuarterRevenue || fin.lastQuarterEPS) {
        financialsHtml = `<div class="wl-financials">
          <div class="wl-section-title">📊 Poslední výsledky</div>
          <div class="wl-fin-grid">
            ${fin.lastQuarterRevenue ? `<div class="wl-fin-item"><span class="wl-fin-label">Revenue</span><span class="wl-fin-value">${escapeHtml(fin.lastQuarterRevenue)}</span></div>` : ''}
            ${fin.revenueGrowthYoY ? `<div class="wl-fin-item"><span class="wl-fin-label">Rev. YoY</span><span class="wl-fin-value ${fin.revenueGrowthYoY.includes('-') ? 'negative' : 'positive'}">${escapeHtml(fin.revenueGrowthYoY)}</span></div>` : ''}
            ${fin.lastQuarterEPS ? `<div class="wl-fin-item"><span class="wl-fin-label">EPS</span><span class="wl-fin-value">${escapeHtml(fin.lastQuarterEPS)}</span></div>` : ''}
            ${fin.epsGrowthYoY ? `<div class="wl-fin-item"><span class="wl-fin-label">EPS YoY</span><span class="wl-fin-value ${fin.epsGrowthYoY.includes('-') ? 'negative' : 'positive'}">${escapeHtml(fin.epsGrowthYoY)}</span></div>` : ''}
            ${fin.operatingMargin ? `<div class="wl-fin-item"><span class="wl-fin-label">Op. Margin</span><span class="wl-fin-value">${escapeHtml(fin.operatingMargin)}</span></div>` : ''}
            ${fin.freeCashFlow ? `<div class="wl-fin-item"><span class="wl-fin-label">FCF</span><span class="wl-fin-value">${escapeHtml(fin.freeCashFlow)}</span></div>` : ''}
          </div>
          ${fin.guidance ? `<div class="wl-guidance">📋 Guidance: ${escapeHtml(fin.guidance)}</div>` : ''}
        </div>`;
      }
      
      // Analyst consensus HTML
      let consensusHtml = '';
      if (consensus.doporuceni || consensus.prumernyPriceTarget) {
        const recColor = consensus.doporuceni === 'Buy' ? '#30d158' : consensus.doporuceni === 'Sell' ? '#ff453a' : '#f59e0b';
        consensusHtml = `<div class="wl-consensus">
          <div class="wl-section-title">🎯 Analytický konsensus</div>
          <div class="wl-consensus-grid">
            ${consensus.doporuceni ? `<span class="wl-rec" style="background:${recColor}">${escapeHtml(consensus.doporuceni)}</span>` : ''}
            ${consensus.prumernyPriceTarget ? `<span class="wl-pt">PT: ${escapeHtml(consensus.prumernyPriceTarget)}</span>` : ''}
            ${consensus.pocetAnalytiku ? `<span class="wl-analysts">${escapeHtml(consensus.pocetAnalytiku)} analytiků</span>` : ''}
          </div>
          ${consensus.posledniZmena ? `<div class="wl-last-change">${escapeHtml(consensus.posledniZmena)}</div>` : ''}
        </div>`;
      }
      
      // Risks and opportunities
      let risksHtml = '';
      if ((s.rizika && s.rizika.length > 0) || (s.prilezitosti && s.prilezitosti.length > 0)) {
        risksHtml = `<div class="wl-risks-opps">
          ${s.prilezitosti && s.prilezitosti.length > 0 ? `<div class="wl-opps"><strong>📈 Příležitosti:</strong> ${s.prilezitosti.slice(0, 2).map(o => escapeHtml(o)).join(' • ')}</div>` : ''}
          ${s.rizika && s.rizika.length > 0 ? `<div class="wl-risks"><strong>⚠️ Rizika:</strong> ${s.rizika.slice(0, 2).map(r => escapeHtml(r)).join(' • ')}</div>` : ''}
        </div>`;
      }
      
      // Technical analysis
      let techHtml = '';
      if (tech.trend || tech.support || tech.resistance) {
        const trendIcon = tech.trend === 'uptrend' ? '📈' : tech.trend === 'downtrend' ? '📉' : '➡️';
        techHtml = `<div class="wl-tech">
          <span class="wl-trend">${trendIcon} ${escapeHtml(tech.trend || 'N/A')}</span>
          ${tech.support ? `<span class="wl-support">S: ${escapeHtml(tech.support)}</span>` : ''}
          ${tech.resistance ? `<span class="wl-resistance">R: ${escapeHtml(tech.resistance)}</span>` : ''}
        </div>`;
      }
      
      // GuruFocus valuation bar
      const valColors = { 'Undervalued': '#30d158', 'Fairly Valued': '#f59e0b', 'Overvalued': '#ff453a' };
      const valColor = valColors[s.valuationStatus] || '#888';
      
      // GuruFocus section
      let gfHtml = '';
      if (gf.gfScore || gf.gfValue) {
        gfHtml = `<div class="wl-gurufocus">
          <div class="wl-gf-header">
            <span class="wl-gf-logo">📊 GuruFocus</span>
            ${s.valuationStatus ? `<span class="wl-gf-valuation" style="background:${valColor}">${escapeHtml(s.valuationStatus)}</span>` : ''}
          </div>
          <div class="wl-gf-grid">
            ${gf.gfScore ? `<div class="wl-gf-item"><span class="wl-gf-label">GF Score</span><span class="wl-gf-value wl-gf-score">${gf.gfScore}/100</span></div>` : ''}
            ${gf.gfValue ? `<div class="wl-gf-item"><span class="wl-gf-label">GF Value</span><span class="wl-gf-value">$${gf.gfValue}</span></div>` : ''}
            ${gf.roe ? `<div class="wl-gf-item"><span class="wl-gf-label">ROE</span><span class="wl-gf-value">${gf.roe}%</span></div>` : ''}
            ${gf.roic ? `<div class="wl-gf-item"><span class="wl-gf-label">ROIC</span><span class="wl-gf-value">${gf.roic}%</span></div>` : ''}
            ${gf.grossMargin ? `<div class="wl-gf-item"><span class="wl-gf-label">Gross Margin</span><span class="wl-gf-value">${gf.grossMargin}%</span></div>` : ''}
            ${gf.operatingMargin ? `<div class="wl-gf-item"><span class="wl-gf-label">Op Margin</span><span class="wl-gf-value">${gf.operatingMargin}%</span></div>` : ''}
            ${gf.netMargin ? `<div class="wl-gf-item"><span class="wl-gf-label">Net Margin</span><span class="wl-gf-value">${gf.netMargin}%</span></div>` : ''}
            ${gf.fcfMargin ? `<div class="wl-gf-item"><span class="wl-gf-label">FCF Margin</span><span class="wl-gf-value">${gf.fcfMargin}%</span></div>` : ''}
            ${gf.revenueGrowth3Y ? `<div class="wl-gf-item"><span class="wl-gf-label">3Y Rev Growth</span><span class="wl-gf-value ${gf.revenueGrowth3Y > 0 ? 'positive' : 'negative'}">${gf.revenueGrowth3Y}%</span></div>` : ''}
            ${gf.epsGrowth3Y ? `<div class="wl-gf-item"><span class="wl-gf-label">3Y EPS Growth</span><span class="wl-gf-value ${gf.epsGrowth3Y > 0 ? 'positive' : 'negative'}">${gf.epsGrowth3Y}%</span></div>` : ''}
            ${gf.debtToEquity ? `<div class="wl-gf-item"><span class="wl-gf-label">Debt/Equity</span><span class="wl-gf-value">${gf.debtToEquity}</span></div>` : ''}
            ${gf.currentRatio ? `<div class="wl-gf-item"><span class="wl-gf-label">Current Ratio</span><span class="wl-gf-value">${gf.currentRatio}</span></div>` : ''}
            ${gf.priceToFCF ? `<div class="wl-gf-item"><span class="wl-gf-label">P/FCF</span><span class="wl-gf-value">${gf.priceToFCF}</span></div>` : ''}
            ${gf.evToEbitda ? `<div class="wl-gf-item"><span class="wl-gf-label">EV/EBITDA</span><span class="wl-gf-value">${gf.evToEbitda}</span></div>` : ''}
            ${gf.piotroskiFScore ? `<div class="wl-gf-item"><span class="wl-gf-label">F-Score</span><span class="wl-gf-value">${gf.piotroskiFScore}/9</span></div>` : ''}
            ${gf.altmanZScore ? `<div class="wl-gf-item"><span class="wl-gf-label">Z-Score</span><span class="wl-gf-value">${gf.altmanZScore}</span></div>` : ''}
            ${gf.rsi14 ? `<div class="wl-gf-item"><span class="wl-gf-label">RSI(14)</span><span class="wl-gf-value">${gf.rsi14}</span></div>` : ''}
            ${gf.dividendYield ? `<div class="wl-gf-item"><span class="wl-gf-label">Div Yield</span><span class="wl-gf-value">${gf.dividendYield}%</span></div>` : ''}
          </div>
          ${s.valuationDetail ? `<div class="wl-gf-valuation-detail">${escapeHtml(s.valuationDetail)}</div>` : ''}
          ${gf.financialHealth ? `<div class="wl-gf-health">Financial Health: <span class="wl-health-${gf.financialHealth.toLowerCase()}">${gf.financialHealth}</span></div>` : ''}
          ${gf.momentum ? `<div class="wl-gf-momentum">Momentum: <span class="wl-momentum-${gf.momentum.toLowerCase()}">${gf.momentum}</span></div>` : ''}
        </div>`;
      }

      return `
      <details class="wl-stock-detail">
        <summary class="wl-stock-header-new">
          <div class="wl-stock-main">
            <span class="wl-ticker">${escapeHtml(s.ticker)}</span>
            <span class="wl-name">${escapeHtml(s.name || '')}</span>
            <span class="wl-sector">${escapeHtml(s.sector || '')}</span>
          </div>
          <div class="wl-stock-price-row">
            <span class="wl-price">${escapeHtml(s.price || 'N/A')}</span>
            ${s.priceChange ? `<span class="wl-change ${s.priceChange.includes('-') ? 'down' : 'up'}">${escapeHtml(s.priceChange)}</span>` : ''}
          </div>
          <div class="wl-stock-metrics">
            ${s.gfScore ? `<span class="wl-gf-badge">GF:${s.gfScore}</span>` : ''}
            <span class="wl-pe">P/E: ${escapeHtml(s.pe || 'N/A')}</span>
            ${s.ps && s.ps !== 'N/A' ? `<span class="wl-ps">P/S: ${escapeHtml(s.ps)}</span>` : ''}
            ${s.marketCap ? `<span class="wl-mcap">${escapeHtml(s.marketCap)}</span>` : ''}
          </div>
          ${s.valuationStatus ? `<span class="wl-valuation-badge" style="background:${valColor}">${escapeHtml(s.valuationStatus)}</span>` : ''}
          <span class="wl-sentiment-badge" style="background:${sentimentColors[s.sentiment] || '#888'}">${s.sentiment === 'bullish' ? '🐂 BULL' : s.sentiment === 'bearish' ? '🐻 BEAR' : '➡️ HOLD'}</span>
          <span class="wl-expand">▼</span>
        </summary>
        <div class="wl-stock-body">
          ${gfHtml}
          ${s.souhrn ? `<div class="wl-summary">${escapeHtml(s.souhrn)}</div>` : ''}
          ${s.actionItem ? `<div class="wl-action">💡 ${escapeHtml(s.actionItem)}</div>` : ''}
          ${techHtml}
          ${consensusHtml}
          ${financialsHtml}
          ${novinyHtml}
          ${risksHtml}
          <div class="wl-stock-footer">
            ${s.grounded ? '<span class="wl-grounded">🔍 Google Search</span>' : s.fallback ? '<span class="wl-fallback">⚠️ Fallback</span>' : ''}
            <span class="wl-researched">${timeAgo(s.researchedAt)}</span>
          </div>
        </div>
      </details>`;
    }).join('');
    
    // Summary section
    const summaryHtml = summary.total ? `
      <div class="wl-summary-bar">
        <span class="wl-sum-item">📊 ${summary.total} akcií</span>
        <span class="wl-sum-item wl-bull">🟢 ${summary.bullish || 0} bullish</span>
        <span class="wl-sum-item wl-bear">🔴 ${summary.bearish || 0} bearish</span>
        <span class="wl-sum-item wl-neut">⚪ ${summary.neutral || 0} neutral</span>
        <span class="wl-sum-sentiment" style="color:${sentimentColors[summary.marketSentiment] || '#888'}">
          Market: ${summary.marketSentiment === 'bullish' ? '🐂 BULLISH' : summary.marketSentiment === 'bearish' ? '🐻 BEARISH' : '↔️ MIXED'}
        </span>
      </div>
    ` : '';
    
    watchlistHtml = `
    <details class="wl-accordion" open>
      <summary class="wl-btn">
        <span class="wl-btn-icon">📊</span>
        <span class="wl-btn-text">Moje Akcie - Detailní Research</span>
        <span class="wl-btn-model">${escapeHtml(watchlist.model || 'Gemini')}</span>
        <span class="wl-btn-count">${watchlist.stocks.length} titulů</span>
        <span class="wl-btn-expand">▼</span>
      </summary>
      <div class="wl-content">
        ${summaryHtml}
        <div class="wl-stocks-list">${stocksHtml}</div>
        <div class="wl-footer">
          <span class="wl-grounded-count">🔍 ${summary.groundedCount || 0} grounded | ⚠️ ${summary.fallbackCount || 0} fallback</span>
          <span class="wl-updated">Aktualizováno: ${timeAgo(watchlist.updated)}</span>
        </div>
      </div>
    </details>`;
  }

  // Liquity Position section - simplified
  const liquity = data.liquity || {};
  let liquityHtml = '';
  if (liquity.address || liquity.debtInFront !== undefined || liquity.url) {
    const debtInFront = liquity.debtInFront;
    const hasData = debtInFront !== null && debtInFront !== undefined;
    const debtInFrontM = hasData ? (debtInFront / 1e6).toFixed(2) : 'N/A';
    const isAlert = hasData && debtInFront < 30000000;
    const alertClass = isAlert ? 'liq-alert' : '';
    const protocol = liquity.protocol || 'Liquity';
    const collType = liquity.collateralType || '';
    const defiSaverUrl = liquity.url || 'https://app.defisaver.com/liquityV2/smart-wallet/wsteth/manage?trackAddress=0x66a7b66d7e823155660bdc6b83beaaa11098ea89&chainId=1';
    const isLive = liquity.dataSource === 'defisaver-live';
    
    // Redemption data from Dune
    const ra = liquity.redemptionAnalysis || {};
    const lastRedemptionRate = ra.lastRedemptionRate;
    const userRate = liquity.interestRate || 5.00;
    
    liquityHtml = `
    <div class="liq-card ${alertClass}">
      <div class="liq-header">
        <span class="liq-icon">🏦</span>
        <span class="liq-title">${escapeHtml(protocol)} ${collType ? `(${escapeHtml(collType)})` : ''}</span>
        ${isAlert ? '<span class="liq-warning">⚠️ &lt;30M</span>' : '<span class="liq-safe">✅</span>'}
      </div>
      <div class="liq-stats">
        <div class="liq-stat liq-main">
          <span class="liq-label">Debt in Front</span>
          <span class="liq-value ${isAlert ? 'liq-danger' : ''}">${hasData ? debtInFrontM + 'M' : 'N/A'}</span>
        </div>
        <div class="liq-stat">
          <span class="liq-label">Úrok</span>
          <span class="liq-value">${userRate ? userRate.toFixed(1) + '%' : 'N/A'}</span>
        </div>
        ${liquity.cr ? `<div class="liq-stat"><span class="liq-label">CR</span><span class="liq-value">${liquity.cr.toFixed(0)}%</span></div>` : ''}
        ${lastRedemptionRate ? `<div class="liq-stat liq-redemption"><span class="liq-label">⚡ Posl. Redemption</span><span class="liq-value">${lastRedemptionRate.toFixed(2)}%</span></div>` : ''}
        ${ra.lastRedemptionTimeAgo ? `<div class="liq-stat"><span class="liq-label">Kdy</span><span class="liq-value">${escapeHtml(ra.lastRedemptionTimeAgo)}</span></div>` : ''}
      </div>
      <div class="liq-footer">
        <span class="liq-updated">${isLive ? '🔴 Live' : '📦'} · ${timeAgo(liquity.updated)}</span>
        <a href="${escapeHtml(defiSaverUrl)}" target="_blank" class="liq-link">DeFi Saver →</a>
      </div>
    </div>`;
  }

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(`<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Forum Monitor Dashboard</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
:root{--bg:#000;--card:#0a0a0a;--border:#1a1a1a;--t:#fff;--t2:#888;--t3:#555;--g:#30d158;--r:#ff453a;--ai:#a855f7;--nansen:#f59e0b;--snapshot:#3b82f6}
body{font-family:-apple-system,BlinkMacSystemFont,sans-serif;background:var(--bg);color:var(--t);min-height:100vh;padding:30px;-webkit-font-smoothing:antialiased}
.container{max-width:1800px;margin:0 auto}
header{display:flex;justify-content:space-between;align-items:center;margin-bottom:40px;flex-wrap:wrap;gap:20px}
h1{font-size:28px;font-weight:600}
.header-right{display:flex;flex-direction:column;align-items:flex-end;gap:8px}
.status{font-size:12px;color:var(--t2);text-align:right}
.status div{margin-top:4px}
.refresh-btn{background:linear-gradient(135deg,#3b82f6,#1d4ed8);border:none;color:#fff;padding:8px 16px;border-radius:8px;font-size:12px;font-weight:600;cursor:pointer;transition:all 0.2s;display:flex;align-items:center;gap:6px}
.refresh-btn:hover{transform:scale(1.02);box-shadow:0 4px 12px rgba(59,130,246,0.3)}
.refresh-btn:disabled{opacity:0.5;cursor:not-allowed;transform:none}
.refresh-btn.loading{animation:pulse 1s infinite}
@keyframes pulse{0%,100%{opacity:1}50%{opacity:0.6}}
.model-badge{font-size:10px;background:#1a1a1a;padding:4px 8px;border-radius:4px;color:var(--ai);border:1px solid rgba(168,85,247,0.3)}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(340px,1fr));gap:20px;margin-bottom:40px}
.card{background:var(--card);border:1px solid var(--border);border-radius:16px;padding:24px;border-top:3px solid var(--accent,#333)}
.card-header{display:flex;justify-content:space-between;align-items:center;margin-bottom:16px}
.card-title{font-size:14px;font-weight:600;display:flex;align-items:center;gap:8px}
.icon{font-size:18px}
.sentiment{font-size:12px;color:var(--t2)}
.price-row{display:flex;align-items:baseline;gap:12px;margin-bottom:4px}
.price{font-size:32px;font-weight:700}
.change{font-size:12px;font-weight:600;padding:3px 8px;border-radius:6px}
.change.up{background:rgba(48,209,88,0.15);color:var(--g)}
.change.down{background:rgba(255,69,58,0.15);color:var(--r)}
.symbol{font-size:12px;color:var(--t2);margin-bottom:16px}
.summary-accordion,.nansen-accordion,.snapshot-accordion{margin-bottom:12px}
.summary-toggle,.nansen-toggle,.snapshot-toggle{display:flex;justify-content:space-between;align-items:center;padding:10px 12px;border-radius:8px;cursor:pointer;font-size:12px;font-weight:500;list-style:none;transition:all 0.2s}
.summary-toggle{background:linear-gradient(135deg,rgba(168,85,247,0.1),rgba(168,85,247,0.05));border:1px solid rgba(168,85,247,0.2);color:var(--ai)}
.summary-toggle:hover{background:linear-gradient(135deg,rgba(168,85,247,0.15),rgba(168,85,247,0.08))}
.nansen-toggle{background:linear-gradient(135deg,rgba(245,158,11,0.1),rgba(245,158,11,0.05));border:1px solid rgba(245,158,11,0.2);color:var(--nansen)}
.nansen-toggle:hover{background:linear-gradient(135deg,rgba(245,158,11,0.15),rgba(245,158,11,0.08))}
.snapshot-toggle{background:linear-gradient(135deg,rgba(59,130,246,0.1),rgba(59,130,246,0.05));border:1px solid rgba(59,130,246,0.2);color:var(--snapshot)}
.snapshot-toggle:hover{background:linear-gradient(135deg,rgba(59,130,246,0.15),rgba(59,130,246,0.08))}
.summary-toggle::-webkit-details-marker,.nansen-toggle::-webkit-details-marker,.snapshot-toggle::-webkit-details-marker{display:none}
.toggle-icon{font-size:10px;transition:transform 0.2s}
details[open] .toggle-icon{transform:rotate(180deg)}
.summary-content{padding:12px;margin-top:6px;background:#111;border-radius:8px;font-size:12px;line-height:1.6;color:var(--t2);border-left:3px solid var(--ai)}
.nansen-content{padding:10px;margin-top:6px;background:#111;border-radius:8px;border-left:3px solid var(--nansen)}
.snapshot-content{padding:10px;margin-top:6px;background:#111;border-radius:8px;border-left:3px solid var(--snapshot)}
.vote-item{display:block;padding:8px;margin-bottom:6px;background:#0a0a0a;border-radius:6px;text-decoration:none;color:var(--t);transition:background 0.2s}
.vote-item:hover{background:#1a1a1a}
.vote-item:last-child{margin-bottom:0}
.vote-title{font-size:12px;margin-bottom:4px;line-height:1.3}
.vote-meta{display:flex;justify-content:space-between;font-size:11px;color:var(--t2)}
.vote-leading{color:var(--g)}
.vote-time{color:var(--snapshot)}
.nansen-item{padding:8px 0;border-bottom:1px solid var(--border)}
.nansen-item:last-of-type{border-bottom:none}
.nansen-main{display:flex;align-items:center;gap:6px;font-size:12px;margin-bottom:4px;flex-wrap:wrap}
.nansen-meta{display:flex;align-items:center;gap:10px;font-size:11px;color:var(--t2)}
.addr{color:var(--t);text-decoration:none;font-family:monospace;font-size:11px}
.addr:hover{color:var(--nansen);text-decoration:underline}
.arrow{color:var(--t3)}
.amount{color:var(--t2)}
.nansen-item.sell .amount{color:var(--r)}
.nansen-item.buy .amount{color:var(--g)}
.buys-toggle{background:linear-gradient(135deg,rgba(48,209,88,0.1),rgba(48,209,88,0.05))!important;border-color:rgba(48,209,88,0.2)!important;color:var(--g)!important}
.buys-toggle:hover{background:linear-gradient(135deg,rgba(48,209,88,0.15),rgba(48,209,88,0.08))!important}
.buys-content{border-left-color:var(--g)!important}
.value{color:var(--g)}
.tx-link{color:var(--nansen);text-decoration:none;font-size:10px}
.tx-link:hover{text-decoration:underline}
.nansen-age{font-size:10px;color:var(--t3);margin-top:8px;text-align:right}
.topics{display:flex;flex-direction:column;gap:6px;margin-top:12px}
.topic{display:flex;justify-content:space-between;align-items:center;padding:8px 10px;background:#111;border-radius:6px;text-decoration:none;color:var(--t);transition:background 0.2s;font-size:12px}
.topic:hover{background:#1a1a1a}
.topic-title{flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-right:10px}
.topic-meta{font-size:10px;color:var(--t2);white-space:nowrap;display:flex;gap:8px}
.topic-time{color:var(--t3)}
.no-data{font-size:12px;color:var(--t2);text-align:center;padding:16px}
.activity-section{background:var(--card);border:1px solid var(--border);border-radius:16px;padding:24px}
.activity-section h2{font-size:16px;font-weight:600;margin-bottom:16px}
.activity-item{display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid var(--border);font-size:12px;text-decoration:none;color:var(--t);transition:background 0.2s;border-radius:6px;margin:2px -8px;padding-left:8px;padding-right:8px}
.activity-item:hover{background:#1a1a1a}
.activity-item:last-child{border-bottom:none}
.activity-item.new{border-left:3px solid var(--g);padding-left:10px;margin-left:-10px}
.activity-item.update{border-left:3px solid #60a5fa;padding-left:10px;margin-left:-10px}
.activity-icon{font-size:14px}
.activity-forum{font-size:14px}
.activity-title{flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.activity-time{color:var(--t2);font-size:11px}
.live-feed-section{background:var(--card);border:1px solid var(--border);border-radius:16px;padding:20px;margin-top:20px}
.live-feed-header{display:flex;justify-content:space-between;align-items:center;margin-bottom:16px}
.live-feed-header h2{font-size:16px;font-weight:600;margin:0}
.live-indicator{font-size:11px;background:#1a1a1a;padding:4px 10px;border-radius:12px;animation:pulse-live 2s infinite}
@keyframes pulse-live{0%,100%{opacity:1}50%{opacity:0.5}}
.live-feed-content{display:flex;flex-direction:column;gap:8px;max-height:500px;overflow-y:auto}
.feed-item{display:flex;align-items:center;gap:12px;padding:10px 12px;background:#111;border-radius:10px;text-decoration:none;color:var(--t);transition:all 0.2s;border-left:3px solid #333}
.feed-item:hover{background:#1a1a1a;transform:translateX(4px)}
.feed-item.feed-alert{border-left-color:#ef4444;background:rgba(239,68,68,0.1)}
.feed-item.feed-forum{border-left-color:#60a5fa}
.feed-item.feed-price{border-left-color:#f59e0b}
.feed-item.feed-analysis{border-left-color:#a855f7}
.feed-item.feed-defi{border-left-color:#22c55e}
.feed-item.feed-stocks{border-left-color:#3b82f6}
.feed-item.feed-governance{border-left-color:#8b5cf6}
.feed-item.feed-nansen{border-left-color:#f59e0b}
.feed-icon{font-size:18px;width:28px;text-align:center}
.feed-content{flex:1;min-width:0;display:flex;flex-direction:column;gap:2px}
.feed-title{font-size:13px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.feed-subtitle{font-size:11px;color:var(--t2);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.feed-meta{display:flex;flex-direction:column;align-items:flex-end;gap:4px}
.feed-category{font-size:9px;text-transform:uppercase;color:#000;padding:2px 6px;border-radius:4px;font-weight:600}
.feed-time{font-size:10px;color:var(--t3)}
.toast{position:fixed;bottom:20px;right:20px;background:#1a1a1a;border:1px solid var(--border);padding:12px 20px;border-radius:8px;font-size:13px;opacity:0;transform:translateY(20px);transition:all 0.3s}
.toast.show{opacity:1;transform:translateY(0)}
.toast.success{border-color:var(--g);color:var(--g)}
.toast.error{border-color:var(--r);color:var(--r)}
@media(max-width:768px){body{padding:15px}.grid{grid-template-columns:1fr}}
.xtb-accordion{margin-bottom:20px}
.xtb-btn{display:flex;align-items:center;gap:12px;padding:12px 16px;background:linear-gradient(135deg,rgba(239,68,68,0.15),rgba(239,68,68,0.05));border:1px solid rgba(239,68,68,0.3);border-radius:12px;cursor:pointer;list-style:none;transition:all 0.2s}
.xtb-btn:hover{background:linear-gradient(135deg,rgba(239,68,68,0.25),rgba(239,68,68,0.1));transform:translateY(-1px)}
.xtb-btn::-webkit-details-marker{display:none}
.xtb-btn-icon{font-size:20px}
.xtb-btn-text{font-size:14px;font-weight:600;color:#ef4444}
.xtb-btn-date{font-size:11px;color:var(--t2);background:#1a1a1a;padding:3px 8px;border-radius:4px}
.xtb-btn-count{font-size:11px;color:var(--t3)}
.xtb-btn-new{font-size:10px;font-weight:700;color:#fff;background:#ef4444;padding:2px 6px;border-radius:4px;animation:pulse-new 2s infinite}
.xtb-btn-new.read{display:none}
@keyframes pulse-new{0%,100%{opacity:1}50%{opacity:0.6}}
.xtb-btn-expand{font-size:10px;color:var(--t3);margin-left:auto;transition:transform 0.2s}
.xtb-accordion[open] .xtb-btn-expand{transform:rotate(180deg)}
.xtb-accordion[open] .xtb-btn{border-radius:12px 12px 0 0;border-bottom:none}
.xtb-content{background:var(--card);border:1px solid rgba(239,68,68,0.3);border-top:none;border-radius:0 0 12px 12px;padding:16px}
.xtb-content-header{display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;gap:12px}
.xtb-video-title{font-size:14px;font-weight:500;flex:1}
.xtb-video-link{background:#ef4444;color:#fff;padding:6px 12px;border-radius:6px;text-decoration:none;font-size:11px;font-weight:600;white-space:nowrap}
.xtb-video-link:hover{background:#dc2626}
.xtb-summary{background:#111;border-left:3px solid var(--ai);padding:12px;border-radius:0 8px 8px 0;font-size:13px;line-height:1.6;margin-bottom:16px}
.xtb-topics{display:flex;flex-direction:column;gap:8px}
.xtb-topic{background:#111;border-radius:10px;border-left:3px solid #333}
.xtb-topic-header{display:flex;align-items:center;gap:8px;padding:10px 14px;cursor:pointer;list-style:none}
.xtb-topic-header::-webkit-details-marker{display:none}
.xtb-topic-icon{font-size:14px}
.xtb-topic-name{font-size:12px;font-weight:600;flex:1}
.xtb-topic-time{font-size:9px;color:var(--t3);background:#1a1a1a;padding:2px 5px;border-radius:3px}
.xtb-topic-sentiment{font-size:11px}
.xtb-topic-expand{font-size:9px;color:var(--t3);transition:transform 0.2s}
.xtb-topic[open] .xtb-topic-expand{transform:rotate(180deg)}
.xtb-topic[open]{border-left-color:var(--ai)}
.xtb-topic-content{padding:0 14px 14px 14px;border-top:1px solid var(--border)}
.xtb-topic-detail{font-size:12px;line-height:1.6;color:var(--t2);padding-top:10px}
.xtb-topic-points{margin:8px 0 0 0;padding-left:18px;font-size:11px;color:var(--t2)}
.xtb-topic-points li{margin:3px 0}
.xtb-topic-recommendation{background:rgba(48,209,88,0.1);border:1px solid rgba(48,209,88,0.3);border-radius:6px;padding:6px 10px;font-size:11px;color:var(--g);margin-top:8px}
.fisher-accordion{margin-bottom:20px}
.fisher-btn{display:flex;align-items:center;gap:12px;padding:12px 16px;background:linear-gradient(135deg,rgba(34,197,94,0.15),rgba(34,197,94,0.05));border:1px solid rgba(34,197,94,0.3);border-radius:12px;cursor:pointer;list-style:none;transition:all 0.2s}
.fisher-btn:hover{background:linear-gradient(135deg,rgba(34,197,94,0.25),rgba(34,197,94,0.1));transform:translateY(-1px)}
.fisher-btn::-webkit-details-marker{display:none}
.fisher-btn-icon{font-size:20px}
.fisher-btn-text{font-size:14px;font-weight:600;color:#22c55e}
.fisher-btn-sentiment{font-size:16px}
.fisher-btn-count{font-size:11px;color:var(--t2);background:#1a1a1a;padding:3px 8px;border-radius:4px}
.fisher-btn-expand{font-size:10px;color:var(--t3);margin-left:auto;transition:transform 0.2s}
.fisher-accordion[open] .fisher-btn-expand{transform:rotate(180deg)}
.fisher-accordion[open] .fisher-btn{border-radius:12px 12px 0 0;border-bottom:none}
.fisher-content{background:var(--card);border:1px solid rgba(34,197,94,0.3);border-top:none;border-radius:0 0 12px 12px;padding:16px}
.fisher-summary{background:#111;border-left:3px solid #22c55e;padding:12px;border-radius:0 8px 8px 0;margin-bottom:16px}
.fisher-summary-header{display:flex;justify-content:space-between;align-items:center;margin-bottom:8px}
.fisher-sentiment{font-size:14px;font-weight:700}
.fisher-videos-count{font-size:11px;color:var(--t3)}
.fisher-summary-item{font-size:12px;line-height:1.6;margin:6px 0}
.fisher-summary-item strong{color:var(--t1)}
.fisher-quote{font-style:italic;color:var(--ai);padding:8px 12px;background:rgba(168,85,247,0.1);border-radius:6px;margin-top:8px}
.fisher-videos{display:flex;flex-direction:column;gap:8px}
.fisher-video{background:#111;border-radius:10px;border-left:3px solid #333}
.fisher-video-header{display:flex;align-items:center;gap:10px;padding:10px 14px;cursor:pointer;list-style:none}
.fisher-video-header::-webkit-details-marker{display:none}
.fisher-video-importance{font-size:10px;color:#f59e0b;letter-spacing:-1px}
.fisher-video-title{font-size:12px;font-weight:600;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.fisher-video-date{font-size:9px;color:var(--t3);background:#1a1a1a;padding:2px 5px;border-radius:3px}
.fisher-video-expand{font-size:9px;color:var(--t3);transition:transform 0.2s}
.fisher-video[open] .fisher-video-expand{transform:rotate(180deg)}
.fisher-video[open]{border-left-color:#22c55e}
.fisher-video-content{padding:12px 14px;border-top:1px solid var(--border)}
.fisher-video-link{display:inline-block;background:#22c55e;color:#000;padding:6px 12px;border-radius:6px;text-decoration:none;font-size:11px;font-weight:600;margin-bottom:12px}
.fisher-video-link:hover{background:#16a34a}
.fisher-teze,.fisher-outlook,.fisher-horizon,.fisher-advice{font-size:12px;line-height:1.6;margin:8px 0;padding:8px 10px;background:rgba(34,197,94,0.08);border-radius:6px}
.fisher-signals,.fisher-sectors,.fisher-risks,.fisher-contrarian,.fisher-quotes{font-size:12px;margin:8px 0}
.fisher-signals ul,.fisher-sectors ul,.fisher-risks ul,.fisher-contrarian ul,.fisher-quotes ul{margin:4px 0 0 0;padding-left:18px}
.fisher-signals li,.fisher-sectors li,.fisher-risks li,.fisher-contrarian li{margin:3px 0;color:var(--t2)}
.fisher-quotes li{margin:3px 0;font-style:italic;color:var(--ai)}
.fisher-raw{font-size:12px;line-height:1.6;color:var(--t2);white-space:pre-wrap}
.fisher-updated{font-size:10px;color:var(--t3);text-align:right;margin-top:12px;padding-top:8px;border-top:1px solid var(--border)}
.wl-accordion{margin-bottom:20px}
.wl-btn{display:flex;align-items:center;gap:12px;padding:12px 16px;background:linear-gradient(135deg,rgba(59,130,246,0.15),rgba(59,130,246,0.05));border:1px solid rgba(59,130,246,0.3);border-radius:12px;cursor:pointer;list-style:none;transition:all 0.2s}
.wl-btn:hover{background:linear-gradient(135deg,rgba(59,130,246,0.25),rgba(59,130,246,0.1));transform:translateY(-1px)}
.wl-btn::-webkit-details-marker{display:none}
.wl-btn-icon{font-size:20px}
.wl-btn-text{font-size:14px;font-weight:600;color:#3b82f6}
.wl-btn-model{font-size:9px;color:#a855f7;background:rgba(168,85,247,0.15);padding:2px 6px;border-radius:4px}
.wl-btn-count{font-size:11px;color:var(--t2);background:#1a1a1a;padding:3px 8px;border-radius:4px}
.wl-btn-expand{font-size:10px;color:var(--t3);margin-left:auto;transition:transform 0.2s}
.wl-accordion[open] .wl-btn-expand{transform:rotate(180deg)}
.wl-accordion[open] .wl-btn{border-radius:12px 12px 0 0;border-bottom:none}
.wl-content{background:var(--card);border:1px solid rgba(59,130,246,0.3);border-top:none;border-radius:0 0 12px 12px;padding:16px}
.wl-summary-bar{display:flex;align-items:center;gap:16px;padding:10px 14px;background:#111;border-radius:8px;margin-bottom:14px;flex-wrap:wrap}
.wl-sum-item{font-size:12px;color:var(--t2)}
.wl-sum-item.wl-bull{color:#30d158}
.wl-sum-item.wl-bear{color:#ff453a}
.wl-sum-item.wl-neut{color:#888}
.wl-sum-sentiment{font-size:13px;font-weight:700;margin-left:auto}
.wl-stocks-list{display:flex;flex-direction:column;gap:10px}
.wl-stock-detail{background:#111;border-radius:10px;border-left:3px solid #333;overflow:hidden}
.wl-stock-detail[open]{border-left-color:#3b82f6}
.wl-stock-header-new{display:flex;align-items:center;gap:10px;padding:12px 14px;cursor:pointer;list-style:none;flex-wrap:wrap}
.wl-stock-header-new::-webkit-details-marker{display:none}
.wl-stock-main{display:flex;align-items:center;gap:8px;min-width:200px}
.wl-ticker{font-size:15px;font-weight:700;color:#3b82f6}
.wl-name{font-size:12px;color:var(--t)}
.wl-sector{font-size:10px;color:var(--t3);background:#1a1a1a;padding:2px 6px;border-radius:4px}
.wl-stock-price-row{display:flex;align-items:center;gap:6px}
.wl-price{font-size:14px;font-weight:600;color:var(--t)}
.wl-change{font-size:11px;padding:2px 6px;border-radius:4px}
.wl-change.up{background:rgba(48,209,88,0.15);color:#30d158}
.wl-change.down{background:rgba(255,69,58,0.15);color:#ff453a}
.wl-stock-metrics{display:flex;gap:10px;font-size:11px;color:var(--t2)}
.wl-pe,.wl-ps{color:#f59e0b}
.wl-mcap{color:var(--t3)}
.wl-sentiment-badge{font-size:10px;font-weight:600;color:#000;padding:3px 8px;border-radius:4px;margin-left:auto}
.wl-expand{font-size:10px;color:var(--t3);transition:transform 0.2s}
.wl-stock-detail[open] .wl-expand{transform:rotate(180deg)}
.wl-stock-body{padding:0 14px 14px 14px;border-top:1px solid var(--border)}
.wl-summary{font-size:12px;line-height:1.6;color:var(--t2);padding:12px;background:#0a0a0a;border-radius:8px;margin-top:12px}
.wl-action{font-size:12px;color:#30d158;padding:8px 10px;background:rgba(48,209,88,0.1);border:1px solid rgba(48,209,88,0.2);border-radius:6px;margin-top:10px}
.wl-section-title{font-size:11px;font-weight:600;color:var(--t);margin-bottom:8px;margin-top:12px}
.wl-tech{display:flex;gap:12px;font-size:11px;margin-top:10px;padding:8px;background:#0a0a0a;border-radius:6px}
.wl-trend{color:#3b82f6;font-weight:500}
.wl-support{color:#ff453a}
.wl-resistance{color:#30d158}
.wl-consensus{margin-top:12px;padding:10px;background:#0a0a0a;border-radius:8px}
.wl-consensus-grid{display:flex;gap:12px;align-items:center;flex-wrap:wrap}
.wl-rec{font-size:11px;font-weight:600;color:#000;padding:3px 10px;border-radius:4px}
.wl-pt{font-size:12px;color:var(--t);font-weight:600}
.wl-analysts{font-size:10px;color:var(--t3)}
.wl-last-change{font-size:10px;color:var(--t2);margin-top:6px}
.wl-financials{margin-top:12px;padding:10px;background:#0a0a0a;border-radius:8px}
.wl-fin-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(100px,1fr));gap:8px}
.wl-fin-item{display:flex;flex-direction:column;gap:2px}
.wl-fin-label{font-size:9px;color:var(--t3);text-transform:uppercase}
.wl-fin-value{font-size:12px;color:var(--t);font-weight:500}
.wl-fin-value.positive{color:#30d158}
.wl-fin-value.negative{color:#ff453a}
.wl-guidance{font-size:11px;color:var(--t2);margin-top:10px;padding:8px;background:#111;border-radius:6px;border-left:2px solid #a855f7}
.wl-news-section{margin-top:12px}
.wl-news-item{font-size:11px;color:var(--t2);padding:6px 8px;background:#0a0a0a;border-radius:4px;margin-bottom:4px;display:flex;gap:8px;align-items:flex-start}
.wl-news-item.positive{border-left:2px solid #30d158}
.wl-news-item.negative{border-left:2px solid #ff453a}
.wl-news-date{font-size:9px;color:var(--t3);white-space:nowrap}
.wl-news-title{flex:1}
.wl-risks-opps{margin-top:12px;font-size:11px;line-height:1.5}
.wl-opps{color:#30d158;margin-bottom:6px}
.wl-risks{color:#ff453a}
.wl-stock-footer{display:flex;justify-content:space-between;margin-top:12px;padding-top:8px;border-top:1px solid var(--border);font-size:10px;color:var(--t3)}
.wl-grounded{color:#30d158}
.wl-fallback{color:#f59e0b}
.wl-footer{display:flex;justify-content:space-between;margin-top:14px;padding-top:10px;border-top:1px solid var(--border);font-size:10px;color:var(--t3)}
.wl-grounded-count{color:var(--t2)}
.wl-updated{text-align:right}
.wl-gf-badge{font-size:10px;font-weight:700;color:#f59e0b;background:rgba(245,158,11,0.15);padding:2px 6px;border-radius:4px}
.wl-valuation-badge{font-size:9px;font-weight:600;color:#000;padding:2px 8px;border-radius:4px;margin-right:4px}
.wl-gurufocus{margin:12px 0;padding:12px;background:linear-gradient(135deg,rgba(245,158,11,0.1),rgba(245,158,11,0.05));border:1px solid rgba(245,158,11,0.3);border-radius:10px}
.wl-gf-header{display:flex;justify-content:space-between;align-items:center;margin-bottom:10px}
.wl-gf-logo{font-size:12px;font-weight:600;color:#f59e0b}
.wl-gf-valuation{font-size:11px;font-weight:600;color:#000;padding:3px 10px;border-radius:6px}
.wl-gf-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(90px,1fr));gap:8px}
.wl-gf-item{display:flex;flex-direction:column;gap:2px;padding:6px 8px;background:rgba(0,0,0,0.3);border-radius:6px}
.wl-gf-label{font-size:9px;color:var(--t3);text-transform:uppercase}
.wl-gf-value{font-size:12px;font-weight:600;color:var(--t)}
.wl-gf-value.positive{color:#30d158}
.wl-gf-value.negative{color:#ff453a}
.wl-gf-score{color:#f59e0b;font-size:14px}
.wl-gf-valuation-detail{margin-top:10px;font-size:11px;color:var(--t2);text-align:center;font-style:italic}
.wl-gf-health,.wl-gf-momentum{font-size:11px;color:var(--t2);margin-top:6px}
.wl-health-strong{color:#30d158;font-weight:600}
.wl-health-moderate{color:#f59e0b;font-weight:600}
.wl-health-weak{color:#ff453a;font-weight:600}
.wl-momentum-overbought{color:#ff453a}
.wl-momentum-oversold{color:#30d158}
.wl-momentum-neutral{color:#888}
.liq-card{margin-bottom:20px;padding:16px;background:linear-gradient(135deg,rgba(139,92,246,0.1),rgba(139,92,246,0.05));border:1px solid rgba(139,92,246,0.3);border-radius:12px}
.liq-card.liq-alert{background:linear-gradient(135deg,rgba(255,69,58,0.15),rgba(255,69,58,0.05));border-color:rgba(255,69,58,0.5);animation:liq-pulse 2s infinite}
@keyframes liq-pulse{0%,100%{box-shadow:0 0 0 0 rgba(255,69,58,0.4)}50%{box-shadow:0 0 20px 5px rgba(255,69,58,0.2)}}
.liq-header{display:flex;align-items:center;gap:10px;margin-bottom:12px}
.liq-icon{font-size:20px}
.liq-title{font-size:14px;font-weight:600;color:#8b5cf6}
.liq-warning{font-size:12px;color:var(--r);font-weight:700;margin-left:auto;animation:blink 1s infinite}
@keyframes blink{50%{opacity:0.5}}
.liq-stats{display:flex;gap:24px;flex-wrap:wrap}
.liq-stat{display:flex;flex-direction:column;gap:2px}
.liq-stat.liq-main{min-width:140px}
.liq-label{font-size:10px;color:var(--t3);text-transform:uppercase}
.liq-value{font-size:16px;font-weight:600;color:var(--t)}
.liq-value.liq-danger{color:var(--r);font-size:20px}
.liq-footer{display:flex;justify-content:space-between;align-items:center;margin-top:12px;padding-top:10px;border-top:1px solid rgba(139,92,246,0.2)}
.liq-updated{font-size:10px;color:var(--t3)}
.liq-link{font-size:11px;color:#8b5cf6;text-decoration:none}
.liq-link:hover{text-decoration:underline}
.liq-note{color:var(--nansen);margin-left:auto}
.liq-note-text{font-size:11px;color:var(--nansen);margin:8px 0;padding:8px;background:rgba(245,158,11,0.1);border-radius:6px}
.liq-safe{font-size:11px;color:var(--g);font-weight:600}
.liq-balance{font-size:14px;font-weight:700;color:var(--t);margin-left:auto}
.liq-interest .liq-value{color:var(--nansen);font-weight:700}
.liq-redemption-section{margin-top:16px;padding:14px;background:rgba(239,68,68,0.1);border:1px solid rgba(239,68,68,0.3);border-radius:10px}
.liq-redemption-header{display:flex;align-items:center;gap:8px;margin-bottom:10px}
.liq-redemption-icon{font-size:16px}
.liq-redemption-title{font-size:12px;font-weight:600;color:#ef4444}
.liq-redemption-stats{display:flex;gap:20px;flex-wrap:wrap}
.liq-redemption-rate{color:#ef4444;font-weight:700}
.liq-safe-text{color:var(--g)}
.liq-recommendation{margin-top:12px;padding:10px 12px;border-radius:8px;font-size:12px;line-height:1.5}
.liq-rec-safe{background:rgba(48,209,88,0.1);border:1px solid rgba(48,209,88,0.3);color:var(--g)}
.liq-rec-warning{background:rgba(255,69,58,0.1);border:1px solid rgba(255,69,58,0.3);color:var(--r)}
.liq-analysis-accordion{margin-top:12px}
.liq-analysis-toggle{display:flex;justify-content:space-between;align-items:center;padding:10px 12px;background:rgba(139,92,246,0.1);border:1px solid rgba(139,92,246,0.2);border-radius:8px;cursor:pointer;font-size:12px;font-weight:500;color:#8b5cf6;list-style:none}
.liq-analysis-toggle::-webkit-details-marker{display:none}
.liq-analysis-toggle:hover{background:rgba(139,92,246,0.15)}
.liq-analysis-content{padding:14px;margin-top:6px;background:#111;border-radius:8px;border-left:3px solid #8b5cf6}
.liq-pool-rates{display:flex;gap:16px;margin-bottom:14px;flex-wrap:wrap}
.liq-pool-rate{display:flex;flex-direction:column;gap:2px;padding:8px 12px;background:#0a0a0a;border-radius:6px;min-width:100px}
.liq-pool-name{font-size:12px;font-weight:600;color:var(--t)}
.liq-pool-avg{font-size:10px;color:var(--t2)}
.liq-pool-last{font-size:10px;color:#ef4444}
.liq-rates-table{font-size:11px}
.liq-rates-header{display:grid;grid-template-columns:60px 70px 100px 1fr;gap:8px;padding:6px 8px;background:#0a0a0a;border-radius:6px 6px 0 0;font-weight:600;color:var(--t2)}
.liq-rates-row{display:grid;grid-template-columns:60px 70px 100px 1fr;gap:8px;padding:6px 8px;border-bottom:1px solid var(--border)}
.liq-rates-row:last-child{border-bottom:none}
.liq-rates-row.liq-current{background:rgba(139,92,246,0.15);border-left:2px solid #8b5cf6}
.liq-rates-row.liq-risky{opacity:0.7}
.liq-rate-val{font-weight:600}
.liq-rate-risk{font-size:10px}
.liq-risk-low{color:var(--g)}
.liq-risk-medium{color:var(--nansen)}
.liq-risk-high{color:var(--r)}
.liq-rate-note{font-size:10px;color:var(--t3)}
.liq-data-note{margin-top:12px;font-size:10px;color:var(--t3);font-style:italic}
.liq-live-badge{font-size:10px;background:var(--r);color:#fff;padding:2px 6px;border-radius:4px;margin-left:auto;animation:pulse 2s infinite}
.liq-tx-link{margin-top:10px;font-size:11px}
.liq-tx-link a{color:#8b5cf6;text-decoration:none;display:inline-flex;align-items:center;gap:4px;padding:6px 10px;background:rgba(139,92,246,0.1);border-radius:6px;transition:all 0.2s}
.liq-tx-link a:hover{background:rgba(139,92,246,0.2);color:#a78bfa}
</style></head>
<body><div class="container">
<header>
  <h1>📊 Forum Monitor</h1>
  <div class="header-right">
    <button class="refresh-btn" onclick="requestRefresh()" id="refreshBtn">
      <span>🔄</span> Refresh AI & Nansen
    </button>
    <div class="status">
      <div>Last sync: ${data.lastPush?.substring(11, 19) || 'Never'} UTC${refreshPending}</div>
      <div>🤖 AI: ${summaryTime} | 📊 Nansen: ${nansenTime}</div>
      <div class="model-badge">Model: ${escapeHtml(geminiModel)}</div>
    </div>
  </div>
</header>
${xtbHtml}
${fisherHtml}
${watchlistHtml}
${liquityHtml}
<div class="grid">${cardsHtml}</div>
<div class="live-feed-section">
  <div class="live-feed-header">
    <h2>📡 Live Feed</h2>
    <span class="live-indicator">🔴 LIVE</span>
  </div>
  <div class="live-feed-content">
    ${liveFeedHtml}
  </div>
</div>
</div>
<div class="toast" id="toast"></div>
<script>
function showToast(msg, type) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.className = 'toast show ' + type;
  setTimeout(() => t.className = 'toast', 3000);
}

async function requestRefresh() {
  const btn = document.getElementById('refreshBtn');
  btn.disabled = true;
  btn.classList.add('loading');
  btn.innerHTML = '<span>⏳</span> Requesting...';
  
  try {
    const res = await fetch('/api/refresh', { method: 'POST' });
    const data = await res.json();
    if (data.success) {
      showToast('✅ Refresh requested! Will update in ~1 min', 'success');
      btn.innerHTML = '<span>✅</span> Requested';
      setTimeout(() => location.reload(), 70000);
    } else {
      throw new Error('Failed');
    }
  } catch (e) {
    showToast('❌ Failed to request refresh', 'error');
    btn.innerHTML = '<span>🔄</span> Refresh AI & Nansen';
    btn.disabled = false;
    btn.classList.remove('loading');
  }
}

// XTB read tracking
function markXtbRead(videoId) {
  if (!videoId) return;
  localStorage.setItem('xtb_read_' + videoId, 'true');
  const badge = document.getElementById('xtbNewBadge');
  if (badge) badge.classList.add('read');
}

function checkXtbRead() {
  const accordion = document.getElementById('xtbAccordion');
  if (!accordion) return;
  const videoId = accordion.dataset.videoId;
  if (videoId && localStorage.getItem('xtb_read_' + videoId)) {
    const badge = document.getElementById('xtbNewBadge');
    if (badge) badge.classList.add('read');
  }
}
checkXtbRead();

setTimeout(()=>location.reload(),60000);
</script>
</body></html>`);
});

app.listen(PORT, () => console.log(`📊 Dashboard on :${PORT}`));
