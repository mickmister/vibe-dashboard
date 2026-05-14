#!/bin/bash
# Generate Caddy port mappings from VK_DOMAINS environment variable
#
# Usage: generate-caddy-mappings.sh [output_file]
# Environment: VK_DOMAINS - comma-separated list of domains (e.g., "domainA.com,domainB.com")
#
# Port allocation:
# - Base dashboard port: 3005
# - Base vibe-kanban port: 3007
# - Each additional domain gets ports incremented by 2

set -e

OUTPUT_FILE="${1:-/etc/caddy/port-mappings.conf}"
DOMAINS="${VK_DOMAINS:-}"

# Base ports for the first (default) domain
DASHBOARD_BASE_PORT=4300
KANBAN_BASE_PORT=4301

# Create output directory if it doesn't exist
mkdir -p "$(dirname "$OUTPUT_FILE")"

# Start generating the map directive
cat > "$OUTPUT_FILE" <<'EOF'
# Auto-generated port mappings for multi-tenant VK deployment
# Generated from VK_DOMAINS environment variable
# DO NOT EDIT - this file is regenerated on container startup

EOF

# If no domains specified, create a default mapping
if [ -z "$DOMAINS" ]; then
    cat >> "$OUTPUT_FILE" <<EOF
map {host} {dashboard_port} {kanban_port} {
    default    $DASHBOARD_BASE_PORT    $KANBAN_BASE_PORT
}
EOF
    echo "Generated default port mapping (no VK_DOMAINS specified)"
    exit 0
fi

# Start the map block
cat >> "$OUTPUT_FILE" <<EOF
map {host} {dashboard_port} {kanban_port} {
EOF

# Process each domain and assign ports
DOMAIN_INDEX=0
IFS=',' read -ra DOMAIN_ARRAY <<< "$DOMAINS"

for domain in "${DOMAIN_ARRAY[@]}"; do
    # Trim whitespace
    domain=$(echo "$domain" | xargs)

    if [ -n "$domain" ]; then
        # Each domain gets 2 sequential ports starting from base + (index * 2)
        DASHBOARD_PORT=$((DASHBOARD_BASE_PORT + (DOMAIN_INDEX * 2)))
        KANBAN_PORT=$((KANBAN_BASE_PORT + (DOMAIN_INDEX * 2)))

        # Add domain mapping
        printf "    %-30s %d    %d\n" "$domain" "$DASHBOARD_PORT" "$KANBAN_PORT" >> "$OUTPUT_FILE"

        echo "Mapped $domain -> dashboard:$DASHBOARD_PORT, kanban:$KANBAN_PORT"

        DOMAIN_INDEX=$((DOMAIN_INDEX + 1))
    fi
done

# Add default mapping (use first domain's ports or base ports)
cat >> "$OUTPUT_FILE" <<EOF
    default                        $DASHBOARD_BASE_PORT    $KANBAN_BASE_PORT
}
EOF

echo "Generated port mappings for ${#DOMAIN_ARRAY[@]} domain(s) -> $OUTPUT_FILE"
