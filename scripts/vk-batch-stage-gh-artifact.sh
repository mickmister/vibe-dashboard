#!/usr/bin/env bash
set -euo pipefail

MODE=${1:-download}
if [ "$MODE" != "status" ] && [ "$MODE" != "download" ] && [ "$MODE" != "apply" ]; then
  echo "Usage: $0 [status|download|apply] [--wait] [--confirm-non-dry-run]" >&2
  exit 2
fi

WAIT=0
CONFIRMED=0
for arg in "${@:2}"; do
  case "$arg" in
    --wait)
      WAIT=1
      ;;
    --confirm-non-dry-run)
      CONFIRMED=1
      ;;
    *)
      echo "Unexpected argument: $arg" >&2
      exit 2
      ;;
  esac
done

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
VD_REPO=$(cd "$SCRIPT_DIR/.." && pwd)
DEFAULT_VK_REPO=$(cd "$VD_REPO/.." && pwd)/Vktest

VK_REPO=${VK_REPO:-$DEFAULT_VK_REPO}
VK_REF=${VK_REF:-HEAD}
VK_GH_REPO=${VK_GH_REPO:-mickmister/vibe-kanban}
VK_GH_WORKFLOW=${VK_GH_WORKFLOW:-Release Binaries}
VK_GH_RUN_ID=${VK_GH_RUN_ID:-}
VK_GH_REQUIRE_TEST_WORKFLOW=${VK_GH_REQUIRE_TEST_WORKFLOW:-1}
VK_GH_TEST_WORKFLOW=${VK_GH_TEST_WORKFLOW:-Test}
VK_GH_TEST_RUN_ID=${VK_GH_TEST_RUN_ID:-}
VK_GH_ARTIFACT_NAME=${VK_GH_ARTIFACT_NAME:-release-assets-linux-x64}
VK_GH_ARCHIVE_NAME=${VK_GH_ARCHIVE_NAME:-vibe-kanban-linux-x64.tar.gz}
VK_GH_DOWNLOAD_ROOT=${VK_GH_DOWNLOAD_ROOT:-/var/tmp/vk-gh-release-artifacts}
VK_GH_WAIT_INTERVAL_SECONDS=${VK_GH_WAIT_INTERVAL_SECONDS:-30}
VK_GH_WAIT_TIMEOUT_SECONDS=${VK_GH_WAIT_TIMEOUT_SECONDS:-5400}
VK_GH_LOG=${VK_GH_LOG:-/tmp/vk-batch-stage-gh-artifact-$(date -u +%Y%m%dT%H%M%SZ).log}

exec > >(tee -a "$VK_GH_LOG") 2>&1

export PATH=/usr/local/cargo/bin:/home/vkuser/.local/bin:/usr/local/bin:/usr/bin:/bin:/usr/local/games:/usr/games

fail() {
  echo "[vk-gh-artifact] ERROR: $*" >&2
  exit 1
}

require_command() {
  command -v "$1" >/dev/null 2>&1 || fail "missing required command: $1"
}

resolve_target_sha() {
  git -C "$VK_REPO" rev-parse "$VK_REF"
}

resolve_run_id() {
  local workflow="$1"
  local run_id_override="$2"

  if [ -n "$run_id_override" ]; then
    printf '%s\n' "$run_id_override"
    return
  fi

  gh run list \
    --repo "$VK_GH_REPO" \
    --workflow "$workflow" \
    --limit 50 \
    --json databaseId,headSha,createdAt \
    --jq ".[] | select(.headSha == \"$TARGET_SHA\") | .databaseId" |
    head -n 1
}

run_field() {
  local run_id="$1"
  local field="$2"
  gh run view "$run_id" --repo "$VK_GH_REPO" --json "$field" --jq ".$field"
}

print_workflow_run_summary() {
  local label="$1"
  local run_id="$2"

  echo "[vk-gh-artifact] $label run summary"
  gh run view "$run_id" \
    --repo "$VK_GH_REPO" \
    --json databaseId,status,conclusion,headSha,url,workflowName,jobs \
    --jq '{
      id: .databaseId,
      workflow: .workflowName,
      status: .status,
      conclusion: .conclusion,
      headSha: .headSha,
      url: .url,
      jobs: [.jobs[] | {name, status, conclusion}]
    }'
}

print_release_artifacts() {
  echo
  echo "[vk-gh-artifact] release artifacts"
  gh api "repos/$VK_GH_REPO/actions/runs/$RELEASE_RUN_ID/artifacts" \
    --jq '.artifacts[]? | {name, expired, size_in_bytes}'
}

print_run_summary() {
  print_workflow_run_summary "release" "$RELEASE_RUN_ID"

  if [ "$VK_GH_REQUIRE_TEST_WORKFLOW" = "1" ]; then
    echo
    print_workflow_run_summary "test" "$TEST_RUN_ID"
  else
    echo
    echo "[vk-gh-artifact] test workflow requirement disabled by VK_GH_REQUIRE_TEST_WORKFLOW=0"
  fi

  print_release_artifacts
}

wait_for_run() {
  local label="$1"
  local run_id="$2"
  local started
  started=$(date +%s)

  while true; do
    local status conclusion elapsed
    status=$(run_field "$run_id" status)
    conclusion=$(run_field "$run_id" conclusion)
    elapsed=$(($(date +%s) - started))

    echo "[vk-gh-artifact] $label run $run_id status=$status conclusion=${conclusion:-none} elapsed=${elapsed}s"

    if [ "$status" = "completed" ]; then
      [ "$conclusion" = "success" ] || fail "$label run $run_id completed with conclusion=$conclusion"
      return
    fi

    if [ "$elapsed" -ge "$VK_GH_WAIT_TIMEOUT_SECONDS" ]; then
      fail "timed out waiting for $label run $run_id after ${elapsed}s"
    fi

    sleep "$VK_GH_WAIT_INTERVAL_SECONDS"
  done
}

require_successful_workflow_run() {
  local label="$1"
  local run_id="$2"
  local expected_workflow="$3"
  local run_sha workflow status conclusion
  run_sha=$(run_field "$run_id" headSha)
  workflow=$(run_field "$run_id" workflowName)
  status=$(run_field "$run_id" status)
  conclusion=$(run_field "$run_id" conclusion)

  [ "$run_sha" = "$TARGET_SHA" ] || fail "$label run $run_id head SHA mismatch: expected $TARGET_SHA, got $run_sha"
  [ "$workflow" = "$expected_workflow" ] || fail "$label run $run_id workflow mismatch: expected $expected_workflow, got $workflow"

  if [ "$status" != "completed" ]; then
    if [ "$WAIT" = "1" ]; then
      wait_for_run "$label" "$run_id"
    else
      fail "$label run $run_id is $status; re-run with --wait or wait for CI to finish"
    fi
  elif [ "$conclusion" != "success" ]; then
    fail "$label run $run_id completed with conclusion=$conclusion"
  fi
}

require_successful_runs() {
  require_successful_workflow_run "release" "$RELEASE_RUN_ID" "$VK_GH_WORKFLOW"

  if [ "$VK_GH_REQUIRE_TEST_WORKFLOW" = "1" ]; then
    require_successful_workflow_run "test" "$TEST_RUN_ID" "$VK_GH_TEST_WORKFLOW"
  fi
}

download_artifact() {
  local run_dir artifact_dir archive checksum extract_dir binary
  run_dir="$VK_GH_DOWNLOAD_ROOT/$TARGET_SHA/$RELEASE_RUN_ID"
  artifact_dir="$run_dir/$VK_GH_ARTIFACT_NAME"
  extract_dir="$run_dir/extracted"

  rm -rf "$artifact_dir" "$extract_dir"
  mkdir -p "$artifact_dir" "$extract_dir"

  echo "[vk-gh-artifact] downloading artifact $VK_GH_ARTIFACT_NAME from release run $RELEASE_RUN_ID"
  gh run download "$RELEASE_RUN_ID" \
    --repo "$VK_GH_REPO" \
    --name "$VK_GH_ARTIFACT_NAME" \
    --dir "$artifact_dir"

  archive="$artifact_dir/$VK_GH_ARCHIVE_NAME"
  [ -s "$archive" ] || fail "downloaded artifact does not contain expected archive: $VK_GH_ARCHIVE_NAME"
  checksum="${archive}.sha256"
  [ -s "$checksum" ] || fail "downloaded artifact is missing checksum file: $checksum"

  echo "[vk-gh-artifact] verifying archive checksum"
  (cd "$artifact_dir" && sha256sum -c "$(basename "$checksum")")

  echo "[vk-gh-artifact] extracting $archive"
  tar -xzf "$archive" -C "$extract_dir"
  binary="$extract_dir/vibe-kanban"
  [ -f "$binary" ] || fail "archive did not contain vibe-kanban binary"
  chmod 0755 "$binary"
  [ -x "$binary" ] || fail "extracted binary is not executable: $binary"

  if strings "$binary" | grep -q 'Please build @vibe/local-web first'; then
    fail "downloaded binary embeds local-web placeholder"
  fi

  BINARY_SHA=$(sha256sum "$binary" | awk '{print $1}')
  VERSION_LABEL=${VK_VERSION_LABEL:-weekly-dev-vk-${TARGET_SHORT_SHA}-sha256-${BINARY_SHA:0:8}}

  echo "[vk-gh-artifact] verified binary: $binary"
  echo "[vk-gh-artifact] binary sha: $BINARY_SHA"
  echo "[vk-gh-artifact] version label: $VERSION_LABEL"
  echo "[vk-gh-artifact] export VK_ARTIFACT=$binary"
  echo "[vk-gh-artifact] export VK_VERSION_LABEL=$VERSION_LABEL"

  VK_ARTIFACT="$binary"
  VK_VERSION_LABEL="$VERSION_LABEL"
}

require_command git
require_command gh
require_command sha256sum
require_command strings
require_command tar

git -C "$VK_REPO" rev-parse --is-inside-work-tree >/dev/null 2>&1 || fail "VK_REPO is not a git repo: $VK_REPO"

TARGET_SHA=$(resolve_target_sha)
TARGET_SHORT_SHA=$(git -C "$VK_REPO" rev-parse --short "$TARGET_SHA")
RELEASE_RUN_ID=$(resolve_run_id "$VK_GH_WORKFLOW" "$VK_GH_RUN_ID")
TEST_RUN_ID=
if [ "$VK_GH_REQUIRE_TEST_WORKFLOW" = "1" ]; then
  TEST_RUN_ID=$(resolve_run_id "$VK_GH_TEST_WORKFLOW" "$VK_GH_TEST_RUN_ID")
fi

echo "[vk-gh-artifact] starting at $(date -u +%Y-%m-%dT%H:%M:%SZ)"
echo "[vk-gh-artifact] log: $VK_GH_LOG"
echo "[vk-gh-artifact] GH repo: $VK_GH_REPO"
echo "[vk-gh-artifact] workflow: $VK_GH_WORKFLOW"
echo "[vk-gh-artifact] test workflow required: $VK_GH_REQUIRE_TEST_WORKFLOW"
echo "[vk-gh-artifact] test workflow: $VK_GH_TEST_WORKFLOW"
echo "[vk-gh-artifact] VK repo: $VK_REPO"
echo "[vk-gh-artifact] VK ref: $VK_REF"
echo "[vk-gh-artifact] target sha: $TARGET_SHA"
echo "[vk-gh-artifact] release run id: ${RELEASE_RUN_ID:-none}"
echo "[vk-gh-artifact] test run id: ${TEST_RUN_ID:-none}"

[ -n "$RELEASE_RUN_ID" ] || fail "no $VK_GH_WORKFLOW run found for $TARGET_SHA"
if [ "$VK_GH_REQUIRE_TEST_WORKFLOW" = "1" ]; then
  [ -n "$TEST_RUN_ID" ] || fail "no $VK_GH_TEST_WORKFLOW run found for $TARGET_SHA"
fi

print_run_summary

if [ "$MODE" = "status" ]; then
  exit 0
fi

require_successful_runs
download_artifact

if [ "$MODE" = "download" ]; then
  echo "[vk-gh-artifact] download mode complete"
  exit 0
fi

if [ "$CONFIRMED" != "1" ]; then
  fail "apply mode requires --confirm-non-dry-run"
fi

echo "[vk-gh-artifact] applying verified GitHub Actions artifact"
env \
  VK_REPO="$VK_REPO" \
  VK_ARTIFACT="$VK_ARTIFACT" \
  VK_VERSION_LABEL="$VK_VERSION_LABEL" \
  VK_PLATFORM="${VK_PLATFORM:-linux-x64}" \
  VK_SUPERVISOR_PROGRAM="${VK_SUPERVISOR_PROGRAM:-vibe-kanban}" \
  VK_API_BASE="${VK_API_BASE:-http://127.0.0.1:3007}" \
  VK_HOTSWAP_ID="${VK_HOTSWAP_ID:-vk-gh-artifact-${TARGET_SHORT_SHA}-$(date -u +%Y%m%dT%H%M%SZ)}" \
  VK_HOTSWAP_LOG="${VK_HOTSWAP_LOG:-/tmp/vk-gh-artifact-hotswap-${TARGET_SHORT_SHA}-$(date -u +%Y%m%dT%H%M%SZ).log}" \
  bash "$SCRIPT_DIR/vk-batch-stage-hotswap-apply.sh"

echo "[vk-gh-artifact] completed at $(date -u +%Y-%m-%dT%H:%M:%SZ)"
