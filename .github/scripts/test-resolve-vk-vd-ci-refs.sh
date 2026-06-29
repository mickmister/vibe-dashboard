#!/usr/bin/env bash

set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
resolver="${script_dir}/resolve-vk-vd-ci-refs.sh"

tmpdir="$(mktemp -d)"
trap 'rm -rf "$tmpdir"' EXIT

git config --global --add safe.directory "$tmpdir" >/dev/null 2>&1 || true

make_repo() {
  local name="$1"
  local work="$tmpdir/${name}-work"
  local bare="$tmpdir/${name}.git"

  git init --quiet --initial-branch=main "$work"
  git -C "$work" config user.email test@example.com
  git -C "$work" config user.name "Resolver Test"
  printf '%s main\n' "$name" > "$work/README.md"
  git -C "$work" add README.md
  git -C "$work" commit --quiet -m "main"
  git -C "$work" clone --quiet --bare . "$bare"
  git -C "$work" remote add origin "$bare"
  git -C "$work" push --quiet --set-upstream origin main

  printf '%s\n' "$work"
}

add_branch_commit() {
  local work="$1"
  local branch="$2"
  local file="$3"
  local content="$4"

  git -C "$work" checkout --quiet -B "$branch" main
  printf '%s\n' "$content" > "$work/$file"
  git -C "$work" add "$file"
  git -C "$work" commit --quiet -m "$branch"
  git -C "$work" push --quiet --set-upstream origin "$branch"
}

read_output() {
  local file="$1"
  local key="$2"
  grep -E "^${key}=" "$file" | tail -n 1 | cut -d= -f2-
}

run_resolver() {
  local output_file="$tmpdir/output-$RANDOM.env"
  : > "$output_file"

  env -i \
    PATH="$PATH" \
    HOME="$HOME" \
    DEFAULT_BRANCH=main \
    VD_REPO_URL="$vd_bare" \
    VK_REPO_URL_INPUT="$vk_bare" \
    SKIP_ASSET_FALLBACK=true \
    GITHUB_OUTPUT="$output_file" \
    "$@" \
    "$resolver" >/dev/null

  printf '%s\n' "$output_file"
}

assert_equals() {
  local expected="$1"
  local actual="$2"
  local message="$3"
  if [[ "$actual" != "$expected" ]]; then
    echo "not ok - $message" >&2
    echo "  expected: $expected" >&2
    echo "  actual:   $actual" >&2
    exit 1
  fi
}

vd_work="$(make_repo vd)"
vk_work="$(make_repo vk)"
vd_bare="$tmpdir/vd.git"
vk_bare="$tmpdir/vk.git"

add_branch_commit "$vd_work" "feature/sync" "vd-feature.txt" "vd feature"
add_branch_commit "$vk_work" "feature/sync" "vk-feature.txt" "vk feature"
add_branch_commit "$vd_work" "feature/vd-only" "vd-only.txt" "vd only"

vd_feature_sha="$(git -C "$vd_work" rev-parse feature/sync)"
vd_only_sha="$(git -C "$vd_work" rev-parse feature/vd-only)"
vd_main_sha="$(git -C "$vd_work" rev-parse main)"
vk_feature_sha="$(git -C "$vk_work" rev-parse feature/sync)"
vk_main_sha="$(git -C "$vk_work" rev-parse main)"

output="$(run_resolver \
  GITHUB_EVENT_NAME=push \
  GITHUB_REF=refs/heads/feature/sync \
  GITHUB_REF_NAME=feature/sync \
  GITHUB_SHA="$vd_feature_sha")"
assert_equals "feature/sync" "$(read_output "$output" vk_branch)" "push selects same-named VK branch"
assert_equals "$vk_feature_sha" "$(read_output "$output" vk_commit)" "push resolves same-named VK commit"
assert_equals "$vd_feature_sha" "$(read_output "$output" vd_commit)" "push keeps VD event commit"

output="$(run_resolver \
  GITHUB_EVENT_NAME=push \
  GITHUB_REF=refs/heads/feature/vd-only \
  GITHUB_REF_NAME=feature/vd-only \
  GITHUB_SHA="$vd_only_sha")"
assert_equals "main" "$(read_output "$output" vk_branch)" "push falls back to VK main when matching branch is absent"
assert_equals "$vk_main_sha" "$(read_output "$output" vk_commit)" "push fallback resolves VK main commit"

output="$(run_resolver \
  GITHUB_EVENT_NAME=repository_dispatch \
  REPOSITORY_DISPATCH_VK_REF="$vk_feature_sha" \
  REPOSITORY_DISPATCH_VK_SOURCE_REF=refs/heads/feature/sync \
  REPOSITORY_DISPATCH_VK_SOURCE_REF_NAME=feature/sync)"
assert_equals "feature/sync" "$(read_output "$output" vd_branch)" "dispatch selects same-named VD branch"
assert_equals "$vd_feature_sha" "$(read_output "$output" vd_commit)" "dispatch resolves same-named VD commit"
assert_equals "$vk_feature_sha" "$(read_output "$output" vk_commit)" "dispatch preserves VK asset SHA"

output="$(run_resolver \
  GITHUB_EVENT_NAME=repository_dispatch \
  REPOSITORY_DISPATCH_VK_REF="$vk_feature_sha" \
  REPOSITORY_DISPATCH_VK_SOURCE_REF=refs/heads/feature/vk-only \
  REPOSITORY_DISPATCH_VK_SOURCE_REF_NAME=feature/vk-only)"
assert_equals "main" "$(read_output "$output" vd_branch)" "dispatch falls back to VD main when matching branch is absent"
assert_equals "$vd_main_sha" "$(read_output "$output" vd_commit)" "dispatch fallback resolves VD main commit"

output="$(run_resolver \
  GITHUB_EVENT_NAME=repository_dispatch \
  REPOSITORY_DISPATCH_VK_REF="$vk_feature_sha" \
  REPOSITORY_DISPATCH_VK_SOURCE_REF=refs/tags/v1.2.3 \
  REPOSITORY_DISPATCH_VK_SOURCE_REF_NAME=v1.2.3)"
assert_equals "main" "$(read_output "$output" vd_branch)" "tag dispatch falls back to VD main"

echo "ok - resolve-vk-vd-ci-refs"
