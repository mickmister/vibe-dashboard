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
