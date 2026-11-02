#!/usr/bin/env bash
set -euo pipefail

repo_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
test_dir="$(mktemp -d /tmp/flowent-idle-test.XXXXXX)"
trap 'rm -rf -- "$test_dir"' EXIT
mkdir -p "$test_dir/bin" "$test_dir/state"
export TEST_DIR="$test_dir" PATH="$test_dir/bin:$PATH"
export EXPECTED_INSTANCE_ID=i-test AWS_REGION=ap-south-1
printf 'current-boot\n' > "$test_dir/boot-id"
sed -e "s#state_dir=/var/lib/flowent-portfolio#state_dir=$test_dir/state#" \
    -e "s#/proc/sys/kernel/random/boot_id#$test_dir/boot-id#g" \
    "$repo_dir/idle-stop.sh" > "$test_dir/script.sh"
printf '%s\n' '#!/usr/bin/env bash' 'echo "${MOCK_INSTANCE_ID:-i-test}"' > "$test_dir/bin/curl"
printf '%s\n' '#!/usr/bin/env bash' \
  'if [[ "${MOCK_K3S:-}" == error ]]; then exit 1; fi' \
  'if [[ "${MOCK_K3S:-}" == active ]]; then echo pod/sandbox-test; fi' > "$test_dir/bin/k3s"
printf '%s\n' '#!/usr/bin/env bash' 'printf "%s\n" "$*" >> "$TEST_DIR/aws-calls"' > "$test_dir/bin/aws"
chmod +x "$test_dir/bin/"*

assert_no_stop() { [[ ! -s "$test_dir/aws-calls" ]] || { echo 'Unexpected stop request' >&2; exit 1; }; }
expire_timer() { printf '%s\n' "$(( $(date +%s) - 700 ))" > "$test_dir/state/last-active"; }

expire_timer
bash "$test_dir/script.sh"
assert_no_stop
echo 'PASS: a new boot resets the old idle timestamp'

expire_timer
MOCK_K3S=active bash "$test_dir/script.sh"
assert_no_stop
echo 'PASS: an active sandbox prevents shutdown'

expire_timer
if MOCK_K3S=error bash "$test_dir/script.sh"; then exit 1; fi
assert_no_stop
echo 'PASS: Kubernetes errors prevent shutdown'

expire_timer
if MOCK_INSTANCE_ID=i-wrong bash "$test_dir/script.sh"; then exit 1; fi
assert_no_stop
echo 'PASS: the wrong EC2 instance cannot be stopped'

printf 'invalid\n' > "$test_dir/state/last-active"
bash "$test_dir/script.sh"
assert_no_stop
echo 'PASS: an invalid timestamp resets safely'

expire_timer
bash "$test_dir/script.sh"
grep -q '^ec2 stop-instances --instance-ids i-test --region ap-south-1$' "$test_dir/aws-calls"
echo 'PASS: an idle server stops only the expected instance'
