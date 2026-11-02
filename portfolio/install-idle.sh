#!/usr/bin/env bash
set -euo pipefail

if [[ "${EXPECTED_INSTANCE_ID:-}" != i-* || "${AWS_REGION:-}" == '' ]]; then
  echo 'Set EXPECTED_INSTANCE_ID and AWS_REGION before installing idle stop.' >&2
  exit 1
fi

repo_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
sudo install -m 0755 "$repo_dir/idle-stop.sh" /usr/local/bin/flowent-idle-stop
sudo install -m 0644 "$repo_dir/flowent-idle.service" /etc/systemd/system/flowent-idle.service
sudo install -m 0644 "$repo_dir/flowent-idle.timer" /etc/systemd/system/flowent-idle.timer
printf 'EXPECTED_INSTANCE_ID=%s\nAWS_REGION=%s\n' "$EXPECTED_INSTANCE_ID" "$AWS_REGION" | sudo tee /etc/flowent-portfolio.env >/dev/null
sudo chmod 0600 /etc/flowent-portfolio.env
sudo mkdir -p /var/lib/flowent-portfolio
date +%s | sudo tee /var/lib/flowent-portfolio/last-active >/dev/null
sudo systemctl daemon-reload
sudo systemctl enable --now flowent-idle.timer
