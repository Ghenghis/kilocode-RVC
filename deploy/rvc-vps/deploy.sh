#!/usr/bin/env bash
#
# One-shot deployment script for KiloCode Voice Server
# Deploys to voice.daveai.tech (187.77.30.206)
#
# Prerequisites:
#   - SSH key access to the VPS
#   - Docker and docker-compose installed on VPS
#   - nginx installed on VPS
#
# Usage: ./deploy.sh [ssh_user]
#   ssh_user defaults to "root"

set -euo pipefail

VPS_HOST="187.77.30.206"
VPS_DOMAIN="voice.daveai.tech"
SSH_USER="${1:-root}"
REMOTE_DIR="/opt/kilocode-voice"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

ssh_cmd() {
    ssh -o StrictHostKeyChecking=accept-new "${SSH_USER}@${VPS_HOST}" "$@"
}

echo "============================================"
echo "  KiloCode Voice Server Deployment"
echo "  Target: ${SSH_USER}@${VPS_HOST}"
echo "  Domain: ${VPS_DOMAIN}"
echo "  Remote: ${REMOTE_DIR}"
echo "============================================"
echo ""

# ------------------------------------------------------------------
# Step 1: Create remote directory structure
# ------------------------------------------------------------------
echo "[1/6] Creating remote directories..."
ssh_cmd "mkdir -p ${REMOTE_DIR}/{edge-tts-server,model-downloader,models}"
echo "       Done."
echo ""

# ------------------------------------------------------------------
# Step 2: Copy deployment files to VPS
# ------------------------------------------------------------------
echo "[2/6] Copying files to VPS..."

scp -o StrictHostKeyChecking=accept-new \
    "${SCRIPT_DIR}/docker-compose.yml" \
    "${SCRIPT_DIR}/model-server-nginx.conf" \
    "${SSH_USER}@${VPS_HOST}:${REMOTE_DIR}/"

scp -o StrictHostKeyChecking=accept-new \
    "${SCRIPT_DIR}/edge-tts-server/Dockerfile" \
    "${SCRIPT_DIR}/edge-tts-server/server.py" \
    "${SCRIPT_DIR}/edge-tts-server/requirements.txt" \
    "${SSH_USER}@${VPS_HOST}:${REMOTE_DIR}/edge-tts-server/"

scp -o StrictHostKeyChecking=accept-new \
    "${SCRIPT_DIR}/model-downloader/download-models.sh" \
    "${SSH_USER}@${VPS_HOST}:${REMOTE_DIR}/model-downloader/"

ssh_cmd "chmod +x ${REMOTE_DIR}/model-downloader/download-models.sh"

echo "       Done."
echo ""

# ------------------------------------------------------------------
# Step 3: Set up nginx site config
# ------------------------------------------------------------------
echo "[3/6] Configuring nginx..."

scp -o StrictHostKeyChecking=accept-new \
    "${SCRIPT_DIR}/nginx-voice.conf" \
    "${SSH_USER}@${VPS_HOST}:/etc/nginx/sites-available/${VPS_DOMAIN}"

scp -o StrictHostKeyChecking=accept-new \
    "${SCRIPT_DIR}/nginx-voice-locations.conf" \
    "${SSH_USER}@${VPS_HOST}:/etc/nginx/snippets/voice-locations.conf"

ssh_cmd "ln -sf /etc/nginx/sites-available/${VPS_DOMAIN} /etc/nginx/sites-enabled/${VPS_DOMAIN}"

# Test nginx config before reloading
if ssh_cmd "nginx -t 2>&1"; then
    ssh_cmd "systemctl reload nginx"
    echo "       nginx reloaded successfully."
else
    echo "       WARNING: nginx config test failed. Check the config on the VPS."
    echo "       Continuing with deployment..."
fi
echo ""

# ------------------------------------------------------------------
# Step 4: Build and start Docker containers
# ------------------------------------------------------------------
echo "[4/6] Building and starting Docker containers..."
ssh_cmd "cd ${REMOTE_DIR} && docker compose build --no-cache && docker compose up -d"
echo "       Done."
echo ""

# ------------------------------------------------------------------
# Step 5: Start model download in background
# ------------------------------------------------------------------
echo "[5/6] Starting model download in background..."
ssh_cmd "nohup ${REMOTE_DIR}/model-downloader/download-models.sh ${REMOTE_DIR}/models \
    > ${REMOTE_DIR}/model-download.log 2>&1 &"
echo "       Download running in background."
echo "       Monitor with: ssh ${SSH_USER}@${VPS_HOST} tail -f ${REMOTE_DIR}/model-download.log"
echo ""

# ------------------------------------------------------------------
# Step 6: Verify health endpoint
# ------------------------------------------------------------------
echo "[6/6] Verifying deployment..."
echo "       Waiting for server to start..."
sleep 5

RETRIES=5
for i in $(seq 1 $RETRIES); do
    if ssh_cmd "curl -sf http://localhost:5050/health" 2>/dev/null; then
        echo ""
        echo "       Health check passed!"
        break
    fi
    if [[ $i -eq $RETRIES ]]; then
        echo "       WARNING: Health check failed after ${RETRIES} attempts."
        echo "       Check logs: ssh ${SSH_USER}@${VPS_HOST} docker compose -f ${REMOTE_DIR}/docker-compose.yml logs"
    else
        echo "       Attempt $i/$RETRIES failed, retrying in 3s..."
        sleep 3
    fi
done

echo ""
echo "============================================"
echo "  Deployment complete!"
echo ""
echo "  Endpoints:"
echo "    Health:     https://${VPS_DOMAIN}/api/health"
echo "    Voices:     https://${VPS_DOMAIN}/api/voices"
echo "    Synthesize: https://${VPS_DOMAIN}/api/synthesize"
echo "    Models:     https://${VPS_DOMAIN}/api/models"
echo "    Model DL:   https://${VPS_DOMAIN}/models/"
echo ""
echo "  Useful commands:"
echo "    Logs:       ssh ${SSH_USER}@${VPS_HOST} docker compose -f ${REMOTE_DIR}/docker-compose.yml logs -f"
echo "    Restart:    ssh ${SSH_USER}@${VPS_HOST} docker compose -f ${REMOTE_DIR}/docker-compose.yml restart"
echo "    DL status:  ssh ${SSH_USER}@${VPS_HOST} tail -f ${REMOTE_DIR}/model-download.log"
echo "============================================"
