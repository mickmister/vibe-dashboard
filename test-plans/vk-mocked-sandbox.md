# VK mocked sandbox

Use this sandbox to run VD against a real local VK backend without spending
model-provider tokens. VK runs with Rust feature `qa-mode`, which routes agent
work through VK's mocked executor.

## Quick start

From the VD repo:

```bash
npm run dev:vk-mocked-sandbox
```

Open the printed VD URL, for example `http://localhost:50005`.

For a fresh run before starting:

```bash
rm -rf .vk-mocked-sandbox/current
rm -rf data
rm -rf ../Vktest/dev_assets
```

Create disposable test repositories under `.vk-mocked-sandbox/repos`.

## What starts

The sandbox starts:

1. VK backend with `cargo run --features qa-mode --bin server`.
2. VD Vite dev server.
3. Caddy as the single browser-facing front door.

Before those services start, the sandbox builds VK `@vibe/local-web` with Vite
base `/vk-static/`. VK frontend iframes and VD therefore share the same Caddy
origin, while VK built assets load from `/vk-static/assets/...`.

There is no separate VK local-web Vite server in the default sandbox.

## Expected browser flow

1. Open the printed VD URL.
2. Name the first voyage.
3. Use the VD sidebar `New Craft` button.
4. Create or select a repository in the VD-hosted VK iframe.
5. Submit a workspace prompt.
6. Use VD `Open Craft` to open the created workspace.
7. Send a follow-up from the VD `Agent` iframe.
8. Capture a screenshot.

The detailed acceptance plan for this branch is:

- [`3237-vd-mocked-model/test-plan-1.md`](./3237-vd-mocked-model/test-plan-1.md)

The reusable tester process is:

- [`3237-vd-mocked-model/sandbox-test-process.md`](./3237-vd-mocked-model/sandbox-test-process.md)

## Development notes

- VD source changes use Vite hot reload.
- VK frontend source changes require rebuilding:

  ```bash
  cd ../Vktest
  NODE_OPTIONS=--max-old-space-size=8192 pnpm --filter @vibe/local-web run build --base /vk-static/
  ```

- VK backend/Rust changes require stopping and restarting
  `npm run dev:vk-mocked-sandbox`.
- The Caddy config comes from the checked-in `Caddyfile`; the sandbox writes a
  prepared copy and an empty `plugins.caddy` stub under
  `.vk-mocked-sandbox/current`.

## Required browser testing workflow

Use Playwright CLI for agent-driven browser testing on this branch. Follow the
snapshot/ref workflow and E2E creation guidance in:

- [`feature-work-process.md`](./feature-work-process.md)
- [`3237-vd-mocked-model/sandbox-test-process.md`](./3237-vd-mocked-model/sandbox-test-process.md)

The VK iframe is same-origin with VD in the mocked sandbox. During exploratory
testing, testers may inspect `iframe.contentDocument` from the VD page if
semantic iframe interaction is not available. The committed E2E test should use
stable Playwright locators and `frameLocator(...)` whenever possible.
