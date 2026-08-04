export interface EphemeralCraftSurfaceView {
  kind: 'craft-surface';
  pluginId: string;
  surfaceKey: string;
  sourceKey: string;
}

export interface View {
  id: string;
  title: string;
  url: string;
  /** If true, this view is pinned and cannot be closed */
  pinned?: boolean;
  /** Runtime-only view metadata. Ephemeral views must never be persisted. */
  ephemeral?: EphemeralCraftSurfaceView;
}

/** @deprecated Use View. Retained for persisted workspace compatibility. */
export type Tab = View;

export interface ViewPair {
  id: string;
  /** View IDs in this split, rendered side-by-side */
  tabIds: string[];
  /** Percentage sizes for each view (e.g., [75, 25] for 75%/25% split) */
  ratios: number[];
}

/** @deprecated Use ViewPair for new code. Retained for persisted workspace compatibility. */
export type TabPair = ViewPair;

export interface Craft {
  id: string;
  label: string;
  /** VK workspace metadata used to derive first-party/runtime views. */
  workspace?: {
    workspaceId: string;
    workspaceDir: string;
    baseOrigin?: string;
    formsBeadId?: string;
  };
  /** Optional compact label shown in the mobile craft strip */
  mobileLabel?: string;
  /** Optional emoji shown in the mobile craft strip */
  mobileEmoji?: string;
  /** All views in this craft. Persisted as `tabs` for compatibility. */
  tabs: View[];
  /** Split-view presets. Persisted as `pairs` until ad hoc layouts fully replace durable pairs. */
  pairs: ViewPair[];
  /** Display order within the space */
  order: number;
  /** ISO timestamp when this craft was created */
  createdAt?: string;
  /** ISO timestamp when this craft was last navigated to */
  lastVisitedAt?: string;
  /** If true, this craft is starred and shown prominently */
  starred?: boolean;
}

/** @deprecated Use Craft for new code. Retained for persisted workspace compatibility. */
export type TabGroup = Craft;

export interface Space {
  id: string;
  name: string;
  icon: string;
  /** Craft IDs belonging to this space. Persisted as `tabGroupIds` for compatibility. */
  tabGroupIds: string[];
  /** If true, this space cannot be deleted or renamed (e.g., Home space) */
  isSystem?: boolean;
}

export interface VoyageEntry {
  id: string;
  tabGroupId: string;
  /** Ordered active views for this entry, used for single-view and split-view restoration */
  viewIds: string[];
}

export interface VoyageCraftSelection {
  spaceId: string;
  tabGroupId: string;
  tabId?: string;
}

export interface SavedWorkspaceSessionV1 {
  id: string;
  slug?: string;
  name?: string;
  createdAt: string;
  updatedAt: string;
  activeSpaceId: string;
  activeTabGroupId: string;
  /** @deprecated Craft-keyed projection retained for persisted workspace compatibility. */
  activeItems: Record<string, string>;
  visitedTabGroupIds: string[];
}

export interface SavedWorkspaceSessionV2 extends SavedWorkspaceSessionV1 {
  activeVoyageEntryId?: string;
  voyageEntries?: VoyageEntry[];
  /** Active item keyed by VoyageEntry ID. Keeps duplicate craft entries independent. */
  activeItemsByVoyageEntryId?: Record<string, string>;
}

export interface SavedWorkspaceSession {
  id: string;
  slug: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  activeVoyageEntryId: string;
  voyageEntries: VoyageEntry[];
  activeSpaceId: string;
  activeTabGroupId: string;
  /** Active item keyed by VoyageEntry ID. Keeps duplicate craft entries independent. */
  activeItemsByVoyageEntryId: Record<string, string>;
  visitedTabGroupIds: string[];
}

export type SavedWorkspaceSessionState =
  | SavedWorkspaceSessionV1[]
  | {
      version: 2;
      data: SavedWorkspaceSessionV2[];
    }
  | {
      version: 3;
      data: SavedWorkspaceSession[];
    };

export interface WorkspaceState {
  spaces: Space[];
  /** Craft records. Persisted as `tabGroups` for compatibility. */
  tabGroups: Craft[];
  /** Counter for generating unique IDs */
  nextId: number;
}


export function getDefaultSpace(workspace: WorkspaceState): Space | undefined {
  return (
    workspace.spaces.find((space) => space.isSystem) ||
    workspace.spaces.find((space) => space.id === 'space_home') ||
    workspace.spaces[0]
  );
}

export function getFirstTabGroupForSpace(
  workspace: WorkspaceState,
  spaceId: string | undefined,
): Craft | undefined {
  if (!spaceId) return undefined;
  const space = workspace.spaces.find((entry) => entry.id === spaceId);
  if (!space) return undefined;
  const firstTabGroupId = space.tabGroupIds[0];
  if (!firstTabGroupId) return undefined;
  return workspace.tabGroups.find((tabGroup) => tabGroup.id === firstTabGroupId);
}

export function generateId(state: WorkspaceState, prefix: string): string {
  return `${prefix}_${state.nextId}`;
}

export function createDefaultWorkspace(): WorkspaceState {
  return {
    spaces: [
      {
        id: 'space_home',
        name: 'Home',
        icon: 'home',
        tabGroupIds: ['tg_home'],
        isSystem: true,
      },
    ],
    tabGroups: [
      {
        id: 'tg_home',
        label: 'Overview',
        tabs: [
          {
            id: 'tab_overview',
            title: 'Spaces',
            url: 'internal://spaces-overview',
            pinned: true,
          },
        ],
        pairs: [],
        order: 0,
      },
    ],
    nextId: 10,
  };
}
