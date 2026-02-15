#!/bin/bash
# One-command install: runs moltlaunch setup on server
# Usage: from repo root: bash arwen/INSTALL.sh

cd "$(dirname "$0")/.."
./arwen/DEPLOY_MOLTLAUNCH.sh
