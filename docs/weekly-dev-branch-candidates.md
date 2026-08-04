# Weekly-dev branch candidates

Generated for `vkvw-hzzg — Discuss additional weekly-dev branch candidates` on 2026-07-28.

## Short answer: did we cover all local branches?

No. We covered the high-value/recent branches that came through the forms, but the local repositories still contain **124 VD `vk/*` branches** and **149 VK `vk/*` branches**. Many are stale/no-delta/already-merged, but a meaningful remainder was **not** discussed in the forms and should be triaged before any merge attempt. The appendices below list every local `vk/*` branch observed by `git for-each-ref` and mark whether it was covered.

Current policy decisions from the forms:

- Require fresh current-dev review/spot-check before merge; old approval alone is not enough.
- For paired VK/VD efforts, review and test the pair together when the changes depend on each other.
- Require full impl/review/overseer evidence or reconstruct it from session conversations before final merge.
- Do not kick off a large number of new reviews at once.
- Use plain `https://jamtools.dev/workspaces/:workspace_id` links.

## Immediate review batch

| Repo | Branch | Workspace | Current local delta | Stage | Notes |
|---|---|---|---|---|---|
| VK | `vk/60aa-vk-last-message` | [VK - Last Message](https://jamtools.dev/workspaces/60aa4bba-0ad5-4083-bbd8-aacdf4145ab7) (deleted worktree) | ahead 7, behind 13, 16 files | Immediate fresh review | User definitely wants in; overseer/review2 was kicked off. Require session-conversation approval and aggregate current-dev spot check. |
| VK | `vk/8192-vk-make-urls-cli` | [VK - Make urls clickable](https://jamtools.dev/workspaces/819247a5-56d7-4ef7-b123-f7500b43efb5) (deleted worktree) | ahead 1, behind 13, 4 files | Immediate fresh review | Low-risk candidate, but still needs fresh current-dev approval evidence. |
| VK | `vk/109f-vk-stop-retry-ca` | [VK - Stop/Retry cancels other agent runs](https://jamtools.dev/workspaces/109f9c41-a5ee-448b-b21b-708db6c1d484) | ahead 3, behind 15, 17 files | Immediate fresh review | Workspace link now resolves. Needs current-dev review; prior branch is active and non-trivial. |
| VD | `vk/93a1-vd-most-recently` | [VD - Most recently updated workspaces](https://jamtools.dev/workspaces/93a17bda-935f-4840-b8bb-e1516b94eb65) (deleted worktree) | ahead 1, behind 366, 4 files | Immediate fresh review | Selected low-risk candidate; verify session-conversation approval. |
| VD | `vk/455d-vd-fix-repos-api` | [VD - Fix repos API storm](https://jamtools.dev/workspaces/455d70a5-7d42-4837-8106-96cd723b6f28) (deleted worktree) | ahead 1, behind 372, 4 files | Human testing + paired review | Test together with VK side because user explicitly wants paired effort handled together. |
| VK | `vk/455d-vd-fix-repos-api` | [VD - Fix repos API storm](https://jamtools.dev/workspaces/455d70a5-7d42-4837-8106-96cd723b6f28) (deleted worktree) | ahead 1, behind 15, 5 files | Human testing + paired review | Local VK branch exists; user asked what it is. Treat as pair with VD and do not merge one side blindly. |
| VK | `vk/55fd-vd-themes-and-sk` | [VD - Themes and Skins](https://jamtools.dev/workspaces/55fdc4b2-da37-4f1b-a5cc-78b1d4e51513) (deleted worktree) | ahead 3, behind 29, 17 files | Immediate/thorough review | Selected; likely foundation for corresponding VD theme work. Fresh approval needed. |
| VK | `vk/6722-vd-webhooks-and` | [VD - Webhooks and Mattermost](https://jamtools.dev/workspaces/6722a05f-001f-4dc1-bdbc-474a7a675048) (deleted worktree) | ahead 1, behind 13, 12 files | Immediate + dedicated review | Selected twice; inspect paired VD context before merge if runtime/docs depend on VD side. |

## Dedicated thorough review batch

| Repo | Branch | Workspace | Current local delta | Stage | Notes |
|---|---|---|---|---|---|
| VD | `vk/43fd-vd-vaultwarden-i` | [VD - VaultWarden Integration](https://jamtools.dev/workspaces/43fd5a18-1b44-4bea-974f-747b286de40b) (deleted worktree) | ahead 35, behind 368, 57 files | Dedicated thorough review | Broad/high-value candidate; user said include if ready; dedicated review required. |
| VK | `vk/b8db-vd-make-open-fro` | [VD - Make open from GitHub URL feature](https://jamtools.dev/workspaces/b8db3eed-9a73-4301-9777-42162667ca78) (deleted worktree) | ahead 15, behind 14, 43 files | Dedicated thorough review | Wanted if ready; likely pairs with a VD branch that may conflict. Thorough review required. |
| VD | `vk/5918-vd-subvoyage-tiling` | VD - Subvoyage tiling | ahead 5, behind 368, 16 files | Dedicated thorough review | User requested thorough review; no workspace record found in current VK API list. |
| VK | `vk/2039-vk-postmessage-o` | [VK - postMessage on navigate and message send](https://jamtools.dev/workspaces/20399a03-416a-48bb-9a87-86c6481523bf) (deleted worktree) | ahead 3, behind 16, 5 files | Dedicated thorough review | User remembers many changes; require thorough current-dev review. |
| VK | `vk/dd53-vk-update-codex` | [VK - Update Codex and Claude models](https://jamtools.dev/workspaces/dd53c1c1-a686-4c16-8f3a-7449f67c613f) | ahead 2, behind 13, 8 files | Dedicated thorough review | Selected; needs review because model/tooling changes can age quickly. |
| VK | `vk/b7d4-vk-bubblewrap` | [VK - Bubblewrap](https://jamtools.dev/workspaces/b7d4ffcb-1449-4caf-a45d-4a7bceabfbbb) | ahead 1, behind 13, 6 files | Dedicated thorough review | Selected; user said probably needs implementation, so do not merge without implementation status. |
| VK | `vk/3ad4-vk-add-ability-t` | [VK - Add ability to add a repo to an existing workspace](https://jamtools.dev/workspaces/3ad4c486-9f94-488f-9739-b4152f4f2fae) (deleted worktree) | ahead 0, behind 0, 0 files | Dedicated thorough review | User thinks probably good. Local branch currently equals weekly-dev in VK inventory; verify whether it is already merged/closed before spending review time. |

## Human testing first

| Repo | Branch | Workspace | Current local delta | Stage | Notes |
|---|---|---|---|---|---|
| VD | `vk/3971-vd-new-craft-but` | [VD - New Craft button goes to empty tab](https://jamtools.dev/workspaces/3971f68e-1b18-4e61-aaab-16cde7b4176a) (deleted worktree) | ahead 1, behind 368, 3 files | Human test first | User wants to test first. |
| VD | `vk/455d-vd-fix-repos-api` | [VD - Fix repos API storm](https://jamtools.dev/workspaces/455d70a5-7d42-4837-8106-96cd723b6f28) (deleted worktree) | ahead 1, behind 372, 4 files | Human test first | Selected for human testing and paired VK/VD review. |
| VK | `vk/455d-vd-fix-repos-api` | [VD - Fix repos API storm](https://jamtools.dev/workspaces/455d70a5-7d42-4837-8106-96cd723b6f28) (deleted worktree) | ahead 1, behind 15, 5 files | Human test first | Selected for human testing and paired VK/VD review. |

## Wanted later / verify before review

| Repo | Branch | Workspace | Current local delta | Stage | Notes |
|---|---|---|---|---|---|
| VD | `vk/95a8-vd-mobile-craft` | [VD - Mobile craft tabs](https://jamtools.dev/workspaces/95a8b872-d3d4-4aa4-b51e-472cbaffed0f) (deleted worktree) | ahead 1, behind 368, 3 files | Wanted later / verify | Initially selected, then not selected for immediate testing. Keep as wanted/later. |
| VK | `vk/1b5d-vk-mobile-avoid` | [VK - Mobile avoid keyboard focus](https://jamtools.dev/workspaces/1b5dcf0e-de6d-45bd-8094-49b60aa2d753) (deleted worktree) | ahead 1, behind 13, 3 files | Wanted later / verify | Initially selected low-risk candidate; defer until after active batch. |
| VK | `vk/85c9-vk-remove-left-s` | [VK - Remove left sidebar](https://jamtools.dev/workspaces/85c9faec-9192-4ac5-8f78-f69726177c0a) (deleted worktree) | ahead 2, behind 14, 4 files | Wanted later / verify | Initially selected; needs UI regression review. |
| VK | `vk/8f47-vk-make-chat-def` | [VK - Make Chat default zen view](https://jamtools.dev/workspaces/8f47dc13-041c-4dbd-b701-cdb3097855ea) (deleted worktree) | ahead 2, behind 14, 3 files | Wanted later / verify | User wants triad/approval criteria collected before merge. |
| VK | `vk/75dd-vk-workspace-sor` | [VK - Workspace sort](https://jamtools.dev/workspaces/75ddaea9-6a32-4475-bd01-400a7f6e573c) (deleted worktree) | ahead 1, behind 15, 3 files | Wanted later / verify | Initially selected low-risk candidate; needs current review evidence. |
| VK | `vk/ffe6-vk-add-start-dev` | [VK - Add Start Dev Server button on chat component](https://jamtools.dev/workspaces/ffe66a6f-7dd4-4217-91fa-700e2f570eb7) (deleted worktree) | ahead 1, behind 15, 2 files | Wanted later / verify | User asked what it is; keep as wanted but research before review. |
| VK | `vk/a052-vk-expose-naviga` | [VK - Expose navigate function on window](https://jamtools.dev/workspaces/a0520d71-9f37-46d4-8e93-b2df9964f180) (deleted worktree) | ahead 1, behind 15, 2 files | Wanted later / verify | Initially selected; likely related to postMessage work, review ordering with VK 2039. |
| VK | `vk/9594-vk-make-a-script` | [VK - Make a script to backup/restore user settings](https://jamtools.dev/workspaces/95949b26-0db3-4eb8-8ae5-437e8309d69b) (deleted worktree) | ahead 2, behind 14, 4 files | Wanted later / verify | Initially selected; user asked about migrations. Previous spot-check found no migration files; re-verify before merge. |
| VK | `vk/8299-beads-web-show-m` | [beads-web - Show metadata forms](https://jamtools.dev/workspaces/8299d785-6908-4b32-8dc3-1f0cecc4c2ee) | ahead 2, behind 13, 5 files | Wanted later / verify | Big/high-priority overall, but current weekly dev already contains BeadsForm-related VD commit `6a83c79`; verify remaining VK/VD delta before more work. |

## Done, deferred, or cleanup/discard

| Repo | Branch | Workspace | Current local delta | Stage | Notes |
|---|---|---|---|---|---|
| VK | `vk/371a-vk-performance-p` | [VK - Performance Profiling](https://jamtools.dev/workspaces/371a1d8d-f8c6-4636-b556-85afcbb4aeaa) | ahead 0, behind 0, 0 files | Done / no current delta | Inventory now shows no local diff from weekly dev. Treat as merged/complete unless remote tip changed. |
| VD | `vk/371a-vk-performance-p` | [VK - Performance Profiling VD pass-through](https://jamtools.dev/workspaces/371a1d8d-f8c6-4636-b556-85afcbb4aeaa) | ahead 0, behind 7, 0 files | Done / no current delta | Inventory now shows no local diff from weekly dev. SigNoz docs/config should already be in weekly dev. |
| VK | `vk/038d-vd-use-diffs-com` | [VD - Use diffs.com](https://jamtools.dev/workspaces/038d2fe6-90f4-4dcf-8068-d0df8e0cbb3d) (deleted worktree) | ahead 5, behind 15, 0 files | Delete/discard VK side | User explicitly said VK branch/workspace should be deleted; do not merge VK side. |
| VD | `vk/038d-vd-use-diffs-com` | [VD - Use diffs.com](https://jamtools.dev/workspaces/038d2fe6-90f4-4dcf-8068-d0df8e0cbb3d) (deleted worktree) | ahead 15, behind 372, 23 files | Wanted later | User says VD has code and is wanted. Research as VD branch, likely conflict candidate, not stale. |

## Recommended next steps

1. Wait for or inspect the fresh current-dev review for [VK 60aa — VK - Last Message](https://jamtools.dev/workspaces/60aa4bba-0ad5-4083-bbd8-aacdf4145ab7).
2. Start only one additional no-overseer review at a time after VK 60aa, likely `vk/109f-vk-stop-retry-ca` or `vk/2039-vk-postmessage-o` depending on urgency.
3. Delete/discard the VK-side `vk/038d-vd-use-diffs-com` workspace/branch only after confirming no unpushed local work is needed; keep researching the VD-side branch.
4. Before merging any candidate, re-run the standard preflight: fetch, clean status, exact tip verification, merge-tree, diff summary, review session evidence, and validation plan.

<details>
<summary>VD local branch inventory (124 local vk/* branches)</summary>

| Branch | Date | Tip | Delta vs weekly dev | Covered status |
|---|---:|---|---:|---|
| `vk/80ff-vd-kanban-integr-impl2` | 2026-07-28 | `61ae75e` Harden bulk Jira conversion auth and repo lookups | ahead 38, behind 368, files 57 | not covered in user forms; needs triage before any merge |
| `vk/80ff-vd-kanban-integr` | 2026-07-28 | `420aaee` Merge bulk Jira workspace conversion | ahead 39, behind 368, files 57 | not covered in user forms; needs triage before any merge |
| `vk/6d49-vd-rss-feed-plug` | 2026-07-28 | `336bd0c` chore: clarify RSS feeds are global | ahead 38, behind 366, files 72 | not covered in user forms; needs triage before any merge |
| `vk/05a2-vd-weekly-dev-br` | 2026-07-28 | `6a83c79` Merge BeadsForm branch into weekly dev | ahead 0, behind 0, files 0 | base branch |
| `vk/9926-vd-1` | 2026-07-27 | `034d171` Show running agent sessions in dashboard | ahead 1, behind 366, files 4 | not covered in user forms; needs triage before any merge |
| `vk/843c-vd-avoid-white-s` | 2026-07-27 | `895f147` Broaden iframe visual readiness heuristic | ahead 0, behind 335, files 0 | local no-delta/stale or already merged; not selected |
| `vk/371a-vk-performance-p` | 2026-07-27 | `9b0069b` Merge latest performance profiling VD updates into weekly dev | ahead 0, behind 7, files 0 | covered in candidate discussion |
| `vk/c169-vd-silverbullet` | 2026-07-25 | `f26d204` Merge updated performance profiling branch into weekly dev | ahead 0, behind 29, files 0 | local no-delta/stale or already merged; not selected |
| `vk/8299-beads-web-show-m` | 2026-07-24 | `65e04bc` Stamp BeadsForm attach session metadata | ahead 0, behind 40, files 0 | covered in candidate discussion |
| `vk/b574-vd-migrate-to-sq` | 2026-07-23 | `e99ccd8` Migrate workspace state persistence to SQLite | ahead 1, behind 366, files 12 | not covered in user forms; needs triage before any merge |
| `vk/b02c-vd-onboarding` | 2026-07-23 | `ef0be56` Add first-run onboarding tours | ahead 1, behind 367, files 5 | not covered in user forms; needs triage before any merge |
| `vk/43fd-vd-vaultwarden-i` | 2026-07-22 | `c7fcaac` docs: document vardash settings entry point | ahead 35, behind 368, files 57 | covered in candidate discussion |
| `vk/9f4e-vd-debug-gitnexu` | 2026-07-20 | `78d7e05` Merge main and harden uv toolchain setup | ahead 5, behind 122, files 12 | not covered in user forms; needs triage before any merge |
| `vk/628f-multi-project-up` | 2026-07-20 | `3e139c5` Upgrade TypeScript to 7.0.2 | ahead 1, behind 366, files 4 | not covered in user forms; needs triage before any merge |
| `vk/2759-project-manager` | 2026-07-20 | `15a2b02` Add base repo diff fallback | ahead 5, behind 366, files 8 | not covered in user forms; needs triage before any merge |
| `vk/e099-vd-prepare-commi` | 2026-07-17 | `3fa9aaa` Add agent summaries to commit messages | ahead 1, behind 366, files 7 | not covered in user forms; needs triage before any merge |
| `vk/93a1-vd-most-recently` | 2026-07-14 | `c1bc980` Add recent workspace quick switcher | ahead 1, behind 366, files 4 | covered in candidate discussion |
| `vk/e347-opencode-with-gp` | 2026-07-13 | `7c1d029` Pass SigNoz tracing env vars through compose (#43) | ahead 0, behind 366, files 0 | local no-delta/stale or already merged; not selected |
| `vk/a2d5-vibe-agent-agent` | 2026-07-13 | `62c4609` Make vibe-agent onboarding project agnostic | ahead 2, behind 366, files 3 | not covered in user forms; needs triage before any merge |
| `vk/89e5-vd-custom-chat` | 2026-07-13 | `7c1d029` Pass SigNoz tracing env vars through compose (#43) | ahead 0, behind 366, files 0 | local no-delta/stale or already merged; not selected |
| `vk/84c2-test-message` | 2026-07-13 | `7c1d029` Pass SigNoz tracing env vars through compose (#43) | ahead 0, behind 366, files 0 | local no-delta/stale or already merged; not selected |
| `vk/6d54-hi` | 2026-07-13 | `7c1d029` Pass SigNoz tracing env vars through compose (#43) | ahead 0, behind 366, files 0 | local no-delta/stale or already merged; not selected |
| `vk/6722-vd-webhooks-and` | 2026-07-13 | `5b68969` fix: harden Mattermost webhook handling | ahead 20, behind 374, files 46 | covered in candidate discussion |
| `vk/5f10-vd-support-zen-m` | 2026-07-13 | `7c1d029` Pass SigNoz tracing env vars through compose (#43) | ahead 0, behind 366, files 0 | local no-delta/stale or already merged; not selected |
| `vk/23e8-vibe-agent-allow` | 2026-07-13 | `7c1d029` Pass SigNoz tracing env vars through compose (#43) | ahead 0, behind 366, files 0 | local no-delta/stale or already merged; not selected |
| `vk/0b4c-vd-nudge-and-sen` | 2026-07-13 | `7c1d029` Pass SigNoz tracing env vars through compose (#43) | ahead 0, behind 366, files 0 | local no-delta/stale or already merged; not selected |
| `vk/0717-vd-package-as-ta` | 2026-07-13 | `7c1d029` Pass SigNoz tracing env vars through compose (#43) | ahead 0, behind 366, files 0 | local no-delta/stale or already merged; not selected |
| `vk/053f-vd-migration-too` | 2026-07-13 | `7c1d029` Pass SigNoz tracing env vars through compose (#43) | ahead 0, behind 366, files 0 | local no-delta/stale or already merged; not selected |
| `vk/bfc5-vd-deeper-github` | 2026-07-01 | `c500171` fix: harden GitHub App token brokering | ahead 103, behind 131, files 127 | not covered in user forms; needs triage before any merge |
| `vk/aedb-vd-sysbox-runtim` | 2026-07-01 | `b9bc96b` Harden Sysbox Docker runtime validation | ahead 2, behind 368, files 8 | not covered in user forms; needs triage before any merge |
| `vk/95a8-vd-mobile-craft` | 2026-07-01 | `ba08a9e` Improve mobile craft tab controls | ahead 1, behind 368, files 3 | covered in candidate discussion |
| `vk/5918-vd-subvoyage-tiling` | 2026-07-01 | `9eb4288` Merge origin/main into SubVoyage tiling | ahead 5, behind 368, files 16 | covered in candidate discussion |
| `vk/511c-vd-about-modal` | 2026-07-01 | `37f87c0` Add dashboard About modal version metadata | ahead 1, behind 368, files 10 | not covered in user forms; needs triage before any merge |
| `vk/3971-vd-new-craft-but` | 2026-07-01 | `2db23dc` Fix create workspace craft selection | ahead 1, behind 368, files 3 | covered in candidate discussion |
| `vk/cde9-vd-plugin-iframe` | 2026-06-30 | `db633a8` Soften Beads push guidance | ahead 133, behind 130, files 136 | not covered in user forms; needs triage before any merge |
| `vk/b8db-vd-make-open-fro` | 2026-06-30 | `ad12ace` Respect matched GitHub remotes when opening URLs | ahead 16, behind 370, files 23 | covered in candidate discussion |
| `vk/74ea-vd-server-migrat` | 2026-06-30 | `6f227e6` Update GitNexus agent guidance | ahead 1, behind 369, files 6 | not covered in user forms; needs triage before any merge |
| `vk/6946-vd-chatgpt-and-c` | 2026-06-30 | `ad12ace` Respect matched GitHub remotes when opening URLs | ahead 16, behind 370, files 23 | not covered in user forms; needs triage before any merge |
| `vk/55fd-vd-themes-and-sk` | 2026-06-30 | `30c6b55` Fix Storybook iframe mode fidelity | ahead 7, behind 370, files 18 | covered in candidate discussion |
| `vk/4f3a-vd-openrouter-mo` | 2026-06-30 | `c0a8036` Add OpenRouter model chooser | ahead 1, behind 369, files 10 | not covered in user forms; needs triage before any merge |
| `vk/43ee-vd-tailscale` | 2026-06-30 | `d20a9a8` Add auth-once Tailscale container setup | ahead 1, behind 369, files 9 | not covered in user forms; needs triage before any merge |
| `vk/1cd7-vd-storybook-eve` | 2026-06-30 | `30c6b55` Fix Storybook iframe mode fidelity | ahead 7, behind 370, files 18 | not covered in user forms; needs triage before any merge |
| `vk/954f-vd-more-voyage-f` | 2026-06-29 | `10957c1` Add e2e coverage for opening embarked craft in current voyage | ahead 2, behind 369, files 2 | not covered in user forms; needs triage before any merge |
| `vk/e255-vd-docs-site` | 2026-06-27 | `3c31b70` docs: update site tagline | ahead 16, behind 371, files 35 | not covered in user forms; needs triage before any merge |
| `vk/730b-vd-fork-voyage` | 2026-06-25 | `cc1f26d` docs: add fork voyage product spec | ahead 1, behind 370, files 1 | not covered in user forms; needs triage before any merge |
| `vk/02ec-vd-show-active-a` | 2026-06-24 | `6e88dac` Update VK link in README (#37) | ahead 0, behind 370, files 0 | local no-delta/stale or already merged; not selected |
| `vk/2039-vk-postmessage-o` | 2026-06-23 | `6f67440` Persist voyage flow mode updates | ahead 13, behind 372, files 12 | covered in candidate discussion |
| `vk/f774-vd-voyage-fixes` | 2026-06-22 | `c7a456a` Unify AddTabModal open craft handling | ahead 61, behind 372, files 42 | not covered in user forms; needs triage before any merge |
| `vk/038d-vd-use-diffs-com` | 2026-06-18 | `2b84dac` Remove duplicate expanded diff metadata | ahead 15, behind 372, files 23 | covered in candidate discussion |
| `vk/455d-vd-fix-repos-api` | 2026-06-16 | `bca6082` Use batch workspace repos on SpacesOverview | ahead 1, behind 372, files 4 | covered in candidate discussion |
| `vk/a052-vk-expose-naviga` | 2026-06-11 | `27414bc` Reuse VK workspace iframe navigation | ahead 1, behind 372, files 1 | covered in candidate discussion |
| `vk/745a-vd-install-beads` | 2026-06-11 | `f824b4d` Stamp bead creates with workspace session metadata | ahead 17, behind 373, files 16 | not covered in user forms; needs triage before any merge |
| `vk/42a2-vd-gas-city-plug` | 2026-06-11 | `d0dedbb` Document GC Vibe exec provider MVP | ahead 50, behind 143, files 75 | not covered in user forms; needs triage before any merge |
| `vk/iframe-diff-view-plan` | 2026-06-09 | `66bb61d` Deploy latest VK/VD publishes via Coolify webhook (#30) | ahead 0, behind 372, files 0 | local no-delta/stale or already merged; not selected |
| `vk/ed92-vd-coolify-webho` | 2026-06-09 | `4d2e298` Retry GHCR checks before Coolify deploys | ahead 15, behind 374, files 2 | not covered in user forms; needs triage before any merge |
| `vk/d257-vd-change-page-t` | 2026-06-09 | `ed126fc` Set page title to voyage and craft | ahead 1, behind 372, files 3 | not covered in user forms; needs triage before any merge |
| `vk/c561-vd-plugin-system` | 2026-06-09 | `c1cde17` Update GitNexus agent guidance | ahead 18, behind 137, files 28 | not covered in user forms; needs triage before any merge |
| `vk/4dc2-vd-firecracker-m` | 2026-06-09 | `66bb61d` Deploy latest VK/VD publishes via Coolify webhook (#30) | ahead 0, behind 372, files 0 | local no-delta/stale or already merged; not selected |
| `vk/e560-vd-mobile-app` | 2026-06-08 | `02e40c6` Build all Springboard git-ref installs | ahead 27, behind 148, files 37 | not covered in user forms; needs triage before any merge |
| `vk/d7ca-vd-swap-memory` | 2026-06-07 | `78185a4` Explain Docker memswap limit default | ahead 2, behind 373, files 3 | not covered in user forms; needs triage before any merge |
| `vk/96c5-vd-reload-iframe` | 2026-06-06 | `8128c91` Add voyage craft iframe reload action | ahead 1, behind 373, files 2 | not covered in user forms; needs triage before any merge |
| `vk/f4b6-vd-craft-and-voy` | 2026-06-03 | `9506b47` Tweak voyage switcher actions | ahead 45, behind 374, files 30 | not covered in user forms; needs triage before any merge |
| `vk/44f9-vd-tmux-integrat` | 2026-06-03 | `912f5e6` Add destination-aware Craft and Voyage management (#27) | ahead 0, behind 373, files 0 | local no-delta/stale or already merged; not selected |
| `vk/ee9c-vd-fix-stopped-l` | 2026-06-02 | `6dcbe91` Accept current VK runtime asset manifest mode | ahead 2, behind 375, files 2 | not covered in user forms; needs triage before any merge |
| `vk/3d34-vd-fix-stopped-l` | 2026-05-30 | `abc27e0` Fix recursive app iframe false positives | ahead 1, behind 375, files 1 | not covered in user forms; needs triage before any merge |
| `vk/a17f-vk-vd-fix-mobile` | 2026-05-28 | `671a989` Fix PWA mobile iframe footer inset | ahead 1, behind 375, files 1 | not covered in user forms; needs triage before any merge |
| `vk/5e52-vd-support-deplo` | 2026-05-28 | `6673adf` Fix browser import block issue (#24) | ahead 0, behind 375, files 0 | local no-delta/stale or already merged; not selected |
| `vk/ac47-vd-refresh-tab-b` | 2026-05-27 | `2f7047e` Add iframe refresh controls | ahead 1, behind 380, files 5 | not covered in user forms; needs triage before any merge |
| `vk/a78f-vd-space-icons` | 2026-05-27 | `d2c955e` Add emoji icons for spaces | ahead 1, behind 380, files 5 | not covered in user forms; needs triage before any merge |
| `vk/55d7-vd-sessions` | 2026-05-27 | `a595a3b` Render home overview at root route | ahead 91, behind 137, files 4 | not covered in user forms; needs triage before any merge |
| `vk/515f-vd-ci-run-failur` | 2026-05-25 | `5fe01fe` Skip CI failure prompt if agent is already running | ahead 2, behind 380, files 4 | not covered in user forms; needs triage before any merge |
| `vk/d5f3-vd-publish-to-np` | 2026-05-21 | `d3baa3e` Update GitNexus repo metadata | ahead 1, behind 380, files 2 | not covered in user forms; needs triage before any merge |
| `vk/02a6-vd-add-inactivit` | 2026-05-20 | `d45f8b7` Merge branch 'main' of https://github.com/mickmister/vibe-dashboard into vk/02a6-vd-add-inactivit | ahead 3, behind 136, files 15 | not covered in user forms; needs triage before any merge |
| `vk/f8c9-vd-better-repo-a` | 2026-05-19 | `8dd7835` Make VD ref cleanup non-fatal (#19) | ahead 0, behind 380, files 0 | local no-delta/stale or already merged; not selected |
| `vk/f0cd-vk-new-releases` | 2026-05-19 | `680c187` Polish manual VK VD publish controls | ahead 4, behind 382, files 1 | not covered in user forms; needs triage before any merge |
| `vk/b505-vd-tasks-and-sub` | 2026-05-19 | `8dd7835` Make VD ref cleanup non-fatal (#19) | ahead 0, behind 380, files 0 | local no-delta/stale or already merged; not selected |
| `vk/790a-vd-remove-superf` | 2026-05-19 | `8dd7835` Make VD ref cleanup non-fatal (#19) | ahead 0, behind 380, files 0 | local no-delta/stale or already merged; not selected |
| `vk/8e2a-vd-add-pwa-notif` | 2026-05-16 | `1566788` docs: refresh GitNexus repository metadata | ahead 1, behind 382, files 2 | not covered in user forms; needs triage before any merge |
| `vk/f8c8-ci-pass-notifica` | 2026-05-15 | `809dab8` feat: notify sessions when GitHub CI passes | ahead 42, behind 140, files 41 | not covered in user forms; needs triage before any merge |
| `vk/2823-vd-use-github-we` | 2026-05-15 | `d9ea2ff` fix: remove typecheck failure sentinel | ahead 39, behind 140, files 39 | not covered in user forms; needs triage before any merge |
| `vk/6c2d-vk-wrapper-app` | 2026-05-14 | `4f7e0db` refactor: consume VK release assets in docker build | ahead 7, behind 143, files 13 | not covered in user forms; needs triage before any merge |
| `vk/375b-vd-run-on-runpod` | 2026-05-13 | `978de67` Expose Cloudflare Tunnel env in compose | ahead 19, behind 143, files 11 | not covered in user forms; needs triage before any merge |
| `vk/5df1-vd-e2e-tests` | 2026-05-12 | `a1dbf5b` Add Claude workspace guidance and config | ahead 2, behind 148, files 9 | not covered in user forms; needs triage before any merge |
| `vk/2990-vd-support-an-ex` | 2026-05-12 | `07989a6` docs: add repository workflow instructions for agents | ahead 3, behind 143, files 20 | not covered in user forms; needs triage before any merge |
| `vk/cf30-vd-add-tags-for` | 2026-05-11 | `05f7711` Add tab group tags and ordered saved filters | ahead 2, behind 143, files 12 | not covered in user forms; needs triage before any merge |
| `vk/fb81-vd-individual-sp` | 2026-05-08 | `b3619c8` Add GitNexus workflow guidance and ignore local index | ahead 1, behind 148, files 9 | not covered in user forms; needs triage before any merge |
| `vk/b9f4-vd-youtube-plugi` | 2026-05-08 | `cd641b8` Merge branch 'vk/6c2d-vk-wrapper-app' into vk/c561-vd-plugin-system | ahead 15, behind 148, files 20 | not covered in user forms; needs triage before any merge |
| `vk/252e-vd-support-multi` | 2026-05-08 | `cd641b8` Merge branch 'vk/6c2d-vk-wrapper-app' into vk/c561-vd-plugin-system | ahead 15, behind 148, files 20 | not covered in user forms; needs triage before any merge |
| `vk/827f-vd-gantt-chart-o` | 2026-04-29 | `14af155` Load workspace gantt data directly from VK sqlite | ahead 13, behind 189, files 35 | not covered in user forms; needs triage before any merge |
| `vk/0a61-vd-custom-chat-u` | 2026-04-29 | `518e3dd` docs: move VK chat architecture note into notes | ahead 2, behind 187, files 1 | not covered in user forms; needs triage before any merge |
| `vk/413b-vk-mattermost-in` | 2026-04-27 | `517df92` feat: make Mattermost inbound transport websocket-first | ahead 15, behind 199, files 37 | not covered in user forms; needs triage before any merge |
| `vk/5c77-vd-support-ctrl` | 2026-04-17 | `78b5c34` fix: harden ctrl+tab cycling across iframes and add MRU tests | ahead 2, behind 199, files 4 | not covered in user forms; needs triage before any merge |
| `vk/5918-vd-make-it-so-ta` | 2026-04-17 | `262b16f` Fix tile grid navigation and iframe scoping | ahead 2, behind 211, files 10 | not covered in user forms; needs triage before any merge |
| `vk/c244-vd-configure-bos` | 2026-04-12 | `aa1bd94` Configure Docker image for Bosun with external vibe-kanban | ahead 1, behind 199, files 5 | not covered in user forms; needs triage before any merge |
| `vk/bdf7-vd-deploy-docker` | 2026-04-12 | `128256e` Configure Docker runtime for Fly.io deployment | ahead 1, behind 199, files 7 | not covered in user forms; needs triage before any merge |
| `vk/a28a-vd-add-mempalace` | 2026-04-12 | `1f7a9c0` Install and configure MemPalace for coding agents | ahead 1, behind 199, files 4 | not covered in user forms; needs triage before any merge |
| `vk/6586-vd-silverbullet` | 2026-04-12 | `82cf88e` Implemented the SilverBullet integration end to end. | ahead 1, behind 199, files 10 | not covered in user forms; needs triage before any merge |
| `vk/e80b-vd-add-authentic` | 2026-04-07 | `d29a072` Add Keycloak auth stack for Caddy routes | ahead 1, behind 199, files 5 | not covered in user forms; needs triage before any merge |
| `vk/36e8-vd-review-wip-br` | 2026-04-02 | `48a4aac` Revert "use bullseye again" | ahead 0, behind 199, files 0 | local no-delta/stale or already merged; not selected |
| `vk/a43e-vd-install-agent` | 2026-03-22 | `8cb1ce5` Install agent-browser in Dockerfile | ahead 1, behind 230, files 1 | not covered in user forms; needs triage before any merge |
| `vk/0a3b-put-tab-bar-in-l` | 2026-03-17 | `667c1ee` Move tab and pair navigation/actions into sidebar and keep URL bar only | ahead 0, behind 222, files 0 | local no-delta/stale or already merged; not selected |
| `vk/370d-allow-custom-ico` | 2026-03-10 | `d1f4004` Add per-space custom app icon with runtime favicon/apple-touch updates | ahead 1, behind 249, files 4 | not covered in user forms; needs triage before any merge |
| `vk/64e0-require-authenti` | 2026-03-06 | `a2a4a00` Add Authentik forward-auth overlay for passkey-only single-user access | ahead 1, behind 270, files 6 | not covered in user forms; needs triage before any merge |
| `vk/4751-put-tab-bar-in-l` | 2026-03-06 | `49b5802` Add implementation plan for persistent iframe panels refactor | ahead 0, behind 270, files 0 | local no-delta/stale or already merged; not selected |
| `vk/c0ab-vd-page-developm` | 2026-03-05 | `a0cd90f` Add VD page development implementation plan | ahead 1, behind 275, files 1 | not covered in user forms; needs triage before any merge |
| `vk/4f31-use-custom-caddy` | 2026-03-05 | `6eef933` Add HTML script injection to Caddy module to disable inIframe detection | ahead 1, behind 275, files 4 | not covered in user forms; needs triage before any merge |
| `vk/2b58-fix-docker-build` | 2026-02-27 | `6909f6e` Fix Docker build to support both old and new monorepo structures | ahead 1, behind 387, files 1 | not covered in user forms; needs triage before any merge |
| `vk/b7b0-require-authenti` | 2026-02-26 | `23d9c7c` Add Docker-in-Docker support via socket mounting (Vibe Kanban) (#8) | ahead 0, behind 387, files 0 | local no-delta/stale or already merged; not selected |
| `vk/de89-vk-cloud-host-in` | 2026-02-24 | `e39f7ce` revert 113671bea73dd7436e46f40e0f85a58a1e52b5ed | ahead 46, behind 390, files 22 | not covered in user forms; needs triage before any merge |
| `vk/6b4e-fix-springboard` | 2026-02-23 | `ae3f6e7` Add editable address bar with URL navigation | ahead 0, behind 330, files 0 | local no-delta/stale or already merged; not selected |
| `vk/47a8-clone-and-use-re` | 2026-02-22 | `b15ff6d` Replace TabBar with ChromeTabBar using chrome-tabs component | ahead 0, behind 355, files 0 | local no-delta/stale or already merged; not selected |
| `vk/c6ed-why-might-my-tai` | 2026-02-20 | `a09c5b9` Simplify tailscale-up authkey logic to check state file instead of BackendState | ahead 2, behind 390, files 1 | not covered in user forms; needs triage before any merge |
| `vk/980f-vkvw-persist-cla` | 2026-02-20 | `656743c` Rename [program:entrypoint] to [program:setup] in supervisord.conf | ahead 4, behind 390, files 4 | not covered in user forms; needs triage before any merge |
| `vk/b81f-support-docker-i` | 2026-02-03 | `a7190e1` Fix Docker-in-Docker build and permission issues | ahead 2, behind 394, files 4 | not covered in user forms; needs triage before any merge |
| `vk/2a13-vkvw-add-vnc-and` | 2026-02-03 | `9997109` Add support for Tailscale (#7) | ahead 0, behind 390, files 0 | local no-delta/stale or already merged; not selected |
| `vk/1827-add-dev-manager` | 2026-01-30 | `798a263` Add version control for dev-manager-mcp installation | ahead 2, behind 395, files 2 | not covered in user forms; needs triage before any merge |
| `vk/d14f-make-code-server` | 2026-01-28 | `03885ce` Add idle timeout to code-server and project documentation | ahead 1, behind 396, files 3 | not covered in user forms; needs triage before any merge |
| `vk/8fa9-install-chrome-i` | 2026-01-26 | `ccb796c` Add Chrome runtime dependencies to Dockerfile | ahead 2, behind 396, files 1 | not covered in user forms; needs triage before any merge |
| `vk/f369-analuyze-claude` | 2026-01-25 | `7c2fb0f` merge main | ahead 7, behind 396, files 35 | not covered in user forms; needs triage before any merge |
| `vk/0219-install-chrome-i` | 2026-01-25 | `d71e689` Fix security vulnerability: Use HTTPS for Chrome repository | ahead 2, behind 396, files 1 | not covered in user forms; needs triage before any merge |
| `vk/e610-make-configurabl` | 2026-01-17 | `b070d7b` Implement docker compose generator (vibe-kanban db147d06) | ahead 6, behind 397, files 35 | not covered in user forms; needs triage before any merge |
| `vk/8fb0-review-generate` | 2026-01-17 | `b070d7b` Implement docker compose generator (vibe-kanban db147d06) | ahead 6, behind 397, files 35 | not covered in user forms; needs triage before any merge |
| `vk/0db3-implement-docker` | 2026-01-17 | `c77e513` All required changes are complete. Here's the review response: | ahead 7, behind 397, files 28 | not covered in user forms; needs triage before any merge |
| `vk/5556-add-chrome-devto` | 2026-01-16 | `21263df` Add Docker container setup for Vibe Kanban + VS Code (Vibe Kanban) (#1) | ahead 0, behind 396, files 0 | local no-delta/stale or already merged; not selected |

</details>

<details>
<summary>VK local branch inventory (149 local vk/* branches)</summary>

| Branch | Date | Tip | Delta vs weekly dev | Covered status |
|---|---:|---|---:|---|
| `vk/b9b6-vk-display-time` | 2026-07-28 | `3d7d8e6b1` Refresh GitNexus agent guidance | ahead 2, behind 15, files 14 | not covered in user forms; needs triage before any merge |
| `vk/213f-vk-nested-bullet` | 2026-07-28 | `64630c020` Fix nested list rendering in agent messages | ahead 1, behind 15, files 3 | not covered in user forms; needs triage before any merge |
| `vk/109f-vk-stop-retry-ca` | 2026-07-28 | `cb251b560` Handle scoped stop and reset override safely | ahead 3, behind 15, files 17 | covered in candidate discussion |
| `vk/60aa-vk-last-message` | 2026-07-23 | `eaf458475` Tighten conversation preview cache reset coverage | ahead 7, behind 13, files 16 | covered in candidate discussion |
| `vk/3ad4-vk-add-ability-t` | 2026-07-23 | `36728125d` Fix conversation preview clippy warning | ahead 0, behind 0, files 0 | covered in candidate discussion |
| `vk/371a-vk-performance-p` | 2026-07-23 | `36728125d` Fix conversation preview clippy warning | ahead 0, behind 0, files 0 | covered in candidate discussion |
| `vk/05a2-vd-weekly-dev-br` | 2026-07-23 | `36728125d` Fix conversation preview clippy warning | ahead 0, behind 0, files 0 | base branch |
| `vk/05a2-batch-stage-20260721` | 2026-07-21 | `9c5b4703f` Persist restored queued drafts | ahead 0, behind 8, files 0 | local no-delta/stale or already merged; not selected |
| `vk/9baa-vk-only-latest-m` | 2026-07-20 | `780f70144` Improve latest-message history loading | ahead 0, behind 12, files 0 | local no-delta/stale or already merged; not selected |
| `vk/8192-vk-make-urls-cli` | 2026-07-20 | `74070e2a4` Make plain chat URLs clickable | ahead 1, behind 13, files 4 | covered in candidate discussion |
| `vk/628f-multi-project-up` | 2026-07-20 | `f800fc1ea` Upgrade TypeScript to 7.0.2 | ahead 1, behind 13, files 11 | not covered in user forms; needs triage before any merge |
| `vk/1173-codex-perf-smoke` | 2026-07-15 | `76e02fcc4` Add granular Codex startup tracing | ahead 22, behind 13, files 37 | not covered in user forms; needs triage before any merge |
| `vk/d1c6-vk-drafts-persis` | 2026-07-14 | `2f52c66a4` fix(web): persist restored queued drafts | ahead 6, behind 15, files 5 | not covered in user forms; needs triage before any merge |
| `vk/dd53-vk-update-codex` | 2026-07-13 | `e9b01f682` Address Codex and Claude model update review | ahead 2, behind 13, files 8 | covered in candidate discussion |
| `vk/b7d4-vk-bubblewrap` | 2026-07-13 | `2cbf6a93b` docs: refresh GitNexus guidance | ahead 1, behind 13, files 6 | covered in candidate discussion |
| `vk/6722-vd-webhooks-and` | 2026-07-13 | `1564af543` feat: add webhook notifications on fresh main | ahead 1, behind 13, files 12 | covered in candidate discussion |
| `vk/bfc5-vd-deeper-github` | 2026-07-01 | `f9b8cb07b` fix: avoid GitHub auth refresh for local git commands | ahead 17, behind 31, files 36 | not covered in user forms; needs triage before any merge |
| `vk/1b5d-vk-mobile-avoid` | 2026-07-01 | `38010d4cb` Avoid mobile editor autofocus | ahead 1, behind 13, files 3 | covered in candidate discussion |
| `vk/cd92-vk-import-existi` | 2026-06-30 | `3b03dcbc9` VK - Fix auto-scroll twitching (#21) | ahead 0, behind 13, files 0 | local no-delta/stale or already merged; not selected |
| `vk/b8db-vd-make-open-fro` | 2026-06-30 | `d28dab9d6` Preserve nullable checkout branch types | ahead 15, behind 14, files 43 | covered in candidate discussion |
| `vk/a49a-vk-containerized` | 2026-06-30 | `3b03dcbc9` VK - Fix auto-scroll twitching (#21) | ahead 0, behind 13, files 0 | local no-delta/stale or already merged; not selected |
| `vk/9926-vd-1` | 2026-06-30 | `3b03dcbc9` VK - Fix auto-scroll twitching (#21) | ahead 0, behind 13, files 0 | local no-delta/stale or already merged; not selected |
| `vk/9594-vk-make-a-script` | 2026-06-30 | `b839ecea4` Harden settings backup import handling | ahead 2, behind 14, files 4 | covered in candidate discussion |
| `vk/89e5-vd-custom-chat` | 2026-06-30 | `3b03dcbc9` VK - Fix auto-scroll twitching (#21) | ahead 0, behind 13, files 0 | local no-delta/stale or already merged; not selected |
| `vk/84c2-test-message` | 2026-06-30 | `3b03dcbc9` VK - Fix auto-scroll twitching (#21) | ahead 0, behind 13, files 0 | local no-delta/stale or already merged; not selected |
| `vk/8299-beads-web-show-m` | 2026-06-30 | `c4e313bdb` Merge remote-tracking branch 'origin/main' into vk/8299-beads-web-show-m | ahead 2, behind 13, files 5 | covered in candidate discussion |
| `vk/5f10-vd-support-zen-m` | 2026-06-30 | `3b03dcbc9` VK - Fix auto-scroll twitching (#21) | ahead 0, behind 13, files 0 | local no-delta/stale or already merged; not selected |
| `vk/55fd-vd-themes-and-sk` | 2026-06-30 | `d3c5ee7d3` Fix VK theme appearance config persistence | ahead 3, behind 29, files 17 | covered in candidate discussion |
| `vk/4f3a-vd-openrouter-mo` | 2026-06-30 | `76a2ee526` Add agent settings deep links | ahead 1, behind 14, files 3 | not covered in user forms; needs triage before any merge |
| `vk/4e06-vk-agent-thinkin` | 2026-06-30 | `3b03dcbc9` VK - Fix auto-scroll twitching (#21) | ahead 0, behind 13, files 0 | local no-delta/stale or already merged; not selected |
| `vk/030b-vk-fix-auto-scro` | 2026-06-30 | `ae3f9fe3e` fix(conversation): auto-load history at top | ahead 15, behind 14, files 19 | not covered in user forms; needs triage before any merge |
| `vk/aff2-vk-hermes-agent` | 2026-06-29 | `43ed97f29` Fix Hermes review edge cases | ahead 5, behind 15, files 13 | not covered in user forms; needs triage before any merge |
| `vk/8f47-vk-make-chat-def` | 2026-06-26 | `ca8e959f5` Keep Zen default with key chat header controls | ahead 2, behind 14, files 3 | covered in candidate discussion |
| `vk/85c9-vk-remove-left-s` | 2026-06-26 | `0b1814ae2` Keep workspace selector closed after tab close | ahead 2, behind 14, files 4 | covered in candidate discussion |
| `vk/7466-vk-support-clear` | 2026-06-23 | `24b7d23e9` Fix CI formatting and lockfile | ahead 19, behind 15, files 51 | not covered in user forms; needs triage before any merge |
| `vk/631b-vk-mcp-ui` | 2026-06-23 | `d9621f840` Support scoped clear and compact session commands (#20) | ahead 0, behind 14, files 0 | local no-delta/stale or already merged; not selected |
| `vk/02ec-vd-show-active-a` | 2026-06-23 | `d9621f840` Support scoped clear and compact session commands (#20) | ahead 0, behind 14, files 0 | local no-delta/stale or already merged; not selected |
| `vk/6282-vk-make-pulsing` | 2026-06-20 | `5d6e72e19` Make follow-up pulse configurable | ahead 1, behind 15, files 18 | not covered in user forms; needs triage before any merge |
| `vk/40ee-vk-continue-sess` | 2026-06-17 | `52a1736f4` Update GitNexus agent guidance | ahead 1, behind 15, files 7 | not covered in user forms; needs triage before any merge |
| `vk/7048-vk-support-addin` | 2026-06-16 | `c5aed807c` Guard repo adds during running processes | ahead 11, behind 15, files 34 | not covered in user forms; needs triage before any merge |
| `vk/455d-vd-fix-repos-api` | 2026-06-16 | `a30d75a51` Add batch workspace repos API | ahead 1, behind 15, files 5 | covered in candidate discussion |
| `vk/038d-vd-use-diffs-com` | 2026-06-16 | `9e92fc399` Revert "Sync external scratch draft updates" | ahead 5, behind 15, files 0 | covered in candidate discussion |
| `vk/df47-same-workspace-p` | 2026-06-14 | `441517ed3` Implement same-workspace session forks | ahead 1, behind 15, files 24 | not covered in user forms; needs triage before any merge |
| `vk/75dd-vk-workspace-sor` | 2026-06-14 | `83f31b62a` Fix workspace sidebar updated-at sorting | ahead 1, behind 15, files 3 | covered in candidate discussion |
| `vk/70a0-vk-use-diffs-com` | 2026-06-14 | `1287a469f` Use diffs.com for file change previews | ahead 1, behind 15, files 7 | not covered in user forms; needs triage before any merge |
| `vk/ffe6-vk-add-start-dev` | 2026-06-11 | `46c882493` Add dev server toggle to chat header | ahead 1, behind 15, files 2 | covered in candidate discussion |
| `vk/a052-vk-expose-naviga` | 2026-06-11 | `4ab50e2ee` Expose iframe navigation bridge | ahead 1, behind 15, files 2 | covered in candidate discussion |
| `vk/2039-vk-postmessage-o` | 2026-06-11 | `9ad024664` Open dashboard sidebar from embedded VK mobile switcher | ahead 3, behind 16, files 5 | covered in candidate discussion |
| `vk/7019-allow-the-user-t` | 2026-06-03 | `c9f9ef475` Fix commit diff stream merge blockers | ahead 3, behind 15, files 8 | not covered in user forms; needs triage before any merge |
| `vk/1ed5-vk-implement-sup` | 2026-06-03 | `bfa74d577` docs: add high-level Pi agent support plan | ahead 1, behind 15, files 1 | not covered in user forms; needs triage before any merge |
| `vk/9aff-vk-mobile-comman` | 2026-06-01 | `fad7ff005` Fix mobile command output scrolling | ahead 1, behind 15, files 1 | not covered in user forms; needs triage before any merge |
| `vk/745a-beads-links` | 2026-05-29 | `05e387ea4` Publish macOS ARM runtime release asset (#16) | ahead 0, behind 15, files 0 | local no-delta/stale or already merged; not selected |
| `vk/a918-vk-current-branc` | 2026-05-28 | `34fe9914a` Add per-repo workspace branch creation option | ahead 1, behind 16, files 23 | not covered in user forms; needs triage before any merge |
| `vk/f98c-vk-use-microvms` | 2026-05-27 | `5bfafcc34` Improve mobile composer reachability (#15) | ahead 0, behind 16, files 0 | local no-delta/stale or already merged; not selected |
| `vk/a17f-vk-vd-fix-mobile` | 2026-05-27 | `5bfafcc34` Improve mobile composer reachability (#15) | ahead 0, behind 16, files 0 | local no-delta/stale or already merged; not selected |
| `vk/49fd-vk-mobile-issues` | 2026-05-27 | `324464dcd` Revert "Constrain mobile app shell sizing" | ahead 30, behind 29, files 6 | not covered in user forms; needs triage before any merge |
| `vk/30d4-vk-iframe-keyboa` | 2026-05-27 | `74d8eed23` Merge main preserving always-on iframe shortcuts | ahead 9, behind 20, files 1 | not covered in user forms; needs triage before any merge |
| `vk/1cbe-reply-smoke-live` | 2026-05-27 | `7d3affdc8` Use sqlx-cli version syntax for CI cache | ahead 4, behind 384, files 18 | not covered in user forms; needs triage before any merge |
| `vk/65c4-vk-publish-macos` | 2026-05-26 | `dc6c9aea4` ci: use standard macos arm runner | ahead 2, behind 20, files 1 | not covered in user forms; needs triage before any merge |
| `vk/b2ef-vk-fix-missing-i` | 2026-05-24 | `10f045cc6` fix: add missing workspaces.chatViewMode i18n keys | ahead 1, behind 21, files 7 | not covered in user forms; needs triage before any merge |
| `vk/a30d-vk-session-ids-i` | 2026-05-23 | `196fcfea0` Committed ✅ | ahead 2, behind 21, files 2 | not covered in user forms; needs triage before any merge |
| `vk/6866-cache-visited-co` | 2026-05-23 | `642baec0c` Cache visited conversation sessions | ahead 1, behind 21, files 4 | not covered in user forms; needs triage before any merge |
| `vk/5a03-vk-quote-agent-t` | 2026-05-22 | `e84a88d45` Add quote-line affordance to agent markdown responses | ahead 1, behind 21, files 3 | not covered in user forms; needs triage before any merge |
| `vk/2fc5-bw-add-support-f` | 2026-05-21 | `a62256807` Bridge iframe session navigation shortcuts (#13) | ahead 0, behind 21, files 0 | local no-delta/stale or already merged; not selected |
| `vk/d40c-vk-support-disab` | 2026-05-20 | `5d3697c2e` Preserve automation settings across drafts and retries | ahead 2, behind 23, files 43 | not covered in user forms; needs triage before any merge |
| `vk/b408-dev-server-origi` | 2026-05-20 | `00874c902` Harden dev server preview origin detection | ahead 3, behind 22, files 12 | not covered in user forms; needs triage before any merge |
| `vk/f0cd-vk-new-releases` | 2026-05-19 | `5f79adfd3` Include VK source ref in VD dispatch | ahead 2, behind 24, files 1 | not covered in user forms; needs triage before any merge |
| `vk/d925-vk-inline-comman` | 2026-05-19 | `602a20de5` Show command output inline in chat | ahead 1, behind 23, files 1 | not covered in user forms; needs triage before any merge |
| `vk/b4b7-vk-allow-shortha` | 2026-05-19 | `2acfa1cf0` Add configurable quick response tags | ahead 1, behind 23, files 10 | not covered in user forms; needs triage before any merge |
| `vk/1ced-vk-bring-local-p` | 2026-05-19 | `b66652f1c` refactor: make workspace issue linking source-aware | ahead 6, behind 45, files 52 | not covered in user forms; needs triage before any merge |
| `vk/1984-vk-dev-server-en` | 2026-05-19 | `c67da97c8` Add repo dev server script model and workspace selection plumbing | ahead 1, behind 29, files 10 | not covered in user forms; needs triage before any merge |
| `vk/2c4b-restore-vk-sessi` | 2026-05-18 | `441e03ada` Restore VK session env injection | ahead 1, behind 24, files 1 | not covered in user forms; needs triage before any merge |
| `vk/28b2-vk-custom-themes` | 2026-05-17 | `6c93bdbe3` Use localStorage for temporary theme customization testing | ahead 2, behind 29, files 14 | not covered in user forms; needs triage before any merge |
| `vk/d711-fix-tanstack-log` | 2026-05-15 | `4afc4fbd0` Fix virtual log viewer bottom tracking | ahead 1, behind 25, files 3 | not covered in user forms; needs triage before any merge |
| `vk/fe2b-vk-gh-actions-wo` | 2026-05-14 | `3f8382080` Make release assets SHA-addressed for Linux runtime | ahead 4, behind 44, files 9 | not covered in user forms; needs triage before any merge |
| `vk/8e2a-vd-add-pwa-notif` | 2026-05-14 | `80ff74c9d` Replace Virtuoso message list with TanStack logs (#8) | ahead 0, behind 25, files 0 | local no-delta/stale or already merged; not selected |
| `vk/6cc9-vk-make-vk-allow` | 2026-05-14 | `acbab808a` chore: add local web dev script | ahead 13, behind 29, files 12 | not covered in user forms; needs triage before any merge |
| `vk/252e-vd-support-multi` | 2026-05-12 | `f8cd3df8c` Support wildcard patterns in VK_ALLOWED_ORIGINS (#7) | ahead 0, behind 28, files 0 | local no-delta/stale or already merged; not selected |
| `vk/12fc-vk-review-fork` | 2026-05-12 | `f8cd3df8c` Support wildcard patterns in VK_ALLOWED_ORIGINS (#7) | ahead 0, behind 28, files 0 | local no-delta/stale or already merged; not selected |
| `vk/1100-vk-remove-virtuo` | 2026-05-11 | `6258e090c` Fix react-virtuoso ordering and lockfile diff | ahead 3, behind 29, files 9 | not covered in user forms; needs triage before any merge |
| `vk/e27a-vk-queue-fix` | 2026-05-09 | `5d73041d0` fix: consume queued follow-up when agent completes with no changes | ahead 1, behind 29, files 1 | not covered in user forms; needs triage before any merge |
| `vk/a914-vk-fix-mobile-se` | 2026-05-07 | `6e14c3fda` Fix websocket reconnect issues (#2) | ahead 0, behind 29, files 0 | local no-delta/stale or already merged; not selected |
| `vk/94cf-vk-zen-mode` | 2026-05-07 | `d9db8d969` Remove Vibe Kanban branding from PR auto descriptions | ahead 3, behind 45, files 11 | not covered in user forms; needs triage before any merge |
| `vk/6b87-vk-fix-websocket` | 2026-05-07 | `84a6051a0` Merge branch 'vk/6b87-vk-fix-websocket' of https://github.com/mickmister/vibe-kanban into vk/6b87-vk-fix-websocket | ahead 10, behind 31, files 22 | not covered in user forms; needs triage before any merge |
| `vk/02a6-vd-add-inactivit` | 2026-05-07 | `6e14c3fda` Fix websocket reconnect issues (#2) | ahead 0, behind 29, files 0 | local no-delta/stale or already merged; not selected |
| `vk/827f-vd-gantt-chart-o` | 2026-04-29 | `8a319875d` Revert "Add workspace execution timeline API for dashboard gantt view" | ahead 2, behind 44, files 0 | local no-delta/stale or already merged; not selected |
| `vk/49c8-vk-support-clear` | 2026-04-27 | `7886e805a` Harden llm proxy request handling | ahead 2, behind 44, files 4 | not covered in user forms; needs triage before any merge |
| `vk/40ec-smoke-test-from` | 2026-04-26 | `f6be5eef6` feat(server): add HTTP MCP endpoint for Mattermost smoke tests | ahead 1, behind 384, files 7 | not covered in user forms; needs triage before any merge |
| `vk/1e4a-vk-support-gitea` | 2026-04-26 | `bcf3fda68` Add Gitea pull request provider support | ahead 1, behind 44, files 10 | not covered in user forms; needs triage before any merge |
| `vk/03fa-vk-make-open-fro` | 2026-04-15 | `daf2ba027` Add open-from-GitHub URL workspace flow | ahead 1, behind 44, files 8 | not covered in user forms; needs triage before any merge |
| `vk/a4a4-vk-notes-get-whi` | 2026-04-14 | `d9ab5f399` Preserve whitespace in workspace notes | ahead 1, behind 44, files 1 | not covered in user forms; needs triage before any merge |
| `vk/bf9d-vk-deploy-to-fly` | 2026-04-13 | `b83a342f2` ci: replace Blacksmith runners with GitHub runners (#3336) | ahead 0, behind 44, files 0 | local no-delta/stale or already merged; not selected |
| `vk/a8cc-vk-github-issues` | 2026-04-13 | `e3d0f5632` Add GitHub issue sync for remote projects | ahead 1, behind 45, files 20 | not covered in user forms; needs triage before any merge |
| `vk/9ccf-vk-how-is-previe` | 2026-04-13 | `b83a342f2` ci: replace Blacksmith runners with GitHub runners (#3336) | ahead 0, behind 44, files 0 | local no-delta/stale or already merged; not selected |
| `vk/906b-bosun-use-vibe-k` | 2026-04-13 | `b83a342f2` ci: replace Blacksmith runners with GitHub runners (#3336) | ahead 0, behind 44, files 0 | local no-delta/stale or already merged; not selected |
| `vk/42a2-vd-gas-city-plug` | 2026-04-13 | `b83a342f2` ci: replace Blacksmith runners with GitHub runners (#3336) | ahead 0, behind 44, files 0 | local no-delta/stale or already merged; not selected |
| `vk/3ec3-gt-use-vibe-kanb` | 2026-04-13 | `b83a342f2` ci: replace Blacksmith runners with GitHub runners (#3336) | ahead 0, behind 44, files 0 | local no-delta/stale or already merged; not selected |
| `vk/3047-gas-city-use-vib` | 2026-04-13 | `b83a342f2` ci: replace Blacksmith runners with GitHub runners (#3336) | ahead 0, behind 44, files 0 | local no-delta/stale or already merged; not selected |
| `vk/0a61-vd-custom-chat-u` | 2026-04-13 | `b83a342f2` ci: replace Blacksmith runners with GitHub runners (#3336) | ahead 0, behind 44, files 0 | local no-delta/stale or already merged; not selected |
| `vk/a3da-vk-what-does-cha` | 2026-03-28 | `abe62af2b` fix: load non-localhost URLs directly in preview iframe (#3202) | ahead 0, behind 63, files 0 | local no-delta/stale or already merged; not selected |
| `vk/413b-vk-mattermost-in` | 2026-03-25 | `76c818f7a` feat: add markdown preview toggle in diff view for .md files (#3125) | ahead 0, behind 77, files 0 | local no-delta/stale or already merged; not selected |
| `vk/c2c5-vk-cmd-x-not-wor` | 2026-03-23 | `83192b34d` fix(auth): Add refresh token refresh grace window and degraded auth UI (#3138) | ahead 0, behind 84, files 0 | local no-delta/stale or already merged; not selected |
| `vk/6c2d-vk-wrapper-app` | 2026-03-16 | `fc32c88e4` Remove all #[ts(export)] attributes — they are no-ops (#3167) | ahead 0, behind 131, files 0 | local no-delta/stale or already merged; not selected |
| `vk/a91e-make-review-moda` | 2026-03-10 | `95d8933ec` feat(review-modal): replace Textarea with WYSIWYGEditor to support @tag typeahead | ahead 1, behind 154, files 1 | not covered in user forms; needs triage before any merge |
| `vk/4f31-use-custom-caddy` | 2026-03-05 | `113e956a5` feat: persist last selected org and project in scratch store (#2921) | ahead 0, behind 193, files 0 | local no-delta/stale or already merged; not selected |
| `vk/c920-does-the-app-onl` | 2026-03-04 | `e59b6c027` fix: restore actionsMenu i18n keys for StartReviewDialog button (Vibe Kanban) (#3019) | ahead 2, behind 202, files 27 | not covered in user forms; needs triage before any merge |
| `vk/fa33-when-there-is-a` | 2026-02-26 | `6452639f8` feat: disable VS Code iframe behaviours when embedded via ?embed=true | ahead 1, behind 268, files 3 | not covered in user forms; needs triage before any merge |
| `vk/e28f-make-a-script-to` | 2026-02-25 | `5bdf90459` replace newlines with spaces in CSV output | ahead 6, behind 282, files 2 | not covered in user forms; needs triage before any merge |
| `vk/033c-why-does-spinnin` | 2026-02-25 | `164898207` fix(remote-web): wire app bar create-project button to dialog (#2928) | ahead 0, behind 270, files 0 | local no-delta/stale or already merged; not selected |
| `vk/6e08-investigate-when` | 2026-02-22 | `057936d53` docs: update getting started next steps and home tagline (#2859) | ahead 0, behind 286, files 0 | local no-delta/stale or already merged; not selected |
| `vk/5317-make-it-so-filte` | 2026-02-20 | `e8b32ff54` feat: sync kanban board filters to URL query params | ahead 1, behind 316, files 2 | not covered in user forms; needs triage before any merge |
| `vk/53da-add-support-for` | 2026-02-14 | `a21265da4` feat: add Go injector function for Caddy plugin integration | ahead 8, behind 384, files 6 | not covered in user forms; needs triage before any merge |
| `vk/de89-vk-cloud-host-in` | 2026-02-13 | `61c39de52` chore: bump version to 0.1.13 | ahead 0, behind 384, files 0 | local no-delta/stale or already merged; not selected |
| `vk/77be-mm-smoke-test` | 2026-02-13 | `61c39de52` chore: bump version to 0.1.13 | ahead 0, behind 384, files 0 | local no-delta/stale or already merged; not selected |
| `vk/3b52-vk-testing-front` | 2026-02-13 | `61c39de52` chore: bump version to 0.1.13 | ahead 0, behind 384, files 0 | local no-delta/stale or already merged; not selected |
| `vk/1f5d-how-does-append` | 2026-02-12 | `7765955ad` fix(db): Don't spam SQLite with workspace timestamp updates (#2716) | ahead 0, behind 403, files 0 | local no-delta/stale or already merged; not selected |
| `vk/1651-how-does-self-ho` | 2026-02-06 | `a5567b44d` docs: add comprehensive environment variables reference | ahead 1, behind 587, files 1 | not covered in user forms; needs triage before any merge |
| `vk/b491-add-vk-session-i` | 2026-01-28 | `cf145d13a` add VK_SESSION_ID to agent session env vars | ahead 1, behind 588, files 1 | not covered in user forms; needs triage before any merge |
| `vk/5fe0-add-session-id-e` | 2026-01-28 | `1b9006441` add VK_SESSION_ID to agent session env vars | ahead 1, behind 622, files 1 | not covered in user forms; needs triage before any merge |
| `vk/2b58-fix-docker-build` | 2026-01-28 | `e442281f4` feat: use --resume-session-at for Claude reset operations (Vibe Kanban) (#2329) | ahead 0, behind 588, files 0 | local no-delta/stale or already merged; not selected |
| `vk/5556-add-chrome-devto` | 2026-01-25 | `e72f4541e` feat: add Chrome browser support in Docker images for DevTools testing | ahead 1, behind 674, files 4 | not covered in user forms; needs triage before any merge |
| `vk/e892-how-is-claude-va` | 2026-01-24 | `f1899638e` Revert "feat: set Sonnet as default model for Claude Code" | ahead 2, behind 692, files 0 | local no-delta/stale or already merged; not selected |
| `vk/e242-implement-npm-pu` | 2026-01-24 | `ebb102b34` refactor: rename CopyPath to CopyWorkspacePath and consolidate git/repo pages (#2296) | ahead 0, behind 622, files 0 | local no-delta/stale or already merged; not selected |
| `vk/d14f-make-code-server` | 2026-01-24 | `ebb102b34` refactor: rename CopyPath to CopyWorkspacePath and consolidate git/repo pages (#2296) | ahead 0, behind 622, files 0 | local no-delta/stale or already merged; not selected |
| `vk/bf61-compile-as-tauri` | 2026-01-24 | `ebb102b34` refactor: rename CopyPath to CopyWorkspacePath and consolidate git/repo pages (#2296) | ahead 0, behind 622, files 0 | local no-delta/stale or already merged; not selected |
| `vk/b81f-support-docker-i` | 2026-01-24 | `ebb102b34` refactor: rename CopyPath to CopyWorkspacePath and consolidate git/repo pages (#2296) | ahead 0, behind 622, files 0 | local no-delta/stale or already merged; not selected |
| `vk/1b55-does-cleanup-scr` | 2026-01-24 | `ebb102b34` refactor: rename CopyPath to CopyWorkspacePath and consolidate git/repo pages (#2296) | ahead 0, behind 622, files 0 | local no-delta/stale or already merged; not selected |
| `vk/8fa9-install-chrome-i` | 2026-01-21 | `08cf7fdde` terminal: allow shell init scripts to run (#2182) | ahead 0, behind 674, files 0 | local no-delta/stale or already merged; not selected |
| `vk/1827-add-dev-manager` | 2026-01-21 | `08cf7fdde` terminal: allow shell init scripts to run (#2182) | ahead 0, behind 674, files 0 | local no-delta/stale or already merged; not selected |
| `vk/f369-analuyze-claude` | 2026-01-17 | `226bd320e` I've created a comprehensive architecture plan for the SuperVibeCode (`svc.yaml`) configurable Docker Compose system at `Vktest/docs/svc-architecture-plan.md`. | ahead 1, behind 715, files 1 | not covered in user forms; needs triage before any merge |
| `vk/e610-make-configurabl` | 2026-01-17 | `226bd320e` I've created a comprehensive architecture plan for the SuperVibeCode (`svc.yaml`) configurable Docker Compose system at `Vktest/docs/svc-architecture-plan.md`. | ahead 1, behind 715, files 1 | not covered in user forms; needs triage before any merge |
| `vk/8fb0-review-generate` | 2026-01-17 | `226bd320e` I've created a comprehensive architecture plan for the SuperVibeCode (`svc.yaml`) configurable Docker Compose system at `Vktest/docs/svc-architecture-plan.md`. | ahead 1, behind 715, files 1 | not covered in user forms; needs triage before any merge |
| `vk/0db3-implement-docker` | 2026-01-17 | `226bd320e` I've created a comprehensive architecture plan for the SuperVibeCode (`svc.yaml`) configurable Docker Compose system at `Vktest/docs/svc-architecture-plan.md`. | ahead 1, behind 715, files 1 | not covered in user forms; needs triage before any merge |
| `vk/f5ca-how-to-undo-work` | 2026-01-16 | `4ffd7c92b` chore: bump version to 0.0.154 | ahead 0, behind 715, files 0 | local no-delta/stale or already merged; not selected |
| `vk/059c-make-a-swagger-y` | 2026-01-16 | `b83365266` I've created both the OpenAPI specification and the autogeneration script. Here's a summary: | ahead 1, behind 715, files 3 | not covered in user forms; needs triage before any merge |
| `vk/b5ff-make-qa-testing` | 2026-01-14 | `ea5954c8f` Refactor WorkspacesLayout (#2052) | ahead 0, behind 738, files 0 | local no-delta/stale or already merged; not selected |
| `vk/94e1-review-project-p` | 2026-01-14 | `ea5954c8f` Refactor WorkspacesLayout (#2052) | ahead 0, behind 738, files 0 | local no-delta/stale or already merged; not selected |
| `vk/8b29-review-mattermos` | 2026-01-14 | `ea5954c8f` Refactor WorkspacesLayout (#2052) | ahead 0, behind 738, files 0 | local no-delta/stale or already merged; not selected |
| `vk/6931-oversee-i-m-bloc` | 2026-01-14 | `ea5954c8f` Refactor WorkspacesLayout (#2052) | ahead 0, behind 738, files 0 | local no-delta/stale or already merged; not selected |
| `vk/64fa-design-mattermos` | 2026-01-14 | `ea5954c8f` Refactor WorkspacesLayout (#2052) | ahead 0, behind 738, files 0 | local no-delta/stale or already merged; not selected |
| `vk/50bc-implement-im-blo` | 2026-01-14 | `ea5954c8f` Refactor WorkspacesLayout (#2052) | ahead 0, behind 738, files 0 | local no-delta/stale or already merged; not selected |
| `vk/c9e0-make-wrapper-mcp` | 2026-01-13 | `d17c41a73` chore: bump version to 0.0.151 | ahead 0, behind 755, files 0 | local no-delta/stale or already merged; not selected |
| `vk/5417-review-websocket` | 2026-01-13 | `c412dcac5` I've made the following changes to improve the WebSocket disconnection handling: | ahead 1, behind 801, files 4 | not covered in user forms; needs triage before any merge |
| `vk/2c18-websocket-discon` | 2026-01-13 | `c412dcac5` I've made the following changes to improve the WebSocket disconnection handling: | ahead 1, behind 801, files 4 | not covered in user forms; needs triage before any merge |
| `vk/e7f5-test` | 2026-01-11 | `7de87e9b3` Add QA mode for automated testing with mock executor and hardcoded repos (Vibe Kanban) (#1940) | ahead 0, behind 801, files 0 | local no-delta/stale or already merged; not selected |
| `vk/c6ae-manage-open-task` | 2026-01-11 | `7de87e9b3` Add QA mode for automated testing with mock executor and hardcoded repos (Vibe Kanban) (#1940) | ahead 0, behind 801, files 0 | local no-delta/stale or already merged; not selected |
| `vk/ad9a-what-happens-whe` | 2026-01-11 | `7de87e9b3` Add QA mode for automated testing with mock executor and hardcoded repos (Vibe Kanban) (#1940) | ahead 0, behind 801, files 0 | local no-delta/stale or already merged; not selected |
| `vk/8c93-remote-and-local` | 2026-01-11 | `7de87e9b3` Add QA mode for automated testing with mock executor and hardcoded repos (Vibe Kanban) (#1940) | ahead 0, behind 801, files 0 | local no-delta/stale or already merged; not selected |
| `vk/f78b-what-happens-whe` | 2026-01-10 | `54d414793` Based on my investigation, here's the answer: | ahead 3, behind 2101, files None | not covered in user forms; needs triage before any merge |

</details>
