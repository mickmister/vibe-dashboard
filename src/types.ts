export interface Tab {
  id: string;
  title: string;
  url: string;
  /** If true, this tab is pinned and cannot be closed */
  pinned?: boolean;
}

export interface TabPair {
  id: string;
  /** Tab IDs in this pair, rendered side-by-side */
  tabIds: string[];
  /** Percentage sizes for each tab (e.g., [75, 25] for 75%/25% split) */
  ratios: number[];
}

export interface TabGroup {
  id: string;
  label: string;
  /** All tabs in this group */
  tabs: Tab[];
  /** Tab pairs (split views) */
  pairs: TabPair[];
  /** Display order within the space */
  order: number;
  /** ISO timestamp when this tab group was created */
  createdAt?: string;
  /** ISO timestamp when this tab group was last navigated to */
  lastVisitedAt?: string;
  /** If true, this tab group is starred and shown prominently */
  starred?: boolean;
}

export interface Space {
  id: string;
  name: string;
  icon: string;
  /** Tab group IDs belonging to this space */
  tabGroupIds: string[];
  /** If true, this space cannot be deleted or renamed (e.g., Home space) */
  isSystem?: boolean;
}

export interface SavedWorkspaceSession {
  id: string;
  createdAt: string;
  updatedAt: string;
  activeSpaceId: string;
  activeTabGroupId: string;
  activeItems: Record<string, string>;
  visitedTabGroupIds: string[];
}

export interface SavedWorkspaceSessionState {
  sessions: SavedWorkspaceSession[];
}

export interface WorkspaceState {
  spaces: Space[];
  tabGroups: TabGroup[];
  /** Counter for generating unique IDs */
  nextId: number;
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
