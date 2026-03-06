# IframePanel Refactor: Persistent Panels to Prevent Iframe Reloads

## Problem

When switching between viewing a tab solo and viewing it in a tab pair (split view), the iframe reloads and shows a white screen while the SPA re-bootstraps. This is because `IframeHost` unmounts from one spot in the React tree (e.g. `SingleTabView`) and remounts in another (`PairView > Panel`). **Browsers reload an iframe whenever it's detached from and reattached to the DOM**, even if it's the same DOM element.

## Root Cause

In `IframePanel.tsx`, the render logic (lines 324-349) conditionally renders iframes in different locations:

- **Hidden tabs**: rendered via `<IframeHost visible={false}>` in a flat loop (lines 326-329)
- **Active single tab**: rendered inside `SingleTabView` (line 384)
- **Active pair tabs**: rendered inside `PairView > Panel` (line 425)

When switching from single→pair, the `IframeHost` inside `SingleTabView` unmounts (cleanup detaches the container from DOM, line 285-288), then a new `IframeHost` inside `PairView` mounts and reattaches it. The browser sees the detach+reattach and reloads the iframe.

## Solution

**Unify single-tab and pair views.** A single tab is just a Group with one Panel. Every tab always lives in its own `Panel` with a stable key. The `Panel` is always mounted — active panels get their flex size, inactive panels collapse to 0. Iframes never leave the DOM.

### Architecture

```
IframePanel
  └── Group (always rendered, horizontal)
        ├── Panel (tab A, stable key="tab_a")  ← collapsed to 0 if inactive
        │     └── IframeHost (tab A)
        ├── Separator                           ← display:none if not between two active panels
        ├── Panel (tab B, stable key="tab_b")  ← active, gets proportional size
        │     └── IframeHost (tab B)
        ├── Separator
        └── Panel (tab C, stable key="tab_c")  ← active, gets proportional size
              └── IframeHost (tab C)
```

### Key design decisions

1. **Single tab = one-panel Group.** No separate `SingleTabView` — it's just a `Group` where one Panel is active at 100% and the rest are collapsed.
2. **Panels use `collapsible={true}` and `collapsedSize={0}`** for inactive tabs. The library keeps children mounted at size 0 with `overflow: hidden`.
3. **Separators** are only rendered between two *active* panels. Since separators are not iframes, conditionally rendering them (or using `display: none`) is fine.
4. **`IframeHost` never unmounts.** Its cleanup function should NOT detach the iframe container (remove the cleanup in lines 285-288). The container stays attached to its host div permanently.
5. **Internal URLs** (e.g. `internal://spaces-overview`) need special handling — they render React components, not iframes. These should be rendered as Panel children alongside or instead of IframeHost.

## File to modify

`src/components/IframePanel.tsx` — all changes are in this single file.

## Step-by-step implementation

### Step 1: Remove `SingleTabView` and `PairView`

Delete both components (lines 352-437). They will be replaced by a single unified render in `IframePanel`.

### Step 2: Modify `IframeHost` — remove cleanup detach

Current code (lines 278-290):
```tsx
useEffect(() => {
  const host = hostRef.current;
  const entry = iframeStore.get(tabId);
  if (!host || !entry) return;
  host.appendChild(entry.container);
  return () => {
    if (entry.container.parentElement === host) {
      host.removeChild(entry.container);  // ← REMOVE THIS CLEANUP
    }
  };
}, [tabId]);
```

Remove the cleanup function entirely. The container is appended once and stays. It will only be removed when `removeIframe()` is called (tab closed).

### Step 3: Rewrite `IframePanel` render

Replace the current render (lines 324-349) with a single `Group` containing one `Panel` per tab:

```tsx
export function IframePanel({
  tabGroup, activeItemId, onUpdatePairRatios, workspace, onNavigateToTabGroup,
}: IframePanelProps) {
  const { loadingState } = useImperativeIframes(tabGroup.tabs);

  const activePair = tabGroup.pairs.find((p) => p.id === activeItemId);
  const activeTab = tabGroup.tabs.find((t) => t.id === activeItemId);

  // Determine which tabs are visible and their sizes
  const visibleTabIds = new Set<string>();
  const tabSizes = new Map<string, number>();

  if (activePair) {
    activePair.tabIds.forEach((id, i) => {
      visibleTabIds.add(id);
      tabSizes.set(id, activePair.ratios[i]);
    });
  } else if (activeTab) {
    visibleTabIds.add(activeTab.id);
    tabSizes.set(activeTab.id, 100);
  }

  // Build the list of active tabs in order (for separator placement)
  const activeTabs = tabGroup.tabs.filter((t) => visibleTabIds.has(t.id));

  const handleLayoutChange = activePair
    ? (layout: { [id: string]: number }) => {
        const pairTabs = activePair.tabIds
          .map((id) => tabGroup.tabs.find((t) => t.id === id))
          .filter((t): t is Tab => t != null);
        const newRatios = pairTabs.map((tab) => layout[tab.id] || 0);
        onUpdatePairRatios(activePair.id, newRatios);
      }
    : undefined;

  return (
    <Group
      orientation="horizontal"
      className="flex-1 min-h-0"
      onLayoutChanged={handleLayoutChange}
    >
      {tabGroup.tabs.map((tab, i) => {
        const isActive = visibleTabIds.has(tab.id);
        const isLoaded = loadingState.get(tab.id) ?? false;
        const isInternal = tab.url.startsWith('internal://');
        const size = tabSizes.get(tab.id);

        // Determine if we need a separator BEFORE this panel
        // (only between two consecutive active panels)
        const prevTab = tabGroup.tabs[i - 1];
        const needsSeparator = isActive && prevTab && visibleTabIds.has(prevTab.id);

        return (
          <React.Fragment key={tab.id}>
            {needsSeparator && (
              <Separator className="w-1 bg-neutral-700 hover:bg-neutral-500 data-[resize-handle-state=drag]:bg-primary-500 transition-colors cursor-col-resize flex-shrink-0" />
            )}
            <Panel
              id={tab.id}
              defaultSize={isActive ? size : 0}
              collapsible={true}
              collapsedSize={0}
              minSize={isActive ? 10 : 0}
            >
              <div className="relative w-full h-full">
                {isInternal ? (
                  <InternalContent tab={tab} workspace={workspace} onNavigateToTabGroup={onNavigateToTabGroup} />
                ) : (
                  <IframeHost tabId={tab.id} />
                )}
                {!isInternal && !isLoaded && isActive && <LoadingOverlay />}
              </div>
            </Panel>
          </React.Fragment>
        );
      })}
    </Group>
  );
}
```

### Step 4: Extract internal URL rendering

Move the `internal://` logic from the old `SingleTabView` into a small component:

```tsx
function InternalContent({
  tab, workspace, onNavigateToTabGroup,
}: {
  tab: Tab;
  workspace?: WorkspaceState;
  onNavigateToTabGroup?: (spaceId: string, tabGroupId: string) => void;
}) {
  const internalPath = tab.url.replace('internal://', '');
  if (internalPath === 'spaces-overview' && workspace && onNavigateToTabGroup) {
    const { SpacesOverview } = require('./SpacesOverview');
    return <SpacesOverview workspace={workspace} onNavigateToTabGroup={onNavigateToTabGroup} />;
  }
  return null;
}
```

### Step 5: Simplify `IframeHost`

Remove the `visible` prop since visibility is now controlled by Panel collapse:

```tsx
function IframeHost({ tabId }: { tabId: string }) {
  const hostRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const host = hostRef.current;
    const entry = iframeStore.get(tabId);
    if (!host || !entry) return;
    host.appendChild(entry.container);
    // No cleanup — container stays permanently
  }, [tabId]);

  return <div ref={hostRef} className="w-full h-full relative" />;
}
```

### Step 6: Delete `EmptyView`

No longer needed — if no tab is active, all panels are collapsed to 0. The Group renders but is empty visually. If you want a "no tab selected" message, render it outside the Group conditionally.

## Things to watch out for

### Panel ID stability
The `id` prop on `Panel` must be the tab ID and must stay stable. The library caches layouts by panel ID signature. If IDs change, layouts reset.

### Separator conditional rendering
Separators can be conditionally rendered — they're simple DOM elements, not iframes. The library handles dynamic separator count. Only render a separator between two adjacent *active* panels. Collapsed panels should NOT have separators next to them.

### `defaultSize` vs imperative resize
`defaultSize` only applies on initial mount. Since panels are always mounted, switching from solo→pair won't automatically resize them. You may need to use the Panel imperative API (`panelRef.resize()`) or rely on the library's internal re-layout when panels collapse/expand. **Test this.** If `defaultSize` doesn't apply on subsequent renders, you'll need the `panelRef` imperative handle to call `resize()`.

### `onLayoutChanged` in single-tab mode
When there's only one active panel, there's no resize interaction, but `onLayoutChanged` may still fire. The handler should be a no-op or undefined when there's no active pair.

### Loading overlay positioning
`LoadingOverlay` uses `absolute inset-0` positioning. Since it's inside the Panel's content div, it will correctly cover only that panel's area. No changes needed.

## Verification

1. Open a single tab — confirm iframe loads, fills the space
2. Create a pair from two loaded tabs — confirm **no reload** (check Network tab, check scroll position is preserved, check SPA state like form inputs)
3. Switch from pair back to single tab — confirm no reload
4. Drag the separator in pair view — confirm iframes resize smoothly
5. Resize browser window — confirm layout adjusts
6. Close a tab — confirm its iframe is cleaned up from the store
7. Open a new tab — confirm it starts loading with spinner
8. Check `internal://spaces-overview` tab still renders correctly
