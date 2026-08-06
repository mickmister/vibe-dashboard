# VK mocked-provider sandbox for VD

This is a local, no-Docker development path for exercising VD against VK without
spending model-provider tokens.

## Phase-1 behavior

VK already has a compile-time `qa-mode` feature. When the backend is started
with `cargo run --features qa-mode --bin server`, VK routes coding-agent initial
requests, follow-ups, and session commands through `QaMockExecutor` instead of a
real agent. The current mock:

- emits Claude-compatible JSON logs,
- streams mock log entries with delays,
- performs random local file operations, and
- treats follow-ups as fresh mock runs rather than true model-session
  continuations.

The current mock is **not** a provider-layer mock and it is not configurable
per-turn except for the prompt text appearing in generated mock logs. A richer
provider-layer mock should be designed separately.

## Start the local sandbox

From the VD repo:

```bash
npm run prepare:vk-mocked-sandbox
npm run dev:vk-mocked-sandbox
```

The script allocates dynamic loopback ports, writes a run directory at
`.vk-mocked-sandbox/current`, and starts:

1. VK backend in `qa-mode`,
2. VK local web dev server,
3. VD dev server with `VITE_VK_BASE_ORIGIN` pointing at VK local web, and
4. a local Caddy front door for VD plus `/vk-api/*`.

The printed VD URL is the entry point for browser testing.

`prepare` and `dev` each allocate ports independently. Treat `prepare` as a
diagnostic preview unless you copy its printed `VK_MOCKED_*_PORT` values into
your shell before running `dev`.

## Port overrides

By default, ports are dynamically allocated starting at `50000`. Override the
start or individual ports when needed:

```bash
VK_MOCKED_SANDBOX_PORT_START=52000 npm run dev:vk-mocked-sandbox

VK_MOCKED_BACKEND_PORT=4107 \
VK_MOCKED_FRONTEND_PORT=4100 \
VK_MOCKED_PREVIEW_PROXY_PORT=4106 \
VK_MOCKED_VD_DASHBOARD_PORT=4105 \
VK_MOCKED_VD_SERVER_PORT=4104 \
VK_MOCKED_CADDY_PORT=4101 \
npm run dev:vk-mocked-sandbox
```

## Data isolation

For this phase, VK uses this worktree's `Vktest/dev_assets` data directory. That
keeps the sqlite DB separate from other checkouts/worktrees while avoiding a
broader VK path-resolution change.

If we need multiple concurrent sandboxes from the same VK checkout, add an
explicit VK data-dir env var in VK itself after impact analysis.

## UI flow notes

Use as much real UI as possible:

1. Open the printed VD URL.
2. Name the first voyage if onboarding asks for it.
3. If the voyage-bar "New Craft" path is broken, add a new View from the
   sidebar and set it to the VK local web `/workspaces` URL printed by the
   script. In dev mode, using a same-origin `/workspaces` iframe can collide
   with VD's own Vite `/src`, `/packages`, and `/node_modules` routes.
4. In the VK iframe, create/register a repo and submit a workspace prompt.
5. In VD, use "Open Craft" and search by the workspace name, which is typically
   the first line of the prompt.
6. Open the agent view and send a follow-up message.

## Provider-layer mock research summary

Current candidate approaches:

- **[MockServer LLM response mocking][mockserver-llm]**: provider-neutral
  expectations that encode OpenAI, Anthropic, Gemini, Bedrock, Azure OpenAI,
  Ollama, streaming SSE, tool calls, embeddings, realtime APIs, and provider
  shaped errors. Strong candidate for a standalone scripted mock service.
- **[Mocktopus][mocktopus]**: local deterministic OpenAI-style chat/embeddings
  server backed by YAML scenarios, with streaming, tool calls, embeddings,
  common errors, record/replay modes, and a lightweight Python stub client.
- **[Stacklok MockLLM][mockllm]**: OpenAI/Anthropic-compatible YAML-driven mock
  server for deterministic tests, demos, and development.
- **[LiteLLM `mock_response`][litellm-mock]**: convenient library-level mocking
  for code paths that call LiteLLM directly and supports streaming; less
  suitable for VK if the external agent CLI is the component making provider
  calls.
- **MSW/Playwright request routing**: useful for browser/backend API mocks, but
  it will not intercept network traffic made by spawned agent CLI processes.

For VK, the key architectural question is where provider calls actually happen.
Today the real executors usually spawn external CLIs. A provider-layer mock means
either routing those CLIs to an OpenAI/Anthropic-compatible local server, or
adding a VK-owned executor/provider abstraction that can be scripted directly.

[mockserver-llm]: https://www.mock-server.com/mock_server/llm_response_mocking.html
[mocktopus]: https://github.com/evalops/mocktopus
[mockllm]: https://github.com/StacklokLabs/mockllm
[litellm-mock]: https://docs.litellm.ai/docs/completion/mock_requests
