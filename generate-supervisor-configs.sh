#!/bin/bash
# Generate Supervisor program configs from VK_DOMAINS environment variable
#
# Usage: generate-supervisor-configs.sh [output_file]
# Environment: VK_DOMAINS - comma-separated list of domains (e.g., "domainA.com,domainB.com")
#
# Port allocation:
# - Base dashboard port: 3005
# - Base vibe-kanban port: 3007
# - Each additional domain gets ports incremented by 2

set -e

OUTPUT_FILE="${1:-/etc/supervisor/conf.d/dynamic/vk-instances.conf}"
DOMAINS="${VK_DOMAINS:-}"

# Base ports for the first (default) domain
DASHBOARD_BASE_PORT=4300
KANBAN_BASE_PORT=4301

# Create output directory if it doesn't exist
mkdir -p "$(dirname "$OUTPUT_FILE")"

# Start generating the config
cat > "$OUTPUT_FILE" <<'EOF'
# Auto-generated supervisor programs for multi-tenant VK deployment
# Generated from VK_DOMAINS environment variable
# DO NOT EDIT - this file is regenerated on container startup

EOF

# If no domains specified, don't create any additional instances
# (the base instances at 3005/3007 are already in supervisord.conf)
if [ -z "$DOMAINS" ]; then
    echo "No VK_DOMAINS specified - using only default instances (ports 3005, 3007)"
    exit 0
fi

# Process each domain and create supervisor programs
DOMAIN_INDEX=0
IFS=',' read -ra DOMAIN_ARRAY <<< "$DOMAINS"

for domain in "${DOMAIN_ARRAY[@]}"; do
    # Trim whitespace
    domain=$(echo "$domain" | xargs)

    if [ -n "$domain" ]; then
        # Each domain gets 2 sequential ports starting from base + (index * 2)
        DASHBOARD_PORT=$((DASHBOARD_BASE_PORT + (DOMAIN_INDEX * 2)))
        KANBAN_PORT=$((KANBAN_BASE_PORT + (DOMAIN_INDEX * 2)))

        # Create a safe program name (replace dots and dashes with underscores)
        SAFE_DOMAIN=$(echo "$domain" | tr '.-' '_')

        # Only create additional instances (skip the first one as it's in base config)
        if [ $DOMAIN_INDEX -gt 0 ]; then
            # Generate vibe-dashboard program
            cat >> "$OUTPUT_FILE" <<EOF
; Vibe Dashboard for $domain
[program:vibe-dashboard-${SAFE_DOMAIN}]
command=sh -c 'cd /home/vkuser/repos/vibe-kanban-vscode-web && npm start'
autostart=true
autorestart=true
stdout_logfile=/dev/fd/1
stdout_logfile_maxbytes=0
stderr_logfile=/dev/fd/2
stderr_logfile_maxbytes=0
environment=HOST="0.0.0.0",PORT="$DASHBOARD_PORT",HOME="/home/vkuser",XDG_CONFIG_HOME="/home/vkuser/.config",PATH="/home/vkuser/.npm-global/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"
user=vkuser
directory=/home/vkuser/repos/vibe-kanban-vscode-web

; Vibe Kanban for $domain
[program:vibe-kanban-${SAFE_DOMAIN}]
command=sh -c 'npx vibe-kanban@\${VIBE_KANBAN_VERSION:-latest}'
autostart=true
autorestart=true
stdout_logfile=/dev/fd/1
stdout_logfile_maxbytes=0
stderr_logfile=/dev/fd/2
stderr_logfile_maxbytes=0
environment=HOST="0.0.0.0",PORT="$KANBAN_PORT",VIBE_KANBAN_VERSION="%(ENV_VIBE_KANBAN_VERSION)s",VK_SHARED_API_BASE="%(ENV_VK_SHARED_API_BASE)s",HOME="/home/vkuser",XDG_CONFIG_HOME="/home/vkuser/.config",PATH="/home/vkuser/.npm-global/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"
user=vkuser
directory=/home/vkuser/repos

EOF
            echo "Created supervisor programs for $domain (dashboard:$DASHBOARD_PORT, kanban:$KANBAN_PORT)"
        else
            echo "Skipping $domain (using base config at ports $DASHBOARD_PORT, $KANBAN_PORT)"
        fi

        DOMAIN_INDEX=$((DOMAIN_INDEX + 1))
    fi
done

ADDITIONAL_COUNT=$((${#DOMAIN_ARRAY[@]} - 1))
if [ $ADDITIONAL_COUNT -gt 0 ]; then
    echo "Generated supervisor configs for $ADDITIONAL_COUNT additional domain(s) -> $OUTPUT_FILE"
else
    echo "Using base supervisor config for single domain"
fi
