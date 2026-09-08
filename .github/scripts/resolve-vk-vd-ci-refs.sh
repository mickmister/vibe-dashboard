#!/usr/bin/env bash

set -euo pipefail

default_branch="${DEFAULT_BRANCH:-main}"
github_server_url="${GITHUB_SERVER_URL:-https://github.com}"
github_repository="${GITHUB_REPOSITORY:-mickmister/vibe-dashboard}"
vd_repo_url="${VD_REPO_URL:-${github_server_url}/${github_repository}.git}"
vk_repo_url="${VK_REPO_URL_INPUT:-https://github.com/mickmister/vibe-kanban.git}"
event_name="${GITHUB_EVENT_NAME:-}"

event_ref="${GITHUB_REF:-}"
event_ref_name="${GITHUB_REF_NAME:-}"
event_sha="${GITHUB_SHA:-}"

image_tag_input="${IMAGE_TAG_INPUT:-}"
pr_number="${PR_NUMBER:-}"
pr_head_ref="${PR_HEAD_REF:-}"
pr_head_sha="${PR_HEAD_SHA:-}"
workflow_vk_ref="${WORKFLOW_VK_REF:-}"
repository_dispatch_vk_ref="${REPOSITORY_DISPATCH_VK_REF:-}"
repository_dispatch_vk_source_ref="${REPOSITORY_DISPATCH_VK_SOURCE_REF:-}"
repository_dispatch_vk_source_ref_name="${REPOSITORY_DISPATCH_VK_SOURCE_REF_NAME:-}"

die() {
  echo "::error::$*" >&2
  exit 1
}

notice() {
  echo "::notice::$*"
}

is_full_sha() {
  [[ "${1:-}" =~ ^[0-9a-fA-F]{40}$ ]]
}

head_ref() {
  local branch="$1"
  printf 'refs/heads/%s' "$branch"
}

remote_head_sha() {
  local repo_url="$1"
  local branch="$2"
  git ls-remote --heads "$repo_url" "$branch" | awk 'NR == 1 { print $1 }'
}

resolve_remote_ref_to_sha() {
  local repo_url="$1"
  local ref="$2"
  local tmpdir

  if is_full_sha "$ref"; then
    printf '%s\n' "${ref,,}"
    return 0
  fi

  tmpdir="$(mktemp -d)"
  git -C "$tmpdir" init --quiet
  git -C "$tmpdir" remote add origin "$repo_url"
  git -C "$tmpdir" fetch --depth 1 origin "$ref" >/dev/null 2>&1 || {
    rm -rf "$tmpdir"
    return 1
  }
  git -C "$tmpdir" rev-parse FETCH_HEAD
  rm -rf "$tmpdir"
}

resolve_vd() {
  vd_branch=""
  vd_ref=""
  vd_commit=""
  vd_resolution_source=""

  case "$event_name" in
    pull_request)
      [[ -n "$pr_head_ref" ]] || die "PR_HEAD_REF is required for pull_request events"
      [[ -n "$pr_head_sha" ]] || die "PR_HEAD_SHA is required for pull_request events"
      vd_branch="$pr_head_ref"
      vd_ref="$(head_ref "$vd_branch")"
      vd_commit="$pr_head_sha"
      vd_resolution_source="pull_request_head"
      ;;
    repository_dispatch)
      local candidate_branch=""
      if [[ "$repository_dispatch_vk_source_ref" == refs/heads/* ]]; then
        candidate_branch="${repository_dispatch_vk_source_ref#refs/heads/}"
      elif [[ -n "$repository_dispatch_vk_source_ref_name" && "$repository_dispatch_vk_source_ref" != refs/tags/* ]]; then
        candidate_branch="$repository_dispatch_vk_source_ref_name"
      fi

      if [[ -n "$candidate_branch" ]]; then
        vd_commit="$(remote_head_sha "$vd_repo_url" "$candidate_branch")"
      fi

      if [[ -n "$candidate_branch" && -n "$vd_commit" ]]; then
        vd_branch="$candidate_branch"
        vd_ref="$(head_ref "$vd_branch")"
        vd_resolution_source="matching_vk_source_branch"
      else
        vd_branch="$default_branch"
        vd_ref="$(head_ref "$vd_branch")"
        vd_commit="$(remote_head_sha "$vd_repo_url" "$vd_branch")"
        [[ -n "$vd_commit" ]] || die "Could not resolve VD fallback branch ${vd_branch}"
        vd_resolution_source="fallback_default_branch"
      fi
      ;;
    push)
      [[ -n "$event_ref_name" ]] || die "GITHUB_REF_NAME is required for push events"
      [[ -n "$event_sha" ]] || die "GITHUB_SHA is required for push events"
      vd_branch="$event_ref_name"
      vd_ref="${event_ref:-$(head_ref "$vd_branch")}"
      vd_commit="$event_sha"
      vd_resolution_source="push_ref"
      ;;
    workflow_dispatch)
      if [[ -n "$event_ref_name" ]]; then
        vd_branch="$event_ref_name"
        vd_ref="${event_ref:-$(head_ref "$vd_branch")}"
        if [[ -n "$event_sha" ]]; then
          vd_commit="$event_sha"
        elif [[ "$vd_ref" == refs/heads/* ]]; then
          vd_commit="$(remote_head_sha "$vd_repo_url" "$vd_branch")"
        fi
      fi
      [[ -n "$vd_commit" ]] || die "Could not resolve VD ref for workflow_dispatch"
      vd_resolution_source="workflow_dispatch_ref"
      ;;
    *)
      die "Unsupported event for VD resolution: ${event_name:-<unset>}"
      ;;
  esac
}

resolve_vk() {
  vk_branch=""
  vk_commit=""
  vk_short_commit=""
  vk_resolution_source=""

  case "$event_name" in
    pull_request)
      # PR label events only verify an already-published image; the push workflow
      # produces branch images with resolved VK runtime assets.
      return 0
      ;;
    workflow_dispatch)
      vk_branch="${workflow_vk_ref:-main}"
      vk_resolution_source="workflow_dispatch_input"
      ;;
    repository_dispatch)
      vk_branch="${repository_dispatch_vk_ref:-main}"
      vk_resolution_source="repository_dispatch_payload"
      ;;
    push)
      local candidate_branch="$vd_branch"
      if [[ -n "$(remote_head_sha "$vk_repo_url" "$candidate_branch")" ]]; then
        vk_branch="$candidate_branch"
        vk_resolution_source="matching_vd_branch"
      else
        vk_branch="$default_branch"
        vk_resolution_source="fallback_default_branch"
      fi
      ;;
    *)
      die "Unsupported event for VK resolution: ${event_name:-<unset>}"
      ;;
  esac

  vk_commit="$(resolve_remote_ref_to_sha "$vk_repo_url" "$vk_branch")" \
    || die "Unable to resolve VK ref/SHA: ${vk_branch}"
  vk_short_commit="${vk_commit:0:7}"
}

resolve_asset_fallback_if_needed() {
  used_asset_fallback=false

  if [[ "${SKIP_ASSET_FALLBACK:-false}" == "true" ]]; then
    return 0
  fi

  if [[ "$event_name" != "push" || "$vk_branch" != "$default_branch" || -z "$vk_commit" ]]; then
    return 0
  fi

  local manifest_url="https://github.com/mickmister/vibe-kanban/releases/download/vk-assets-${vk_commit}/manifest.json"
  if curl -fsI "$manifest_url" >/dev/null; then
    return 0
  fi

  notice "VK release assets for $vk_commit are not available yet; using the latest published vk-assets release for this VD branch image."
  local latest_assets_tag
  latest_assets_tag="$(
    curl -fsSL "https://api.github.com/repos/mickmister/vibe-kanban/releases?per_page=100" \
      | python3 -c 'import json,sys; releases=[r for r in json.load(sys.stdin) if r.get("tag_name", "").startswith("vk-assets-")]; releases.sort(key=lambda r: r.get("published_at") or r.get("created_at") or "", reverse=True); print(releases[0]["tag_name"] if releases else "")'
  )"

  [[ -n "$latest_assets_tag" ]] || die "No published vk-assets release found to use as a fallback."

  vk_commit="${latest_assets_tag#vk-assets-}"
  is_full_sha "$vk_commit" || die "Latest vk-assets release tag does not contain a full commit SHA: $latest_assets_tag"

  vk_branch="$latest_assets_tag"
  vk_short_commit="${vk_commit:0:7}"
  vk_resolution_source="latest_assets_fallback"
  used_asset_fallback=true
  notice "Using fallback VK assets release $latest_assets_tag"
}

resolve_publish_latest() {
  publish_latest=false
  if [[ -z "$vk_commit" ]]; then
    return 0
  fi

  local vk_main_commit
  vk_main_commit="$(remote_head_sha "$vk_repo_url" "$default_branch")"
  [[ -n "$vk_main_commit" ]] || die "Could not resolve VK ${default_branch}"

  if [[ "$vd_branch" == "$default_branch" && "$vk_commit" == "$vk_main_commit" && "$used_asset_fallback" != "true" ]]; then
    publish_latest=true
  fi
}

write_outputs() {
  local deploy_pr_preview=false
  if [[ "$event_name" == "pull_request" ]]; then
    deploy_pr_preview=true
  fi

  local vd_short_commit="${vd_commit:0:7}"
  local deploy_image_tag="vd-${vd_commit}"
  local output_file="${GITHUB_OUTPUT:-/dev/stdout}"

  {
    echo "image_tag=$image_tag_input"
    echo "deploy_image_tag=$deploy_image_tag"
    echo "deploy_pr_preview=$deploy_pr_preview"
    echo "pr_number=$pr_number"
    echo "vk_branch=$vk_branch"
    echo "vk_commit=$vk_commit"
    echo "vk_short_commit=$vk_short_commit"
    echo "vk_repo_url=$vk_repo_url"
    echo "vk_resolution_source=$vk_resolution_source"
    echo "vd_branch=$vd_branch"
    echo "vd_ref=$vd_ref"
    echo "vd_commit=$vd_commit"
    echo "vd_short_commit=$vd_short_commit"
    echo "vd_resolution_source=$vd_resolution_source"
    echo "publish_latest=$publish_latest"
  } >> "$output_file"
}

resolve_vd
resolve_vk
resolve_asset_fallback_if_needed
resolve_publish_latest

echo "Resolved VD ${vd_ref} (${vd_resolution_source}) to ${vd_commit}"
if [[ -n "$vk_commit" ]]; then
  echo "Resolved VK ${vk_branch} (${vk_resolution_source}) to ${vk_commit}"
fi
echo "Publish latest: ${publish_latest}"

write_outputs
