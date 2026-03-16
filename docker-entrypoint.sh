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
CLAUDE_JSON="/home/vkuser/.claude.json"
CLAUDE_JSON_PERSIST="/home/vkuser/.claude/claude.json"
if [ -f "$CLAUDE_JSON" ] && [ ! -L "$CLAUDE_JSON" ]; then
    # First boot after fresh install: move existing file into the volume
    mv "$CLAUDE_JSON" "$CLAUDE_JSON_PERSIST"
    ln -s "$CLAUDE_JSON_PERSIST" "$CLAUDE_JSON"
    chown -h vkuser:vkuser "$CLAUDE_JSON"
elif [ ! -e "$CLAUDE_JSON" ] && [ -f "$CLAUDE_JSON_PERSIST" ]; then
    # Container recreated but volume has the file from a previous run
    ln -s "$CLAUDE_JSON_PERSIST" "$CLAUDE_JSON"
    chown -h vkuser:vkuser "$CLAUDE_JSON"
elif [ ! -e "$CLAUDE_JSON" ] && [ ! -f "$CLAUDE_JSON_PERSIST" ]; then
    # First time ever: create the symlink so claude writes directly into the volume
    ln -s "$CLAUDE_JSON_PERSIST" "$CLAUDE_JSON"
    chown -h vkuser:vkuser "$CLAUDE_JSON"
fi

# Execute the main command
exec "$@"
