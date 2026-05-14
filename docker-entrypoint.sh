#!/bin/bash
set -e

# Fix docker group GID to match the mounted socket
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

# Initialize vibe-kanban-vscode-web repository in repos volume
/usr/local/bin/sync-seeded-repo.sh || true
chown -R vkuser:vkuser /home/vkuser/repos/vibe-kanban-vscode-web 2>/dev/null || true

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

# Execute the main command
exec "$@"
