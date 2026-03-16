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
REPO_DIR=/home/vkuser/repos/vibe-kanban-vscode-web
if [ ! -d "$REPO_DIR/.git" ]; then
    echo "Initializing vibe-kanban-vscode-web repository from build context"
    mkdir -p "$REPO_DIR"

    # Copy project files from a staging location (added during build)
    if [ -d /opt/vibe-kanban-vscode-web-seed ]; then
        echo "Copying project files to $REPO_DIR"
        cp -r /opt/vibe-kanban-vscode-web-seed/. "$REPO_DIR/"
        chown -R vkuser:vkuser "$REPO_DIR"
    else
        echo "Warning: /opt/vibe-kanban-vscode-web-seed not found, creating empty directory"
        chown vkuser:vkuser "$REPO_DIR"
    fi
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

# Background loop: sync ~/.claude.json -> volume every 30s
(
    while true; do
        sleep 30
        if [ -f "$CLAUDE_JSON" ] && [ ! -L "$CLAUDE_JSON" ]; then
            cp "$CLAUDE_JSON" "$CLAUDE_JSON_PERSIST" 2>/dev/null || true
        fi
    done
) &

# Execute the main command
exec "$@"
