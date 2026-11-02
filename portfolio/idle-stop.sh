#!/usr/bin/env bash
set -euo pipefail

state_dir=/var/lib/flowent-portfolio
last_active_file="$state_dir/last-active"
boot_file="$state_dir/boot-id"
# Sandbox Redis keys expire after 20 minutes of inactivity. Ten more minutes
# without sandbox pods gives an approximately 30-minute total idle window.
idle_seconds=600

mkdir -p "$state_dir"

# A timestamp from before a stop/start must not immediately stop the new boot.
boot_id="$(</proc/sys/kernel/random/boot_id)"
if [[ ! -f "$boot_file" || "$(<"$boot_file")" != "$boot_id" ]]; then
  printf '%s\n' "$boot_id" > "$boot_file"
  date +%s > "$last_active_file"
fi

token="$(curl -fsS --max-time 5 -X PUT -H 'X-aws-ec2-metadata-token-ttl-seconds: 60' http://169.254.169.254/latest/api/token)"
instance_id="$(curl -fsS --max-time 5 -H "X-aws-ec2-metadata-token: $token" http://169.254.169.254/latest/meta-data/instance-id)"
if [[ "$instance_id" != "$EXPECTED_INSTANCE_ID" ]]; then
  echo 'Idle stop is attached to an unexpected instance.' >&2
  exit 1
fi

# A Kubernetes failure is not proof that the server is idle.
if ! sandbox_pods="$(k3s kubectl get pods -l sandboxId -o name --request-timeout=10s)"; then
  date +%s > "$last_active_file"
  echo 'Cannot read sandbox pods; leaving the instance running.' >&2
  exit 1
fi
if [[ -n "$sandbox_pods" ]]; then
  date +%s > "$last_active_file"
  exit 0
fi

now="$(date +%s)"
if [[ ! -f "$last_active_file" ]]; then
  echo "$now" > "$last_active_file"
  exit 0
fi

last_active="$(<"$last_active_file")"
if [[ ! "$last_active" =~ ^[0-9]+$ || "$last_active" -gt "$now" ]]; then
  echo "$now" > "$last_active_file"
  exit 0
fi
if (( now - last_active < idle_seconds )); then
  exit 0
fi

echo 'No sandbox pods for 10 minutes. Stopping the demo instance.'
aws ec2 stop-instances --instance-ids "$instance_id" --region "$AWS_REGION" >/dev/null
