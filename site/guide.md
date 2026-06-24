---
title: Guide
description: Install Vibe Dashboard and learn the core workflow.
icon: i-heroicons-rocket-launch
---

# Guide

Vibe Dashboard is a local command center for coding-agent work. It brings agent sessions, embedded developer tools, beads tasks, GitHub workflows, and app/plugin views into one dashboard.

## Requirements

You only need Docker installed and running on your machine.

## Start Vibe Dashboard

Run:

```bash
npx vibe-dashboard
```

Then open the local URL printed by the command.

## What you can do

- **Track agent workspaces** — see active and recent coding-agent work, status, changed files, pull request state, and running dev servers.
- **Open work as voyages** — organize work into saved sessions called voyages, with reusable bundles of views called crafts.
- **Use embedded apps** — keep agent UI, code-server, diffs, local app previews, docs, and plugin apps together instead of switching browser windows.
- **Work beads-first** — use beads as the task system behind agent work and workspace context.
- **Connect GitHub** — open GitHub issues, pull requests, branches, files, and CI feedback in the matching workspace when integrations are configured.

## First-run checklist

1. Confirm Docker is running.
2. Start the dashboard with `npx vibe-dashboard`.
3. Open the printed local URL.
4. Connect or authenticate tools as prompted, such as GitHub CLI credentials for repository operations.
5. Create or open a workspace, then start an agent session.

## Core concepts

### Workspace

A workspace is a coding-agent work area tied to a repository, branch, task, and runtime context.

### Voyage

A voyage is a saved browsing/work session. Use voyages to preserve the set of crafts and views you need for a particular stream of work.

### Craft

A craft is a reusable bundle of views. A craft might include an agent session, code-server, a diff view, documentation, or an app preview.

### View

A view is one embedded page or app inside a craft.

### Bead

A bead is the task unit Vibe Dashboard centers work around. Beads help agents and users keep work scoped, coordinated, and reviewable.

## GitHub workflows

Vibe Dashboard is designed for bidirectional GitHub workflows:

- open GitHub issues, pull requests, branches, files, or trees in the relevant workspace;
- map GitHub work back to existing dashboard workspaces;
- send CI failure context to the latest matching agent session;
- keep GitHub review and repair loops close to the code and agent session that can act on them.

Some GitHub behavior depends on configured credentials, webhooks, and repository access.

## Embedded apps and plugins

The dashboard embeds apps through iframe-based views and plugin/runtime integrations. This lets you keep supporting tools next to the agent session instead of managing a separate tab pile.

## Updating these docs locally

If you are contributing to this docs site:

```bash
cd site
pnpm install
pnpm dev
```

Build the static site with:

```bash
pnpm build
```
