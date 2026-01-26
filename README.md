# Forum Monitor

Real-time monitoring dashboard for crypto governance forums with AI summaries, token movements, and Snapshot voting.

## Features

- 📊 **5 Projects**: Gnosis, CoW Protocol, Safe, StakeWise, Nexus Mutual
- 🤖 **AI Summaries**: Gemini-powered forum activity analysis (Czech)
- 📈 **Nansen Data**: Top sells and transfers for each token
- 🗳️ **Snapshot Voting**: Active governance proposals
- 💰 **Price Tracking**: CoinGecko integration with 24h changes
- 🔔 **Telegram Alerts**: Optional notifications for new topics

## Architecture

```
┌─────────────────┐         ┌─────────────────┐
│  monitor.js     │ ──────> │ dashboard-server│
│  (runs locally) │  HTTP   │ (runs on server)│
└─────────────────┘         └─────────────────┘
        │                           │
        ▼                           ▼
   APIs: Discourse,            Web Dashboard
   CoinGecko, Nansen,          http://server:3000
   Gemini, Snapshot
```

## Setup

### 1. Dashboard Server (DigitalOcean/VPS)

```bash
# Install
npm install express

# Run
node dashboard-server.js
# Runs on port 3000
```

### 2. Monitor Script (Local/Mogra)

```bash
# Required env vars
export gemini="your-gemini-api-key"
export NANSEN_API_KEY="your-nansen-api-key"

# Optional
export TELEGRAM_BOT_TOKEN="bot-token"
export TELEGRAM_CHAT_ID="chat-id"

# Run
node monitor.js
```

## Configuration

### Token Addresses (monitor.js)

```javascript
const TOKEN_ADDRESSES = {
  gnosis: { address: '0x6810e776880c02933d47db1b9fc05908e5386b96', chain: 'ethereum' },
  cow: { address: '0xDEf1CA1fb7FBcDC777520aa7f396b4E015F497aB', chain: 'ethereum' },
  safe: { address: '0x5afe3855358e112b5647b952709e6165e1c1eeee', chain: 'ethereum' },
  stakewise: { address: '0x48c3399719b582dd63eb5aadf12a40b4c3f52fa2', chain: 'ethereum' },
  wnxm: { address: '0x0d438f3b5175bebc262bf23753c1e53d03432bde', chain: 'ethereum' }
};
```

### Dashboard URL

Update `DASHBOARD_URL` in monitor.js to point to your server:
```javascript
const DASHBOARD_URL = 'http://YOUR_SERVER:3000/api/push';
```

### API Key

The dashboard uses a simple API key for auth. Change in both files:
```javascript
const API_KEY = 'your-secret-key';
```

## API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/` | GET | Dashboard HTML |
| `/api/data` | GET | Full JSON data |
| `/api/stats` | GET | Quick status |
| `/api/push` | POST | Receive data from monitor |
| `/api/refresh` | POST | Request AI/Nansen refresh |
| `/health` | GET | Health check |

## Intervals

- Forum check: 1 minute
- AI summaries: 1 hour
- Nansen data: 10 minutes
- Snapshot: 5 minutes
- Prices: Every check

## Adding a New Token

1. Add to `TOKEN_ADDRESSES` in monitor.js
2. Add to `SNAPSHOT_SPACES` if it uses Snapshot
3. Add to `FORUMS` with Discourse API URL
4. Add to `FORUMS` in dashboard-server.js

## Nansen API Notes

⚠️ The Nansen API documentation is misleading. Working config:

- Base URL: `https://api.nansen.ai/api/beta/api/v1/tgm/`
- Auth header: `apiKey: YOUR_KEY` (not `api-key` or `Authorization`)
- Date format must be object: `{"from": "2025-01-22", "to": "2025-01-23"}`

## License

MIT
