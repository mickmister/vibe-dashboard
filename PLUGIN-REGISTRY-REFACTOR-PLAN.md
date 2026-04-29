# Plugin Registry Refactor Plan

## Goal

Refactor the plugin system so it leans into Springboard appropriately without misusing RPC-backed actions for client-local UI/plugin registration.

This document is intended for another agent to review and pressure-test before implementation tasks are assigned.

---

## Problem Summary

The current branch improves plugin-driven menu registration, but it still uses Springboard constructs in places where plain in-memory functions would be more appropriate.

### Current issues

1. **Plugin registry is modeled as a Springboard module**
   - `plugin-registry` uses `createSharedState`
   - registration APIs are exposed via `createActions`
   - `rpcMode: 'local'` is used to suppress default RPC behavior

2. **`rpcMode: 'local'` is being used as an architectural workaround**
   - this is a niche escape hatch, not the right foundation for UI/plugin registration
   - it should not be the mechanism used for modules that only need in-memory state

3. **Plugin registration and runtime behavior are conflated**
   - capability registration (tab presets, factories, internal page registrations, icons) is mixed with Springboard module/action semantics
   - these are different concerns and should use different primitives

4. **The VK workspace flow is still fragmented**
   - registration metadata exists in plugin modules
   - modal launch behavior is still hardcoded by factory launch mode
   - actual Agent/Code tab-group assembly is still hardcoded in workspace actions

---

## Key Architectural Rule

### Use plain in-memory state / raw functions for:

- plugin registration
- tab preset registration
- tab group factory registration
- internal page / renderer registration
- space type / icon registration
- any client-only UI capability catalog

These should **not** use:

- `createActions`
- `createSharedState`
- `createPersistentState`
- `rpcMode: 'local'`

### Use Springboard modules, actions, and state for:

- persistent state
- shared synchronized state
- authoritative server mutations
- backend data loading
- routes/pages with real runtime behavior
- plugin runtime features that genuinely need server/client coupling

---

## Proposed Direction

### 1. Keep Springboard in the system

Do **not** remove Springboard from plugin architecture.

Instead:

- use Springboard for stateful/runtime behavior
- stop using Springboard actions/state as the transport for plugin registration

### 2. Replace the registry module with a plain client-local registry

Introduce a registry layer that is:

- in-memory
- function-based
- local to the frontend runtime
- observable/subscribable by UI consumers

Conceptually:

- `registerTabPreset(...)`
- `registerTabGroupFactory(...)`
- `registerInternalPage(...)`
- `registerSpaceType(...)`
- `getPluginRegistrySnapshot()`
- `subscribeToPluginRegistry(...)`

This can be implemented with:

- plain Maps/objects
- a small subscription mechanism
- possibly `useSyncExternalStore`-friendly APIs

### 3. Keep plugin-provided Springboard modules for runtime behavior

Plugins may still provide:

- Springboard modules
- server actions
- persistent/shared state
- routes/pages
- internal page logic that calls server actions

But those should be separate from the client-local registration surface.

### 4. Make plugin entrypoints raw functions

The preferred plugin shape should be:

- plain exported plugin definition or registration function
- optional Springboard module definitions/factories alongside it

The host should:

1. load plugin definition
2. invoke raw registration functions for UI/catalog capabilities
3. register any plugin-provided Springboard modules for runtime behavior

### 5. Move VK composite behavior toward plugin-owned declarative composition

The VK/app-development workflow should not remain split across:

- plugin metadata
- modal hardcoded launch branching
- workspace action hardcoded tab creation

Instead, the plugin should own the composition spec for:

- Agent tab
- Code tab
- future Coverage or other related tabs

Persistent creation can still go through a Springboard action, but the action should consume a resolved/spec-based payload instead of hardcoding plugin-specific semantics.

---

## Suggested Target Shape

### Client-local plugin registry layer

Owns:

- tab preset catalog
- tab group factory catalog
- internal page/renderer catalog
- space type catalog

Does **not** own:

- persistent workspace state
- server actions
- synchronized app state

### Springboard runtime layer

Owns:

- workspace persistence
- authoritative mutations
- plugin-specific backend logic
- routes/pages
- RPC-backed actions where they truly belong

### Integration boundary

UI registration code:

- builds/updates catalog locally
- isomorphic-safe
- benign if evaluated on server

Mutation/runtime code:

- uses `moduleAPI`
- calls server actions when persisting/changing authoritative state

---

## Concrete Refactor Areas

### A. Replace `plugin-registry` Springboard module

Current shape:

- `src/modules/plugins/vibe-dashboard/module.ts`
- `src/modules/plugins/vibe-dashboard/types.ts`

Desired outcome:

- remove `createSharedState` for registry catalog
- remove `createActions` for registration entrypoints
- remove `rpcMode: 'local'`
- replace with plain registry functions + local subscription/read API

### B. Convert built-in plugins to raw registration calls

Current files:

- `src/modules/plugins/code-server/module.ts`
- `src/modules/plugins/vibe-kanban/module.ts`
- `src/modules/plugins/app-development/module.ts`

Desired outcome:

- no `pluginRegistry.actions.registerContributions(...)`
- use raw registration functions instead
- keep Springboard actions only for genuine runtime mutations/server behavior

### C. Remove hardcoded factory launch branching from modal

Current file:

- `src/components/AddTabModal.tsx`

Current problem:

- factory handling is still hardcoded via `launchMode: 'vk-workspace'`

Desired outcome:

- factories should provide enough declarative behavior or hook information that the modal does not need plugin-specific branching

### D. Untangle VK composition from workspace mutation

Current files:

- `src/modules/plugins/vibe-kanban/module.ts`
- `src/index.tsx`
- `src/modules/plugins/vibe-kanban/components/AddVKWorkspaceModal.tsx`

Desired outcome:

- client-side code resolves/constructs the intended tab-group spec
- persistent creation uses a Springboard action boundary
- workspace action should not encode plugin-specific Agent/Code semantics directly

---

## Open Design Questions For Review

1. **What should the plugin definition shape be?**
   - simple function?
   - object with `register(...)` callback?
   - object plus optional module factories?

2. **Should plugin-provided Springboard modules be returned from plugin definitions?**
   - likely yes, if the host remains responsible for registration order and compatibility checks

3. **What is the minimal declarative factory model?**
   - callback that returns UI behavior?
   - callback that returns a tab-group spec?
   - callback that launches a modal and later calls a host action?

4. **How should internal plugin pages be registered?**
   - raw function + local renderer registry?
   - should they map to `internal://plugins/<slug>/...` directly?

5. **How much of the plugin system should be isomorphic-safe by design?**
   - likely all registration definitions
   - runtime effects should only happen in appropriate host contexts

6. **How should the eventual npm package surface map to this?**
   - the exported API should reflect raw registration functions/types
   - not Springboard action signatures for the registry layer

---

## Recommended Review Focus

Another agent reviewing this plan should answer:

1. Is the split between client-local registration and Springboard runtime behavior the right one?
2. Is there any reason the registry catalog truly needs Springboard shared/persistent state?
3. What is the cleanest plugin definition format for future external plugins?
4. What is the smallest refactor that removes `rpcMode: 'local'` from the registry path?
5. How should the VK composite flow become declarative without overengineering the factory model?
6. Are there any Springboard-specific lifecycle constraints that would make plain-function registration unsafe or awkward?

---

## Non-Goals For This Refactor

- not redesigning all plugin runtime behavior away from Springboard
- not removing server actions where they are truly needed
- not solving external plugin loading/discovery in this document
- not finalizing the npm package structure here

---

## Expected Outcome

If this refactor succeeds:

- plugin catalog registration is plain, local, and simple
- `rpcMode: 'local'` disappears from the registry path
- Springboard remains the foundation for stateful/runtime app behavior
- plugin definitions become easier to reason about and export externally
- VK-related tab composition becomes more declarative and less fragmented

