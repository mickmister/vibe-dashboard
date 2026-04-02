FROM node:22-bookworm

# Install development tools, supervisor, Go (for xcaddy), and GitHub CLI
RUN apt-get update && apt-get install -y \
    curl \
    wget \
    git \
    build-essential \
    python3 \
    supervisor \
    ca-certificates \
    gnupg \
    debian-keyring \
    debian-archive-keyring \
    apt-transport-https \
    ripgrep \
    inotify-tools \
    zsh \
    && curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg | dd of=/usr/share/keyrings/githubcli-archive-keyring.gpg \
    && chmod go+r /usr/share/keyrings/githubcli-archive-keyring.gpg \
    && echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" | tee /etc/apt/sources.list.d/github-cli.list > /dev/null \
    && apt-get update \
    && apt-get install -y gh \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

# Install Go (required for building Caddy with xcaddy)
# Using 1.25.7 to match go.mod requirement of 1.25.5
RUN wget https://go.dev/dl/go1.25.7.linux-amd64.tar.gz \
    && tar -C /usr/local -xzf go1.25.7.linux-amd64.tar.gz \
    && rm go1.25.7.linux-amd64.tar.gz
ENV PATH="/usr/local/go/bin:${PATH}"

# Install Rust and Cargo
RUN curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
ENV PATH="/root/.cargo/bin:${PATH}"

# Install xcaddy (Caddy build tool)
# COMMENTED OUT: Custom Caddy module no longer needed with VK_SHARED_API_BASE support (PR #2769)
# RUN go install github.com/caddyserver/xcaddy/cmd/xcaddy@latest
# ENV PATH="/root/go/bin:${PATH}"

# Copy Caddy module source
# COPY caddy-module /tmp/caddy-module

# Build custom Caddy with vibe-kanban rewrite module
# RUN cd /tmp/caddy-module \
#     && xcaddy build \
#         --with github.com/yourusername/vibe-kanban-plugins=. \
#     && mv caddy /usr/bin/caddy \
#     && chmod +x /usr/bin/caddy \
#     && cd / \
#     && rm -rf /tmp/caddy-module

# Install standard Caddy instead
RUN apt-get update && apt-get install -y debian-keyring debian-archive-keyring apt-transport-https curl \
    && curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg \
    && curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | tee /etc/apt/sources.list.d/caddy-stable.list \
    && apt-get update \
    && apt-get install -y caddy \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

# Install Docker CLI for Docker-in-Docker support (socket mounting)
RUN mkdir -p /etc/apt/keyrings \
    && curl -fsSL https://download.docker.com/linux/debian/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg \
    && chmod a+r /etc/apt/keyrings/docker.gpg \
    && echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/debian bookworm stable" | tee /etc/apt/sources.list.d/docker.list > /dev/null \
    && apt-get update \
    && apt-get install -y docker-ce-cli docker-compose-plugin \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*
    
# Install Tailscale
RUN curl -fsSL https://pkgs.tailscale.com/stable/debian/bookworm.noarmor.gpg | tee /usr/share/keyrings/tailscale-archive-keyring.gpg >/dev/null \
    && curl -fsSL https://pkgs.tailscale.com/stable/debian/bookworm.tailscale-keyring.list | tee /etc/apt/sources.list.d/tailscale.list \
    && apt-get update \
    && apt-get install -y tailscale \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

# Install Google Chrome and dependencies for Chrome DevTools MCP
RUN apt-get update && apt-get install -y \
    fonts-liberation \
    libasound2 \
    libatk-bridge2.0-0 \
    libatk1.0-0 \
    libatspi2.0-0 \
    libcups2 \
    libdbus-1-3 \
    libdrm2 \
    libgbm1 \
    libgtk-3-0 \
    libnspr4 \
    libnss3 \
    libwayland-client0 \
    libxcomposite1 \
    libxdamage1 \
    libxfixes3 \
    libxkbcommon0 \
    libxrandr2 \
    xdg-utils \
    && wget -q -O - https://dl.google.com/linux/linux_signing_key.pub | gpg --dearmor -o /usr/share/keyrings/google-chrome-keyring.gpg \
    && echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/google-chrome-keyring.gpg] http://dl.google.com/linux/chrome/deb/ stable main" | tee /etc/apt/sources.list.d/google-chrome.list \
    && apt-get update \
    && apt-get install -y google-chrome-stable \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

# Install code-server using official install script
RUN curl -fsSL https://code-server.dev/install.sh | sh

# Install Hugo v0.138.0 (extended version for SCSS/SASS support)
RUN ARCH=$(dpkg --print-architecture) && \
    curl -L "https://github.com/gohugoio/hugo/releases/download/v0.138.0/hugo_extended_0.138.0_linux-${ARCH}.deb" -o /tmp/hugo.deb \
    && dpkg -i /tmp/hugo.deb \
    && rm /tmp/hugo.deb

# Create a non-root user for running applications
RUN useradd -m -s /bin/bash vkuser && \
    mkdir -p /home/vkuser/.local/share/vibe-kanban \
             /home/vkuser/.local/share/pnpm \
             /home/vkuser/.local/share/code-server \
             /home/vkuser/.config/code-server \
             /home/vkuser/.config/gh \
             /home/vkuser/.config/git \
             /home/vkuser/.codex \
             /home/vkuser/.npm-global/lib \
             /home/vkuser/.npm \
             /home/vkuser/.cache \
             /home/vkuser/.claude \
             /home/vkuser/.openclaw \
             /home/vkuser/bosun \
             /home/vkuser/repos \
             /var/tmp/vibe-kanban/worktrees \
             /var/run/tailscale \
             /var/lib/tailscale && \
    chown -R vkuser:vkuser /home/vkuser && \
    chown -R vkuser:vkuser /var/tmp/vibe-kanban && \
    chmod 755 /var/run/tailscale /var/lib/tailscale

# Configure npm to use user-local directory for global packages
RUN su - vkuser -c "npm config set prefix '/home/vkuser/.npm-global'"

# Create supervisor and caddy log directories
RUN mkdir -p /var/log/supervisor /var/log/caddy

# Install tools globally as root (will be available system-wide)
RUN npm install -g @anthropic-ai/claude-code pnpm @openai/codex openclaw

# Pre-install vibe-kanban at build time (optional, speeds up first start)
ARG VIBE_KANBAN_VERSION="latest"
RUN npm install -g vibe-kanban@"$VIBE_KANBAN_VERSION"

# Create supervisor config directory
RUN mkdir -p /etc/supervisor/conf.d

# Copy supervisord config
COPY supervisord.conf /etc/supervisor/conf.d/supervisord.conf

# Copy Caddyfile and startup page
COPY Caddyfile /etc/caddy/Caddyfile
COPY startup.html /etc/caddy/startup.html

# Copy database backup script
COPY backup-vibe-kanban-db.sh /usr/local/bin/backup-vibe-kanban-db.sh
RUN chmod +x /usr/local/bin/backup-vibe-kanban-db.sh

# Copy project files to a staging location (will be copied to volume at runtime)
COPY . /opt/vibe-kanban-vscode-web-seed
RUN chown -R vkuser:vkuser /opt/vibe-kanban-vscode-web-seed

# Copy entrypoint script that fixes docker group GID at runtime
COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

# Copy default VS Code settings
RUN mkdir -p /home/vkuser/.local/share/code-server/User
COPY default-settings.json /home/vkuser/.local/share/code-server/User/settings.json
RUN chown -R vkuser:vkuser /home/vkuser/.local/share/code-server

# Install Claude Code extension
RUN su - vkuser -c "mkdir -p /home/vkuser/.local/share/code-server/extensions && code-server --install-extension anthropic.claude-code"

# Configure git to use gh as credential helper (system-level, so users only need `gh auth login`)
RUN git config --system credential.helper '!gh auth git-credential'

RUN chown -R vkuser:vkuser /home/vkuser/.local

EXPOSE 3001
EXPOSE 3007
EXPOSE 3008

# Use entrypoint to fix docker group GID at runtime
ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]

# default supervisord in foreground
CMD ["/usr/bin/supervisord", "-c", "/etc/supervisor/conf.d/supervisord.conf"]
