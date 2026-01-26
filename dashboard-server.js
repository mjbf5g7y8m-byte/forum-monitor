const express = require('express');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;
const DATA_FILE = '/opt/gnosis-monitor/data.json';
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
  if (mins < 60) return `${mins} min`;
  return `${Math.floor(mins / 60)}h ${mins % 60}m`;
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
  const { forums, prices, activity, summaries, nansen, snapshot, lastCheck, lastSummary, lastNansen, lastSnapshot, geminiModel } = req.body;
  const data = loadData();
  const wasRefreshRequested = data.refreshRequested || false;
  if (forums) data.forums = forums;
  if (prices) data.prices = prices;
  if (activity) data.activity = activity;
  if (summaries) data.summaries = summaries;
  if (nansen) data.nansen = nansen;
  if (snapshot) data.snapshot = snapshot;
  if (lastCheck) data.lastCheck = lastCheck;
  if (lastSummary) data.lastSummary = lastSummary;
  if (lastNansen) data.lastNansen = lastNansen;
  if (lastSnapshot) data.lastSnapshot = lastSnapshot;
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
        <span class="topic-title">${escapeHtml(t.title?.substring(0, 60))}</span>
        <span class="topic-meta">💬${t.posts_count} 👁️${t.views}</span>
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
      ${transfersHtml}
      ${topicsHtml}
    </div>`;
  }

  const getForumUrl = (id) => {
    const urls = { gnosis: 'https://forum.gnosis.io', cow: 'https://forum.cow.fi', safe: 'https://forum.safe.global', stakewise: 'https://forum.stakewise.io', wnxm: 'https://forum.nexusmutual.io' };
    return urls[id] || '';
  };

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

  const summaryTime = data.lastSummary ? timeAgo(data.lastSummary) : 'N/A';
  const nansenTime = data.lastNansen ? timeAgo(data.lastNansen) : 'N/A';
  const refreshPending = data.refreshRequested ? ' (⏳ refresh pending)' : '';

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
.value{color:var(--g)}
.tx-link{color:var(--nansen);text-decoration:none;font-size:10px}
.tx-link:hover{text-decoration:underline}
.nansen-age{font-size:10px;color:var(--t3);margin-top:8px;text-align:right}
.topics{display:flex;flex-direction:column;gap:6px;margin-top:12px}
.topic{display:flex;justify-content:space-between;align-items:center;padding:8px 10px;background:#111;border-radius:6px;text-decoration:none;color:var(--t);transition:background 0.2s;font-size:12px}
.topic:hover{background:#1a1a1a}
.topic-title{flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-right:10px}
.topic-meta{font-size:10px;color:var(--t2);white-space:nowrap}
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
.toast{position:fixed;bottom:20px;right:20px;background:#1a1a1a;border:1px solid var(--border);padding:12px 20px;border-radius:8px;font-size:13px;opacity:0;transform:translateY(20px);transition:all 0.3s}
.toast.show{opacity:1;transform:translateY(0)}
.toast.success{border-color:var(--g);color:var(--g)}
.toast.error{border-color:var(--r);color:var(--r)}
@media(max-width:768px){body{padding:15px}.grid{grid-template-columns:1fr}}
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
<div class="grid">${cardsHtml}</div>
<div class="activity-section">
  <h2>📋 Recent Activity</h2>
  ${activityHtml}
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

setTimeout(()=>location.reload(),60000);
</script>
</body></html>`);
});

app.listen(PORT, () => console.log(`📊 Dashboard on :${PORT}`));
