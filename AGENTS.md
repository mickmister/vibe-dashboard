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

This project is indexed by GitNexus as **vibe-dashboard** (1280 symbols, 2895 relationships, 106 execution flows). Use the GitNexus MCP tools to understand code, assess impact, and navigate safely.

> Index stale? Run `node .gitnexus/run.cjs analyze` from the project root — it auto-selects an available runner. No `.gitnexus/run.cjs` yet? `npx gitnexus analyze` (npm 11 crash → `npm i -g gitnexus`; #1939).

## Always Do

- **MUST run impact analysis before editing any symbol.** Before modifying a function, class, or method, run `impact({target: "symbolName", direction: "upstream"})` and report the blast radius (direct callers, affected processes, risk level) to the user.
- **MUST run `detect_changes()` before committing** to verify your changes only affect expected symbols and execution flows. For regression review, compare against the default branch: `detect_changes({scope: "compare", base_ref: "main"})`.
- **MUST warn the user** if impact analysis returns HIGH or CRITICAL risk before proceeding with edits.
- When exploring unfamiliar code, use `query({query: "concept"})` to find execution flows instead of grepping. It returns process-grouped results ranked by relevance.
- When you need full context on a specific symbol — callers, callees, which execution flows it participates in — use `context({name: "symbolName"})`.

## Never Do

- NEVER edit a function, class, or method without first running `impact` on it.
- NEVER ignore HIGH or CRITICAL risk warnings from impact analysis.
- NEVER rename symbols with find-and-replace — use `rename` which understands the call graph.
- NEVER commit changes without running `detect_changes()` to check affected scope.

## Resources

| Resource | Use for |
|----------|---------|
| `gitnexus://repo/vibe-dashboard/context` | Codebase overview, check index freshness |
| `gitnexus://repo/vibe-dashboard/clusters` | All functional areas |
| `gitnexus://repo/vibe-dashboard/processes` | All execution flows |
| `gitnexus://repo/vibe-dashboard/process/{name}` | Step-by-step execution trace |

## CLI

| Task | Read this skill file |
|------|---------------------|
| Understand architecture / "How does X work?" | `.claude/skills/gitnexus/gitnexus-exploring/SKILL.md` |
| Blast radius / "What breaks if I change X?" | `.claude/skills/gitnexus/gitnexus-impact-analysis/SKILL.md` |
| Trace bugs / "Why is X failing?" | `.claude/skills/gitnexus/gitnexus-debugging/SKILL.md` |
| Rename / extract / split / refactor | `.claude/skills/gitnexus/gitnexus-refactoring/SKILL.md` |
| Tools, resources, schema reference | `.claude/skills/gitnexus/gitnexus-guide/SKILL.md` |
| Index, status, clean, wiki CLI commands | `.claude/skills/gitnexus/gitnexus-cli/SKILL.md` |

<!-- gitnexus:end -->
