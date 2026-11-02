#!/usr/bin/env bash
set -euo pipefail

if systemctl is-active --quiet k3s; then
  echo 'K3s is already running.'
  exit 0
fi

for port in 80 443; do
  if ss -lnt "( sport = :$port )" | grep -q LISTEN; then
    echo "Port $port is already in use. Inspect the existing service before installing K3s." >&2
    exit 1
  fi
done

curl -sfL https://get.k3s.io | sudo sh -
sudo k3s kubectl get nodes
