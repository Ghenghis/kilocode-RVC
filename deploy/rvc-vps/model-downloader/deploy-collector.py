#!/usr/bin/env python3
"""
Upload collect-voice-models.sh to VPS and run it in background via Paramiko.
Uses password auth from env/.env.ssh
"""

import os
import sys
import time
import paramiko

# VPS connection details
VPS_HOST = "187.77.30.206"
VPS_PORT = 22
VPS_USER = "root"
VPS_PASS = "6dg0J/YnLtNaR7Mx4J-v"

REMOTE_DIR = "/opt/rvc-models"
REMOTE_SCRIPT = f"{REMOTE_DIR}/collect-voice-models.sh"
REMOTE_LOG = f"{REMOTE_DIR}/collection-progress.log"
MODELS_DIR = f"{REMOTE_DIR}/models"

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
LOCAL_SCRIPT = os.path.join(SCRIPT_DIR, "collect-voice-models.sh")


def connect():
    """Create SSH client with password auth."""
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    print(f"[*] Connecting to {VPS_HOST}:{VPS_PORT}...")
    client.connect(VPS_HOST, port=VPS_PORT, username=VPS_USER, password=VPS_PASS, timeout=30)
    print("[+] Connected!")
    return client


def run_cmd(client, cmd, timeout=30):
    """Run command and return stdout."""
    stdin, stdout, stderr = client.exec_command(cmd, timeout=timeout)
    exit_code = stdout.channel.recv_exit_status()
    out = stdout.read().decode("utf-8", errors="replace").strip()
    err = stderr.read().decode("utf-8", errors="replace").strip()
    return exit_code, out, err


def upload_script(client):
    """Upload collect-voice-models.sh via SFTP."""
    sftp = client.open_sftp()

    # Ensure remote directory exists
    try:
        sftp.stat(REMOTE_DIR)
    except FileNotFoundError:
        print(f"[*] Creating {REMOTE_DIR}")
        run_cmd(client, f"mkdir -p {REMOTE_DIR}")

    print(f"[*] Uploading {LOCAL_SCRIPT} -> {REMOTE_SCRIPT}")
    sftp.put(LOCAL_SCRIPT, REMOTE_SCRIPT)
    sftp.chmod(REMOTE_SCRIPT, 0o755)
    print("[+] Script uploaded and made executable")
    sftp.close()


def check_prerequisites(client):
    """Verify VPS has required tools."""
    print("[*] Checking prerequisites...")

    # Check disk space
    code, out, err = run_cmd(client, f"df -h {REMOTE_DIR} 2>/dev/null || df -h /")
    print(f"    Disk: {out.splitlines()[-1] if out else 'unknown'}")

    # Check for required tools
    for tool in ["curl", "python3", "unzip"]:
        code, out, err = run_cmd(client, f"which {tool}")
        if code != 0:
            print(f"[!] Installing {tool}...")
            run_cmd(client, f"apt-get install -y {tool}", timeout=60)
        else:
            print(f"    {tool}: {out}")

    # Ensure models directory exists
    run_cmd(client, f"mkdir -p {MODELS_DIR}")
    print("[+] Prerequisites OK")


def start_collection(client):
    """Start the collection script in background with nohup."""
    print("[*] Starting collection in background...")

    # Kill any existing collection process
    run_cmd(client, "pkill -f collect-voice-models.sh 2>/dev/null || true")
    time.sleep(1)

    # Run with nohup in background, logging to file
    cmd = (
        f"nohup bash {REMOTE_SCRIPT} {MODELS_DIR} "
        f"> {REMOTE_LOG} 2>&1 &"
    )
    code, out, err = run_cmd(client, cmd)
    time.sleep(2)

    # Verify it's running
    code, out, err = run_cmd(client, "pgrep -f collect-voice-models.sh")
    if code == 0:
        pid = out.strip().split("\n")[0]
        print(f"[+] Collection running! PID: {pid}")
        print(f"    Log: {REMOTE_LOG}")
        print(f"    Models: {MODELS_DIR}")
        print()
        print("    Monitor with:")
        print(f"      ssh root@{VPS_HOST} 'tail -f {REMOTE_LOG}'")
        print(f"      ssh root@{VPS_HOST} 'du -sh {MODELS_DIR}'")
    else:
        print("[!] Process may have exited already. Checking log...")
        code, out, err = run_cmd(client, f"tail -20 {REMOTE_LOG}")
        print(out)


def check_status(client):
    """Check current collection status."""
    print("[*] Checking collection status...")

    # Is it running?
    code, out, err = run_cmd(client, "pgrep -f collect-voice-models.sh")
    if code == 0:
        print(f"[+] Collection is RUNNING (PID: {out.strip()})")
    else:
        print("[-] Collection is NOT running")

    # Show last 15 lines of log
    code, out, err = run_cmd(client, f"tail -15 {REMOTE_LOG} 2>/dev/null")
    if out:
        print("\n--- Recent log ---")
        print(out)

    # Show disk usage
    code, out, err = run_cmd(client, f"du -sh {MODELS_DIR} 2>/dev/null")
    if out:
        print(f"\n    Total models size: {out.split()[0]}")

    code, out, err = run_cmd(client, f"ls {MODELS_DIR}/ 2>/dev/null | wc -l")
    if out:
        print(f"    Model directories: {out.strip()}")

    code, out, err = run_cmd(client, f"df -h {MODELS_DIR} | tail -1")
    if out:
        parts = out.split()
        print(f"    Disk remaining: {parts[3] if len(parts) > 3 else 'unknown'}")


def main():
    action = sys.argv[1] if len(sys.argv) > 1 else "deploy"

    client = connect()

    try:
        if action == "deploy":
            check_prerequisites(client)
            upload_script(client)
            start_collection(client)
        elif action == "status":
            check_status(client)
        elif action == "logs":
            code, out, err = run_cmd(client, f"tail -50 {REMOTE_LOG}", timeout=10)
            print(out)
        elif action == "stop":
            run_cmd(client, "pkill -f collect-voice-models.sh")
            print("[+] Collection stopped")
        else:
            print(f"Usage: {sys.argv[0]} [deploy|status|logs|stop]")
    finally:
        client.close()


if __name__ == "__main__":
    main()
