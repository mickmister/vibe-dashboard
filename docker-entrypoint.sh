#!/bin/bash
set -e
umask 0002

startup_log() {
    printf '%s [startup] %s\n' "$(date -Iseconds)" "$*"
}

startup_step_begin() {
    STARTUP_STEP_LABEL="$1"
    STARTUP_STEP_START="$(date +%s)"
    startup_log "BEGIN ${STARTUP_STEP_LABEL}"
}

startup_step_end() {
    local status="${1:-0}"
    local end
    end="$(date +%s)"
    startup_log "END ${STARTUP_STEP_LABEL} status=${status} duration=$((end - STARTUP_STEP_START))s"
}

startup_debug_path_summary() {
    [ "${VD_STARTUP_DEBUG:-true}" = "true" ] || return 0
    local path="$1"
    if [ ! -e "$path" ]; then
        startup_log "DEBUG path=${path} missing"
        return 0
    fi
    local counts
    counts="$(find "$path" -xdev -printf '%y\n' 2>/dev/null | awk '
        { entries += 1 }
        $1 == "d" { dirs += 1 }
        $1 == "f" { files += 1 }
        END { printf "entries=%d dirs=%d files=%d", entries, dirs, files }
    ')"
    startup_log "DEBUG path=${path} ${counts:-entries=unknown dirs=unknown files=unknown}"
}

ensure_shared_dir() {
    local path
    mkdir -p "$@"
    for path in "$@"; do
        if getent group vkadmin > /dev/null 2>&1; then
            chgrp vkadmin "$path" 2>/dev/null || true
        fi
        chmod g+rwXs "$path" 2>/dev/null || true
    done
}

ensure_vkuser_shared_dir() {
    local path
    mkdir -p "$@"
    for path in "$@"; do
        if getent group vkadmin > /dev/null 2>&1; then
            chown vkuser:vkadmin "$path" 2>/dev/null || true
        else
            chown vkuser "$path" 2>/dev/null || true
        fi
        chmod g+rwXs "$path" 2>/dev/null || true
    done
}

# Fix docker group GID to match the mounted socket
startup_step_begin "configure docker socket group"
if [ -S /var/run/docker.sock ]; then
    DOCKER_SOCK_GID=$(stat -c '%g' /var/run/docker.sock)

    # Check if docker group exists
    if getent group docker > /dev/null 2>&1; then
        CURRENT_DOCKER_GID=$(getent group docker | cut -d: -f3)

        # If GIDs don't match, update the docker group
        if [ "$CURRENT_DOCKER_GID" != "$DOCKER_SOCK_GID" ]; then
            echo "Updating docker group GID from $CURRENT_DOCKER_GID to $DOCKER_SOCK_GID to match socket"
            groupmod -g "$DOCKER_SOCK_GID" docker
        fi
    else
        # Create docker group with correct GID
        # First check if the GID is already used by another group
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
startup_step_end

# Ensure mounted mutable volumes keep shared group write semantics. This avoids
# recurring chown -R fixes when root startup tasks and vkuser agents both manage
# runtime state.
startup_step_begin "prepare shared runtime volume roots"
startup_debug_path_summary /var/lib/vd
startup_debug_path_summary /var/tmp/vibe-kanban
ensure_shared_dir /var/lib/vd /var/tmp/vibe-kanban
startup_step_end

# Initialize vibe-kanban-vscode-web repository in repos volume. The seed copy
# runs as vkuser, so preserved repos do not need recursive permission repair
# on every startup.
startup_step_begin "prepare repository root directory"
ensure_vkuser_shared_dir /home/vkuser/repos /home/vkuser/repos/vibe-kanban-vscode-web
startup_step_end

startup_step_begin "sync seeded repository"
/usr/local/bin/sync-seeded-repo.sh || true
startup_step_end

startup_debug_path_summary /home/vkuser/repos/vibe-kanban-vscode-web
startup_log "Skipping recursive repository permission repair; repository files are created as vkuser"

# Ensure the packaged vibe-dashboard runtime directory exists before supervisord starts
startup_step_begin "prepare vibe-dashboard runtime directory"
mkdir -p /home/vkuser/.local/share/vibe-dashboard-runtime
chown -R vkuser:vkuser /home/vkuser/.local/share/vibe-dashboard-runtime 2>/dev/null || true
startup_step_end

# Ensure plugin runtime paths and the plugin-owned Caddy import exist before
# supervisord starts. Plugin artifact installation intentionally runs after
# Caddy starts so first boot is not blocked on large downloads.
startup_step_begin "prepare plugin runtime directories"
mkdir -p /var/lib/vd/instance-config /var/lib/vd/plugin-cache /var/lib/vd/plugins /var/lib/vd/plugin-bin /var/lib/vd/toolchains/bin /var/lib/vd/toolchains/npm /var/lib/vd/plugin-data /var/lib/vd/silverbullet/space /etc/supervisor/conf.d/vd-generated /etc/caddy
ensure_shared_dir /var/lib/vd /var/lib/vd/instance-config /var/lib/vd/plugin-cache /var/lib/vd/plugins /var/lib/vd/plugin-bin /var/lib/vd/toolchains /var/lib/vd/plugin-data /var/lib/vd/silverbullet
startup_debug_path_summary /var/lib/vd
startup_step_end
if [ ! -f /etc/caddy/plugins.caddy ]; then
    cat > /etc/caddy/plugins.caddy <<'EOF'
# VD plugin-owned Caddy routes.
# Runtime plugin apply writes generated routes here after Caddy starts, then reloads Caddy.
EOF
fi

# Persist ~/.claude.json via the claude-data volume (which mounts ~/.claude/)
# We restore from the volume on startup. A background sync loop copies changes
# back into the volume so they survive container recreation.
CLAUDE_JSON="/home/vkuser/.claude.json"
CLAUDE_JSON_PERSIST="/home/vkuser/.claude/claude.json"
if [ -f "$CLAUDE_JSON_PERSIST" ] && [ ! -f "$CLAUDE_JSON" ]; then
    # Restore from volume into home dir on container recreate
    cp "$CLAUDE_JSON_PERSIST" "$CLAUDE_JSON"
    chown vkuser:vkuser "$CLAUDE_JSON"
elif [ -f "$CLAUDE_JSON" ] && [ ! -L "$CLAUDE_JSON" ] && [ -f "$CLAUDE_JSON_PERSIST" ]; then
    # Both exist (shouldn't normally happen) — keep the newer one
    if [ "$CLAUDE_JSON" -nt "$CLAUDE_JSON_PERSIST" ]; then
        cp "$CLAUDE_JSON" "$CLAUDE_JSON_PERSIST"
    else
        cp "$CLAUDE_JSON_PERSIST" "$CLAUDE_JSON"
        chown vkuser:vkuser "$CLAUDE_JSON"
    fi
fi

# Watch for writes to ~/.claude.json and sync to volume on change
(
    while inotifywait -qq -e close_write -e moved_to /home/vkuser/.claude.json 2>/dev/null || \
          inotifywait -qq -e create /home/vkuser/ 2>/dev/null; do
        if [ -f "$CLAUDE_JSON" ] && [ ! -L "$CLAUDE_JSON" ]; then
            cp "$CLAUDE_JSON" "$CLAUDE_JSON_PERSIST" 2>/dev/null || true
        fi
    done
) &

startup_log "Startup preparation complete; exec: $*"
# Execute the main command
exec "$@"
