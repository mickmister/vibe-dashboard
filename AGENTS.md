Keep the following info in mind *when working in the ./src directory only*

This application is built with the **Springboard framework**. All code is assumed to be isomorphic by default.

```typescript
import springboard from 'springboard';

springboard.registerModule('ModuleName', {}, async (moduleAPI) => {
  const sharedState = await moduleAPI.createStates({
    exampleSharedState: {
        items: [] as Array<{name: string}>
    },
  });

  const myClientState = await moduleAPI.createUserAgentState('');

  // Create actions (automatically RPC-enabled)
  const actions = moduleAPI.createActions({
    actionName: async (args) => { /* ... */ }
  });

  // Register routes
  moduleAPI.registerRoute('/', {}, MyComponent);

  // Cleanup
  moduleAPI.onDestroy(() => { /* cleanup */ });

  // Return public API
  return { state, actions };
});
```