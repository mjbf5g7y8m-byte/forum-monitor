#!/bin/bash
# Deploy moltlaunch setup to Arwen server
# Run from repo root: ./arwen/DEPLOY_MOLTLAUNCH.sh
# Or: bash arwen/DEPLOY_MOLTLAUNCH.sh

set -e
cd "$(dirname "$0")/.."
SSH_KEY="${SSH_KEY:-$HOME/.ssh/forum-monitor}"
HOST="${HOST:-root@206.81.21.90}"

echo "=== Deploying Arwen Moltlaunch ==="

# 1. Copy script
scp -i "$SSH_KEY" arwen/moltlaunch_autonomous.py $HOST:/root/arwen_tools/

# 2. Install mltl + run
ssh -i "$SSH_KEY" $HOST << 'REMOTE'
echo "Installing moltlaunch..."
npm i -g moltlaunch 2>/dev/null || true

echo "Running autonomous setup..."
python3 /root/arwen_tools/moltlaunch_autonomous.py

echo "Done. Check: mltl wallet && mltl tasks"
REMOTE

echo "=== Deploy complete ==="
