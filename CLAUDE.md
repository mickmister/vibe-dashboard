# Springboard Development Guide

This application is built with the **Springboard framework**.

## Getting Started

**Before writing any code, run:**

```bash
npx sb docs context
```

This outputs comprehensive framework information including available documentation
sections, key concepts, and workflow guidance.

## Recommended Workflow

1. **Run `sb docs context`** at the start of your session
2. **Write code** using your knowledge + the context from step 1
3. **Fetch specific docs** only when needed: `sb docs get <section>`
4. **View examples** for reference code: `sb docs examples show <name>`

## Other Useful Commands

- `sb docs --help` - See all available commands
- `sb docs types` - Get TypeScript type definitions
- `sb docs examples list` - See available example modules

<!-- gitnexus:start -->
# GitNexus — Code Intelligence

This project is indexed by GitNexus as **vibe-dashboard** (11837 symbols, 27378 relationships, 765 execution flows).

> Index stale? Run `node .gitnexus/run.cjs analyze --index-only` from the project root — it auto-selects an available runner. No `.gitnexus/run.cjs` yet? Bootstrap with `npx`, `bunx`, or `pnpm dlx` — e.g. `bunx gitnexus@latest analyze` (npm 11 npx crash; #1939).

## Always Do

- **MUST run impact before editing.** Use `impact({target: "symbolName", direction: "upstream"})` or `node .gitnexus/run.cjs impact "symbolName" --direction upstream --repo .`; report callers, processes, and risk. Never substitute grep for graph analysis.
- **MUST analyze graph changes before committing.** Use `detect_changes({scope: "all"})` (MCP) or `node .gitnexus/run.cjs detect-changes --scope all --repo .` (CLI fallback). `partial: true` or `truncated: true` is not a clean check — a zero means unseen, not unaffected; re-run it. For regression review: `detect_changes({scope: "compare", base_ref: "main"})` or `node .gitnexus/run.cjs detect-changes --scope compare --base-ref "main" --repo .`.
- MUST warn on HIGH/CRITICAL `risk` pre-edit; never use `riskSharedAxes` to waive a HIGH/CRITICAL `risk` warning. Compare File/symbol: MCP File omits axes; Graph-RAG expands File.
- **MUST treat `risk: UNKNOWN` as unresolved, not as low.** An empty caller set is not evidence the symbol is unused — it can also mean the callers are not resolvable by the index (plain-object property access, dynamic dispatch, cross-language calls). `impact` pairs `UNKNOWN` with a `riskNote` saying so. Confirm with a text search before treating the symbol as safe to change or delete; do not proceed on the strength of a zero.
- **MUST use `query({search_query: "concept"})` for concepts/flows, `context({name: "symbolName"})` for a named symbol, or `impact` for blast radius, on read-only callers, dependencies, imports, or execution flow.** Graph first; text search only for empty/`UNKNOWN`/literals.
- For security review, `explain({target: "fileOrSymbol"})` lists taint findings (source→sink flows; needs `analyze --pdg`).

## Never Do

- NEVER edit a function, class, or method before MCP/CLI impact analysis.
- NEVER ignore HIGH or CRITICAL risk warnings from impact analysis, and never read `UNKNOWN` as an all-clear — it means the walk could not answer, which is the one verdict that requires confirming by other means.
- NEVER rename symbols with find-and-replace — use `rename` which understands the call graph.
- NEVER commit before MCP/CLI graph change analysis.

## Resources

| Resource | Use for |
| --- | --- |
| `gitnexus://repo/vibe-dashboard/context` | Codebase overview, check index freshness |
| `gitnexus://repo/vibe-dashboard/clusters` | All functional areas |
| `gitnexus://repo/vibe-dashboard/processes` | All execution flows |
| `gitnexus://repo/vibe-dashboard/process/{name}` | Step-by-step execution trace |

## CLI

| Task | Read this skill file |
| --- | --- |
| Understand architecture / "How does X work?" | `.claude/skills/gitnexus-exploring/SKILL.md` |
| Blast radius / "What breaks if I change X?" | `.claude/skills/gitnexus-impact-analysis/SKILL.md` |
| Trace bugs / "Why is X failing?" | `.claude/skills/gitnexus-debugging/SKILL.md` |
| Rename / extract / split / refactor | `.claude/skills/gitnexus-refactoring/SKILL.md` |
| Tools, resources, schema reference | `.claude/skills/gitnexus-guide/SKILL.md` |
| Index, status, clean, wiki CLI commands | `.claude/skills/gitnexus-cli/SKILL.md` |

<!-- gitnexus:end -->


<!-- BEGIN BEADS INTEGRATION v:1 profile:minimal hash:ca08a54f -->
## Beads Issue Tracker

This project uses **bd (beads)** for issue tracking. Run `bd prime` to see full workflow context and commands.

### Quick Reference

```bash
bd ready              # Find available work
bd show <id>          # View issue details
bd update <id> --claim  # Claim work
bd close <id>         # Complete work
```

### Rules

- Use `bd` for ALL task tracking — do NOT use TodoWrite, TaskCreate, or markdown TODO lists
- Run `bd prime` for detailed command reference and session close protocol
- Use `bd remember` for persistent knowledge — do NOT use MEMORY.md files

## Session Completion

**When ending a work session**, you MUST complete the local handoff steps below. Pushing to remotes is externally visible and must happen only when the user explicitly requests or authorizes it.

**MANDATORY LOCAL WORKFLOW:**

1. **File issues for remaining work** - Create issues for anything that needs follow-up
2. **Run quality gates** (if code changed) - Tests, linters, builds
3. **Update issue status** - Close finished work, update in-progress items
4. **Commit local changes when requested/appropriate** - Keep the working tree understandable and avoid stranded uncommitted work
5. **Sync/push only with authorization** - If the user explicitly asks you to push, run the appropriate commands, for example:
   ```bash
   git pull --rebase
   bd dolt push
   git push
   git status  # verify remote status after an authorized push
   ```
6. **Clean up** - Clear stashes and temporary files you created
7. **Verify** - Report local `git status --short --branch` and validation results
8. **Hand off** - Provide context for next session

**CRITICAL RULES:**
- Push only when explicitly requested or authorized by the user
- If push is not authorized, do not push; report the local branch status and the exact commands a user can run to push/sync later
- Do not describe local work as remotely available until the authorized push succeeds
- If an authorized push fails, report the failure and the exact next command or fix needed
<!-- END BEADS INTEGRATION -->
