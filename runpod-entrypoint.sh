#!/bin/bash
set -euo pipefail

PERSIST_ROOT="${RUNPOD_PERSIST_ROOT:-/workspace/vibe-kanban-vscode-web}"
PERSIST_HOME="$PERSIST_ROOT/home/vkuser"
PERSIST_REPOS="$PERSIST_ROOT/repos"
PERSIST_WORKTREES="$PERSIST_ROOT/worktrees"
PERSIST_TAILSCALE="$PERSIST_ROOT/var/lib/tailscale"

mkdir -p \
  "$PERSIST_HOME" \
  "$PERSIST_REPOS" \
  "$PERSIST_WORKTREES" \
  "$PERSIST_TAILSCALE"

ensure_symlink_dir() {
  local target="$1"
  local persisted="$2"

  mkdir -p "$(dirname "$target")" "$(dirname "$persisted")"

  if [ -L "$target" ]; then
    ln -sfn "$persisted" "$target"
    return
  fi

  if [ -e "$target" ]; then
    mkdir -p "$persisted"
    if [ -z "$(find "$persisted" -mindepth 1 -maxdepth 1 2>/dev/null)" ]; then
      cp -a "$target/." "$persisted/" 2>/dev/null || true
    fi
    rm -rf "$target"
  else
    mkdir -p "$persisted"
  fi

  ln -sfn "$persisted" "$target"
}

ensure_symlink_file() {
  local target="$1"
  local persisted="$2"

  mkdir -p "$(dirname "$target")" "$(dirname "$persisted")"

  if [ -L "$target" ]; then
    ln -sfn "$persisted" "$target"
    return
  fi

  if [ -f "$target" ] && [ ! -f "$persisted" ]; then
    cp -a "$target" "$persisted"
  fi

  rm -f "$target"
  touch "$persisted"
  ln -sfn "$persisted" "$target"
}

ensure_owned_path() {
  local target="$1"
  local recurse="${2:-false}"

  if [ ! -e "$target" ] && [ ! -L "$target" ]; then
    return
  fi

  local owner
  owner="$(stat -c '%u:%g' "$target" 2>/dev/null || true)"
  if [ "$owner" = "1000:1000" ]; then
    return
  fi

  if [ "$recurse" = "true" ]; then
    chown -R vkuser:vkuser "$target"
  else
    chown vkuser:vkuser "$target"
  fi
}

# Persist all mutable vkuser state into /workspace.
ensure_symlink_dir /home/vkuser/repos "$PERSIST_REPOS"
ensure_symlink_dir /home/vkuser/.local/share/vibe-kanban "$PERSIST_HOME/.local/share/vibe-kanban"
ensure_symlink_dir /home/vkuser/.local/share/code-server "$PERSIST_HOME/.local/share/code-server"
ensure_symlink_dir /home/vkuser/.config/code-server "$PERSIST_HOME/.config/code-server"
ensure_symlink_dir /home/vkuser/.config/gh "$PERSIST_HOME/.config/gh"
ensure_symlink_dir /home/vkuser/.config/git "$PERSIST_HOME/.config/git"
ensure_symlink_dir /home/vkuser/.codex "$PERSIST_HOME/.codex"
ensure_symlink_dir /home/vkuser/.claude "$PERSIST_HOME/.claude"
ensure_symlink_dir /home/vkuser/.openclaw "$PERSIST_HOME/.openclaw"
ensure_symlink_dir /home/vkuser/.ssh "$PERSIST_HOME/.ssh"
ensure_symlink_dir /home/vkuser/.npm "$PERSIST_HOME/.npm"
ensure_symlink_dir /home/vkuser/.cache "$PERSIST_HOME/.cache"
ensure_symlink_dir /home/vkuser/.local/share/pnpm "$PERSIST_HOME/.local/share/pnpm"
ensure_symlink_dir /home/vkuser/bosun "$PERSIST_HOME/bosun"
ensure_symlink_dir /var/tmp/vibe-kanban/worktrees "$PERSIST_WORKTREES"
ensure_symlink_dir /var/lib/tailscale "$PERSIST_TAILSCALE"
ensure_symlink_file /home/vkuser/.claude.json "$PERSIST_HOME/.claude.json"
ensure_symlink_file /home/vkuser/.gitconfig "$PERSIST_HOME/.gitconfig"
ensure_symlink_file /home/vkuser/.npmrc "$PERSIST_HOME/.npmrc"

rm -rf /var/run/tailscale
mkdir -p /var/run/tailscale

for persistent_path in \
  "$PERSIST_ROOT" \
  "$PERSIST_REPOS" \
  "$PERSIST_WORKTREES" \
  "$PERSIST_TAILSCALE" \
  "$PERSIST_HOME/.local/share/vibe-kanban" \
  "$PERSIST_HOME/.local/share/code-server" \
  "$PERSIST_HOME/.config/code-server" \
  "$PERSIST_HOME/.config/gh" \
  "$PERSIST_HOME/.config/git" \
  "$PERSIST_HOME/.codex" \
  "$PERSIST_HOME/.claude" \
  "$PERSIST_HOME/.openclaw" \
  "$PERSIST_HOME/.ssh" \
  "$PERSIST_HOME/.npm" \
  "$PERSIST_HOME/.cache" \
  "$PERSIST_HOME/.local/share/pnpm" \
  "$PERSIST_HOME/bosun"; do
  ensure_owned_path "$persistent_path" true
done

for persistent_file in \
  "$PERSIST_HOME/.claude.json" \
  "$PERSIST_HOME/.gitconfig" \
  "$PERSIST_HOME/.npmrc"; do
  ensure_owned_path "$persistent_file"
done

ensure_owned_path /home/vkuser true
ensure_owned_path /var/tmp/vibe-kanban true
ensure_owned_path /var/run/tailscale true
chmod 755 /var/lib/tailscale /var/run/tailscale || true

# Fix docker group GID to match the mounted socket when a docker sock is provided.
if [ -S /var/run/docker.sock ]; then
    DOCKER_SOCK_GID=$(stat -c '%g' /var/run/docker.sock)

    if getent group docker > /dev/null 2>&1; then
        CURRENT_DOCKER_GID=$(getent group docker | cut -d: -f3)
        if [ "$CURRENT_DOCKER_GID" != "$DOCKER_SOCK_GID" ]; then
            echo "Updating docker group GID from $CURRENT_DOCKER_GID to $DOCKER_SOCK_GID to match socket"
            groupmod -g "$DOCKER_SOCK_GID" docker
        fi
    else
        EXISTING_GROUP=$(getent group "$DOCKER_SOCK_GID" | cut -d: -f1)
        if [ -n "$EXISTING_GROUP" ]; then
            echo "GID $DOCKER_SOCK_GID already used by group '$EXISTING_GROUP', renaming it to docker"
            groupmod -n docker "$EXISTING_GROUP"
        else
            echo "Creating docker group with GID $DOCKER_SOCK_GID to match socket"
            groupadd -g "$DOCKER_SOCK_GID" docker
        fi
        usermod -aG docker vkuser
    fi
fi

# Initialize vibe-kanban-vscode-web repository inside the persisted /workspace tree.
REPO_DIR=/home/vkuser/repos/vibe-kanban-vscode-web
if [ ! -d "$REPO_DIR/.git" ]; then
    echo "Initializing vibe-kanban-vscode-web repository from build context"
    mkdir -p "$REPO_DIR"

    if [ -d /opt/vibe-kanban-vscode-web-seed ]; then
        cp -a /opt/vibe-kanban-vscode-web-seed/. "$REPO_DIR/"
        chown -R vkuser:vkuser "$REPO_DIR"
    else
        echo "Warning: /opt/vibe-kanban-vscode-web-seed not found, creating empty directory"
        chown vkuser:vkuser "$REPO_DIR"
    fi
fi

exec "$@"
