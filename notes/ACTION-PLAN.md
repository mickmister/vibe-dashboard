# Action Plan: Self-Hosted VK Cloud + Distributed Local Instances

## Goal

One self-hosted cloud instance (remote server) with multiple vscode-web containers each running local VK, all connected to the shared cloud. Caddy MITM rewrites `VITE_VK_SHARED_API_BASE` in the local frontend JS at runtime so no source build is needed for the local client.

## Architecture

```
┌─────────────────────────────────────────────────────┐
│  Cloud Stack (one instance)                         │
│  ┌────────────┐  ┌───────────┐  ┌───────────────┐  │
│  │ remote-srv │──│ PostgreSQL │──│  ElectricSQL  │  │
│  │   :8081    │  │   :5432   │  │    :3000      │  │
│  └────────────┘  └───────────┘  └───────────────┘  │
│  ┌────────────┐  ┌───────────┐                      │
│  │   Caddy    │  │  Azurite  │                      │
│  │   :443     │  │  :10000   │                      │
│  └────────────┘  └───────────┘                      │
└─────────────────────────────────────────────────────┘
         ▲              ▲              ▲
         │              │              │
  ┌──────┴──┐    ┌──────┴──┐    ┌─────┴───┐
  │ vscode  │    │ vscode  │    │ vscode  │
  │ -web A  │    │ -web B  │    │ -web C  │
  │ local VK│    │ local VK│    │ local VK│
  └─────────┘    └─────────┘    └─────────┘
```

## Implementation Status

- ✅ Caddy module updated to intercept `.js` responses and replace `https://api.vibekanban.com` with custom URL
- ✅ Caddyfile directive `vk_rewrite` registered for easy configuration
- ✅ Dockerfile updated to build custom Caddy binary with `xcaddy`
- ✅ Caddyfile updated to use `vk_rewrite` directive
- ✅ supervisord.conf updated with `VK_SHARED_API_BASE` env var for VK backend
- ✅ docker-compose.yaml updated with `VK_CLOUD_URL` passthrough
- ✅ .env.example updated with cloud connection documentation

**Ready to test**: Build the Docker image and connect to a cloud instance.

## Tasks

### 1. Build & publish the remote server Docker image

Build from `Vktest/crates/remote/Dockerfile` with no `FEATURES` arg (strips billing automatically).

```bash
cd Vktest
docker build -f crates/remote/Dockerfile -t ghcr.io/our-org/vk-remote:latest .
docker push ghcr.io/our-org/vk-remote:latest
```

No Rust toolchain, no private repo access needed at runtime. Image is ~150MB.

### 2. Create cloud stack docker-compose

Separate compose file for the cloud instance. Five services: postgres, azurite, azurite-init, remote-server, electric. Front it with Caddy for TLS.

**Required `.env`:**
```env
POSTGRES_PASSWORD=<strong>
VIBEKANBAN_REMOTE_JWT_SECRET=<openssl rand -base64 48>
ELECTRIC_ROLE_PASSWORD=<strong>
PUBLIC_BASE_URL=https://vk-cloud.example.com
GITHUB_OAUTH_CLIENT_ID=<from github>
GITHUB_OAUTH_CLIENT_SECRET=<from github>
LOOPS_EMAIL_API_KEY=              # empty string = emails disabled but server runs
```

**GitHub OAuth App callback:** `https://vk-cloud.example.com/v1/oauth/github/callback`

### 3. Caddy JS rewrite in vscode-web containers

**Implemented**: Custom Caddy module intercepts JavaScript responses and performs literal string replacement.

**How it works:**
- The vibe-kanban npm package bundles `https://api.vibekanban.com` as a literal string in the JS
- Our `vk_rewrite` Caddy directive intercepts all `.js` responses
- Replaces `https://api.vibekanban.com` with the URL from `VK_CLOUD_URL` env var
- Zero source builds required, works with any npx version

**Implementation:**
```go
// handler.go intercepts JavaScript responses
func (p *PluginInjector) processResponse(headers http.Header, body []byte) []byte {
    // Only process JavaScript files
    if !strings.Contains(strings.ToLower(contentType), "javascript") {
        return body
    }
    // Replace official URL with custom cloud URL
    return bytes.ReplaceAll(body,
        []byte("https://api.vibekanban.com"),
        []byte(p.resolvedCloudURL))
}
```

**Caddyfile usage:**
```caddyfile
handle /* {
    vk_rewrite  # Reads VK_CLOUD_URL env var
    reverse_proxy localhost:3007 {...}
}
```

### 4. Add `VK_SHARED_API_BASE` to local VK environment

In `supervisord.conf`, add the env var to the vibe-kanban program so the Rust backend connects to the cloud:

```ini
environment=HOST="0.0.0.0",PORT="3007",VK_SHARED_API_BASE="%(ENV_VK_CLOUD_URL)s",...
```

In `docker-compose.yaml`, pass it through:
```yaml
environment:
  VK_CLOUD_URL: ${VK_CLOUD_URL:-}
```

This handles the backend half. Combined with step 3, both backend and frontend talk to the cloud.

### 5. Validate the JS rewrite target

Before implementing the Caddy MITM, inspect the actual bundled JS from the npm package to find the exact string pattern to match. Run:

```bash
npx vibe-kanban &
# Find the served JS files and grep for REMOTE_API_URL or VITE_VK_SHARED_API_BASE
```

The Vite build likely tree-shakes `import.meta.env.VITE_VK_SHARED_API_BASE` into a literal empty string `""`. We need to find a unique anchor string near it to do a reliable replacement.

### 6. Summary of changes to vscode-web

| File | Status | Change |
|------|--------|--------|
| `caddy-module/handler.go` | ✅ | Updated to intercept JS, replace API URLs, register Caddyfile directive |
| `docker-compose.yaml` | ✅ | Added `VK_CLOUD_URL` env var passthrough |
| `supervisord.conf` | ✅ | Added `VK_SHARED_API_BASE` to vibe-kanban environment, `VK_CLOUD_URL` to Caddy |
| `Caddyfile` | ✅ | Added `vk_rewrite` directive before reverse_proxy |
| `Dockerfile` | ✅ | Replaced standard Caddy install with xcaddy build of custom module |
| `.env.example` | ✅ | Added VK_CLOUD_URL documentation |

### 7. Order of operations

1. **Set up GitHub OAuth App** - get client ID/secret, set callback URL
2. **Build & push remote server image** - from Vktest repo
3. **Deploy cloud stack** - postgres + electric + azurite + remote-server + caddy
4. **Verify cloud instance** - hit `https://vk-cloud.example.com`, log in via GitHub OAuth
5. **Inspect local VK JS bundle** - find exact rewrite target string
6. **Update vscode-web** - Caddyfile rewrite + supervisord env + compose env
7. **Test end-to-end** - local VK in vscode-web container connects to cloud, org/project/issue sync works

### 8. Fallback: sed instead of Caddy module

If the Caddy `replace-response` module is problematic, a simpler approach:

Add an init script that runs after `npx vibe-kanban` downloads/caches its assets but before serving, and does a `find + sed` on the cached frontend JS files:

```bash
# In supervisord command, before starting VK:
find /home/vkuser/.vibe-kanban -name '*.js' -exec \
  sed -i 's|REMOTE_API_URL=""|REMOTE_API_URL="'"$VK_CLOUD_URL"'"|g' {} +
```

This is simpler but only runs once (on first download or version change). The backup script already runs before VK starts, so this could slot in there.
