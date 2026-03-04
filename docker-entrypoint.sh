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
        echo "Creating docker group with GID $DOCKER_SOCK_GID to match socket"
        groupadd -g "$DOCKER_SOCK_GID" docker
        usermod -aG docker vkuser
    fi
fi

# Ensure vibe-kanban-vscode-web directory exists in repos volume
if [ ! -d /home/vkuser/repos/vibe-kanban-vscode-web ]; then
    echo "Creating /home/vkuser/repos/vibe-kanban-vscode-web directory"
    mkdir -p /home/vkuser/repos/vibe-kanban-vscode-web
    chown vkuser:vkuser /home/vkuser/repos/vibe-kanban-vscode-web
fi

# Execute the main command
exec "$@"
