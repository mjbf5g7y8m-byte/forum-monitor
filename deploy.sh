#!/bin/bash
# Deploy Forum Monitor to DigitalOcean App Platform

set -e

echo "🚀 Forum Monitor - DigitalOcean Deployment"
echo "==========================================="

# Check if doctl is authenticated
if ! /tmp/doctl auth list >/dev/null 2>&1; then
    echo ""
    echo "❌ doctl not authenticated"
    echo ""
    echo "1. Go to https://cloud.digitalocean.com/account/api/tokens"
    echo "2. Generate a new token with read/write access"
    echo "3. Run: /tmp/doctl auth init"
    echo "4. Paste your token when prompted"
    echo ""
    exit 1
fi

echo "✅ doctl authenticated"

# Check if app exists
APP_ID=$(/tmp/doctl apps list --format ID,Spec.Name --no-header 2>/dev/null | grep forum-monitor | awk '{print $1}')

if [ -n "$APP_ID" ]; then
    echo "📦 Updating existing app: $APP_ID"
    /tmp/doctl apps update $APP_ID --spec .do/app.yaml
else
    echo "📦 Creating new app..."
    /tmp/doctl apps create --spec .do/app.yaml
fi

echo ""
echo "✅ Deployment initiated!"
echo ""
echo "🔧 Don't forget to set environment variables in the DO dashboard:"
echo "   - gemini"
echo "   - BROWSERBASE_API_KEY"
echo "   - BROWSERBASE_PROJECT_ID"
echo "   - ETHERSCAN_API_KEY"
echo "   - DUNE_API_KEY (optional)"
echo "   - TELEGRAM_BOT_TOKEN (optional)"
echo "   - TELEGRAM_CHAT_ID (optional)"
echo ""
echo "📊 Check deployment status: /tmp/doctl apps list"
