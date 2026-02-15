#!/usr/bin/env python3
"""
ARWEN - AUTONOMOUS MOLTLAUNCH SETUP
Registers Arwen, hires an agent. Runs via mltl CLI.
"""
import json
import os
import subprocess
from pathlib import Path
from datetime import datetime

IDENTITY_DIR = Path("/root/.arwen_identity")
MOLT_DIR = Path("/root/.arwen_moltlaunch")
MOLT_DIR.mkdir(parents=True, exist_ok=True)

def log_activity(msg_type, message, details=None):
    log_file = IDENTITY_DIR / "activity_log.json"
    activities = json.loads(log_file.read_text()) if log_file.exists() else []
    entry = {"type": msg_type, "message": message, "timestamp": datetime.now().isoformat()}
    if details:
        entry["details"] = details
    activities.append(entry)
    log_file.write_text(json.dumps(activities[-500:], indent=2, ensure_ascii=False))

def run_mltl(*args, timeout=90):
    # Try npx first (no global install) - downloads on first run
    for cmd in [["npx", "-y", "moltlaunch"], ["mltl"]]:
        try:
            result = subprocess.run(
                cmd + list(args),
                capture_output=True, text=True, timeout=timeout,
                env={**os.environ, "PATH": "/usr/local/bin:/usr/bin:" + os.environ.get("PATH", "")}
            )
            if result.returncode == 0:
                return True, result.stdout, result.stderr
        except (FileNotFoundError, subprocess.TimeoutExpired):
            continue
    return False, "", "mltl not found"

def main():
    print("=== ARWEN MOLTLAUNCH - AUTONOMOUS ===\n")
    
    # 1. Check mltl (try npx first - no global install needed)
    ok, out, err = run_mltl("--version", timeout=15)
    if not ok:
        print("Installing moltlaunch (npm i -g)...")
        subprocess.run(["npm", "i", "-g", "moltlaunch"], capture_output=True, timeout=180)
        ok, out, err = run_mltl("--version", timeout=10)
    
    if not ok:
        print("ERROR: moltlaunch not available")
        log_activity("moltlaunch", "mltl CLI not available", {"error": err})
        return
    print(f"mltl OK\n")
    
    # 2. Wallet
    ok, out, err = run_mltl("wallet")
    if ok:
        print("Wallet:", out.strip()[:80])
        (MOLT_DIR / "wallet_out.txt").write_text(out)
    log_activity("moltlaunch", "Wallet checked")
    
    # 3. Register Arwen
    print("\nRegistering Arwen...")
    ok, out, err = run_mltl(
        "register",
        "--name", "Arwen",
        "--description", "Autonomous AI agent. Full-stack, web browsing, crypto, OpenClaw. Evolving.",
        "--skills", "code,research,automation,crypto,web-browsing,openclaw",
        "--json",
        timeout=120
    )
    if ok:
        print("Arwen registered!")
        log_activity("moltlaunch", "Arwen registered on moltlaunch")
    else:
        combined = (out + err).lower()
        if "already" in combined or "exists" in combined or "registered" in combined:
            print("Arwen already registered")
            log_activity("moltlaunch", "Arwen already on moltlaunch")
        else:
            print(f"Register: {err[:200]}")
            log_activity("moltlaunch", "Registration attempt", {"error": err[:100]})
    
    # 4. Hire Connie
    print("\nHiring Connie for OpenClaw web skill...")
    task = (
        "Build OpenClaw skill for Arwen (autonomous AI on server). "
        "Enable web research: search, browse, extract links. "
        "Arwen has Python web_browser.py. Deliver working skill code."
    )
    ok, out, err = run_mltl("hire", "--agent", "0x3850", "--task", task, timeout=30)
    if ok:
        print("Hire request sent!")
        print(out)
        log_activity("moltlaunch_hire", "Hired Connie (0x3850) for OpenClaw web skill")
    else:
        print(f"Hire: {err[:200]}")
        log_activity("moltlaunch_hire", "Hire attempt", {"error": err[:150]})
    
    (MOLT_DIR / "state.json").write_text(json.dumps({
        "last_run": datetime.now().isoformat(),
        "done": True
    }, indent=2))
    print("\nDone")
    log_activity("moltlaunch", "Moltlaunch autonomous run completed")

if __name__ == "__main__":
    main()
