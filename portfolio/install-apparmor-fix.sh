#!/usr/bin/env bash
set -euo pipefail
repo_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
profile="$repo_dir/apparmor/cri-containerd.apparmor.d"
destination=/etc/apparmor.d/cri-containerd.apparmor.d
baseline=/var/lib/flowent-portfolio/cri-containerd.baseline

# This baseline matches the deployed runtime. Re-review after a runtime upgrade.
runtime_version="$(sudo k3s ctr version)"
[[ "$runtime_version" == *v2.3.4-k3s1.36* ]] || { echo 'Unexpected containerd version.' >&2; exit 1; }
[[ "$(sysctl -n kernel.apparmor_restrict_unprivileged_unconfined)" == 1 ]] || exit 1
if command -v rootlesskit >/dev/null || ps -C containerd -o label= | grep -vqx unconfined; then
  echo 'Runtime profile differs from the reviewed baseline.' >&2
  exit 1
fi
sudo apparmor_parser -Q -K "$profile"
if sudo test -f "$destination" && ! sudo cmp -s "$profile" "$destination"; then
  echo 'A different persistent containerd profile already exists; leaving it intact.' >&2
  exit 1
fi
sudo install -d -m 0700 /var/lib/flowent-portfolio
if ! sudo test -f "$baseline"; then
  # Reconstruct the runtime baseline by removing only the two added peer rules.
  sed '/peer="cri-containerd.apparmor.d\/\/\&unconfined"/d' "$profile" | sudo tee "$baseline" >/dev/null
  sudo chmod 0600 "$baseline"
fi
sudo apparmor_parser -Q -K "$baseline"
sudo install -m 0644 "$profile" "$destination"
sudo apparmor_parser -r -K "$destination"
echo 'Loaded the containerd profile with exact stacked-peer rules; AppArmor stays enforcing.'
echo "Rollback baseline: $baseline"
