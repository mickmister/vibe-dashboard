# Storybook coverage and iframe safety

Storybook runs with the shared app decorator from `.storybook/preview.tsx`:
HeroUI, React Query, dark theme, and the global **Iframes** toolbar.
The iframe toolbar defaults to **Placeholder** so stories do not create real
external iframe DOM unless a story intentionally opts into **Real iframes**.
Use **Disabled** to show iframe-disabled copy while still rendering internal
application views normally.

## Story coverage matrix

| Source area | Story coverage |
| --- | --- |
| `AppLoadingScreen` | `AppLoadingScreen.stories.tsx` covers inline and full-screen loading. |
| `AddressBar` | `AddressBar.stories.tsx` covers single tab, split pair, and no-active view states. |
| `TabContextMenu` | `TabContextMenu.stories.tsx` covers view, pinned, pair, craft, and no-action states. |
| `IframePanel` | `IframePanel.stories.tsx` covers placeholder/disabled iframes, loading/error overlays, split pairs, and blocked self-app URLs. The global **Iframes** toolbar controls supported stories. |
| `SpacesOverview` | `SpacesOverview.stories.tsx` covers loading, backend error, empty, populated, repo-filtered, linked/open craft, space-picker, mutation-error, and pending stop states via the dumb `SpacesOverviewView`. |
| `AddVKWorkspaceModal` | `dialogs/AddVKWorkspaceModal.stories.tsx` covers loading, populated, empty, refresh, load error, search, repo filter, already-open workspace, space picker, custom path, pending add, action error, and no-space states through `AddVKWorkspaceModalView`. |
| `AddTabModal` | `AddTabModal.stories.tsx` covers presets, custom URL, new craft, Open Craft, pending Open Craft, and error states with an injected VK-workspace modal renderer. |
| `WorkspaceShell` shell scenes | `WorkspaceShellScenes.stories.tsx` covers desktop/mobile Voyage bars, Voyage actions, switcher normal/rename/empty, new Voyage prompt, duplicate craft prompt, pending/error Open Craft, expanded craft strips, mobile craft menu, create-first-voyage, and voyage-not-found scenes. |

## Documented exclusions

These files are intentionally not rendered directly as top-level stories because
storying their extracted dumb sub-scenes is safer and gives better deterministic
coverage:

- `Sidebar.tsx`: integration-heavy shell navigation with workspace/session
  mutations; its visible shell states are represented by `WorkspaceShellScenes`
  and lower-level navigation stories should be added only after isolating a dumb
  sidebar view.
- `WorkspaceContentView.tsx`: orchestrates active craft content, add-tab modals,
  and `IframePanel`; leaf iframe/content behavior is covered by `IframePanel`,
  `SpacesOverview`, `AddTabModal`, and `WorkspaceShellScenes`.
- `UnifiedTabView.tsx`: composition layer for tab/split rendering; iframe and
  internal-view behavior is covered through `IframePanel` and the scene stories.
- Container exports such as `WorkspaceShell`, `SpacesOverview`, and
  `AddVKWorkspaceModal` keep runtime data/actions; their dumb view components are
  the Storybook targets to avoid network calls or Springboard/VK runtime setup.
