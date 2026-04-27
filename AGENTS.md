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


