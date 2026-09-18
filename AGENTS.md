If you are working in a multi-repo workspace, use this repo as the directory in which you use the `bd` cli.

Keep the following info in mind *when working in the ./src directory only*

After making any changes, run `npm run check-types` to ensure types pass.

This application is built with the **Springboard framework**. All code is assumed to be isomorphic by default. Optionally run `npx sb docs context` for more info.

Example module:

```tsx
import springboard from 'springboard';

type ExampleSharedState = {
  version: 1;
  items: [] as Array<{id: string; name: string}>;
}

springboard.registerModule('ModuleName', {}, async (moduleAPI) => {
  const sharedState = await moduleAPI.createStates({
    
    exampleSharedState: {
        version: 1; // Later we can do `version: 1 | 2` and perform data migrations as needed
        items: [],
    } as ExampleSharedState,
  });

  const myClientState = await moduleAPI.createUserAgentState('mySettings', {theme: null} as {theme: string | null});

  const myServerActions = moduleAPI.createActions({
    addItem: (args: {name: string}) => {
      const newItem = {id: generateid(), name: args.name};

      sharedState.exampleSharedState.setStateImmer(state => {
          state.push(newItem);
      });

      // or
      sharedState.exampleSharedState.setState(state => {
          return [...state, newItem];
      });

      const someOtherModule = moduleAPI.getModule('SomeOptionalModule');
      someOtherModule?.actions.doSomething(); // Optional chaining, since module was registered as optional in its own type declaration. Good for modules that only exist on certain platform builds.

      return {data: newItem};
    },
  })

  // Register UI routes
  moduleAPI.registerRoute('/', {}, (navigate) => {
    const liveState = sharedState.useState();

    return (
      <div>
        <button onClick={() => {
          myServerActions.addItem({name: 'me'});
        }}>
          Submit
        </button>
      </div>
    );
  });

  // Return public API
  return { sharedState, actions };
});

// Declare module return value for other files
declare module 'springboard/module_registry/module_registry' {
  interface AllModules {
    ModuleName: {
      sharedState: {
        exampleSharedState: StateSupervisor<ExampleSharedState>;
      };
      actions: {
         addItem: (args: {name: string}) => Promise<void>;
      };
    };
  }
}
```

To access these values in another file

```tsx
import {useModule} from '../hooks/useModule';

const MyComponent = () => {
  const myModule = useModule('ModuleName');
  const liveState = myModule.sharedState.exampleSharedState.useState();

  const doThing = async () => {
    await myModule.actions.addItem({name: 'example'});
  };
};
```

If importing a node module in an action, you'll need to use conditional compilation. Springboard is written in a way so that actions *can* run on the client, but our application here is only deployed as a server-driven SPA, so all actions will run on the server in this app.

```tsx
const myActions = moduleAPI.createActions({
  myAction: async () => {
    // @platform "node"
    const fs = await import ('fs');
    // ...
    // @platform end
  },
});

// Or import a server only module

// @platform "node"
import './modules/MyServerOnlyModule';
// @platform end

// More rarely, you may want to remove code from the server build that only runs on the frontend. It's necessary sometimes.

// @platform "browser"
window.addEventListener('load', () => {

});
// @platform end
```

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
