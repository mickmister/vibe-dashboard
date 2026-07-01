import type {
  SavedWorkspaceSession,
  Tab,
  TabGroup,
  ViewPair,
  VoyageEntry,
  WorkspaceState,
} from "../../../types";
import { buildWorkspaceFolderUrl } from "../../../lib/vkWorkspaceUrl";
import type { RegisteredCraftSurfaceContribution } from "./types";

export const CRAFT_SURFACE_TAB_ID_PREFIX = "craft-surface:";
export const BUILT_IN_AGENT_TAB_ID = "agent";
export const BUILT_IN_CODE_TAB_ID = "code";
export const BUILT_IN_BEADS_TAB_ID = "beads";
export const BUILT_IN_FORMS_TAB_ID = "forms";
export const BUILT_IN_AGENT_CODE_PAIR_ID = "agent+code";
export const BUILT_IN_AGENT_BEADS_PAIR_ID = "agent+beads";

const BUILT_IN_WORKSPACE_TAB_IDS = new Set([
  BUILT_IN_AGENT_TAB_ID,
  BUILT_IN_CODE_TAB_ID,
  BUILT_IN_BEADS_TAB_ID,
  BUILT_IN_FORMS_TAB_ID,
]);
const BUILT_IN_WORKSPACE_PAIR_IDS = new Set([
  BUILT_IN_AGENT_CODE_PAIR_ID,
  BUILT_IN_AGENT_BEADS_PAIR_ID,
]);
const URL_PARSE_BASE = "https://workspace.local";
const BEADS_WEB_DEFAULT_PORT = "3109";

type BuiltInWorkspaceMetadata = NonNullable<TabGroup["workspace"]>;

export interface CreateEffectiveWorkspaceWithCraftSurfacesInput {
  workspace: WorkspaceState;
  craftSurfaces: RegisteredCraftSurfaceContribution[];
  origin: string;
}

export function createEffectiveWorkspaceWithCraftSurfaces(
  input: CreateEffectiveWorkspaceWithCraftSurfacesInput,
): WorkspaceState {
  return {
    ...input.workspace,
    tabGroups: input.workspace.tabGroups.map((tabGroup) =>
      createEffectiveCraftWithSurfaces({
        tabGroup,
        craftSurfaces: input.craftSurfaces,
        origin: input.origin,
      }),
    ),
  };
}

function createEffectiveCraftWithSurfaces(input: {
  tabGroup: TabGroup;
  craftSurfaces: RegisteredCraftSurfaceContribution[];
  origin: string;
}): TabGroup {
  const tabs = getEffectiveTabs(input.tabGroup, {
    craftSurfaces: input.craftSurfaces,
    origin: input.origin,
  });
  const pairs = getEffectivePairs({ ...input.tabGroup, tabs }, input.origin);

  if (tabs === input.tabGroup.tabs && pairs === input.tabGroup.pairs) {
    return input.tabGroup;
  }
  return { ...input.tabGroup, tabs, pairs };
}

export function getEffectiveTabs(
  tabGroup: TabGroup,
  options: {
    craftSurfaces?: RegisteredCraftSurfaceContribution[];
    origin?: string;
  } = {},
): Tab[] {
  const builtInWorkspaceTabs = getBuiltInWorkspaceTabs(
    tabGroup,
    options.origin ?? "",
  );
  const craftSurfaceTabs = getCraftSurfaceTabs({
    tabGroup,
    craftSurfaces: options.craftSurfaces ?? [],
    origin: options.origin ?? "",
  });
  const generatedTabs = [...builtInWorkspaceTabs, ...craftSurfaceTabs];
  const generatedIds = new Set(generatedTabs.map((tab) => tab.id));
  const customTabs = tabGroup.tabs.filter(
    (tab) =>
      !generatedIds.has(tab.id) &&
      !isEphemeralPluginSurfaceTab(tab) &&
      !(builtInWorkspaceTabs.length > 0 && isGeneratedWorkspaceTab(tab)),
  );
  if (
    generatedTabs.length === 0 &&
    customTabs.length === tabGroup.tabs.length
  ) {
    return tabGroup.tabs;
  }
  return [...generatedTabs, ...customTabs];
}

function isEphemeralPluginSurfaceTab(
  tab: Pick<Tab, "id" | "ephemeral"> | undefined,
): boolean {
  return Boolean(
    tab?.ephemeral?.kind === "craft-surface" ||
      tab?.id.startsWith(CRAFT_SURFACE_TAB_ID_PREFIX),
  );
}

export function getEffectivePairs(tabGroup: TabGroup, origin = ""): ViewPair[] {
  const builtInPairs = getBuiltInWorkspacePairs(tabGroup, origin);
  const builtInPairIds = new Set(builtInPairs.map((pair) => pair.id));
  const validTabIds = new Set(tabGroup.tabs.map((tab) => tab.id));
  const customPairs = tabGroup.pairs.filter(
    (pair) =>
      !builtInPairIds.has(pair.id) &&
      !isBuiltInWorkspacePairId(pair.id) &&
      pair.tabIds.every((tabId) => validTabIds.has(tabId)),
  );
  if (
    builtInPairs.length === 0 &&
    customPairs.length === tabGroup.pairs.length
  ) {
    return tabGroup.pairs;
  }
  return [...builtInPairs, ...customPairs];
}

export function migrateWorkspaceBuiltInTabs(
  workspace: WorkspaceState,
): WorkspaceState {
  let changed = false;
  const tabGroups = workspace.tabGroups.map((tabGroup) => {
    const metadata = getBuiltInWorkspaceMetadata(tabGroup);
    const tabs = tabGroup.tabs.filter((tab) => !isGeneratedWorkspaceTab(tab));
    const validTabIds = new Set(tabs.map((tab) => tab.id));
    const pairs = tabGroup.pairs.filter(
      (pair) =>
        !isBuiltInWorkspacePairId(pair.id) &&
        pair.tabIds.every((tabId) => validTabIds.has(tabId)),
    );

    if (
      metadata ||
      tabs.length !== tabGroup.tabs.length ||
      pairs.length !== tabGroup.pairs.length
    ) {
      changed = true;
      return {
        ...tabGroup,
        ...(metadata ? { workspace: metadata } : {}),
        tabs,
        pairs,
      };
    }

    return tabGroup;
  });

  return changed ? { ...workspace, tabGroups } : workspace;
}

export function getBuiltInWorkspaceMetadata(
  tabGroup: Pick<TabGroup, "tabs" | "workspace">,
): BuiltInWorkspaceMetadata | null {
  if (tabGroup.workspace?.workspaceId && tabGroup.workspace.workspaceDir) {
    return tabGroup.workspace;
  }

  const workspaceId = getWorkspaceIdFromTabs(tabGroup.tabs);
  const workspaceDir = getWorkspaceDirFromTabs(tabGroup.tabs);
  if (!(workspaceId && workspaceDir)) return null;

  return {
    workspaceId,
    workspaceDir,
  };
}

function getBuiltInWorkspaceTabs(tabGroup: TabGroup, origin: string): Tab[] {
  const metadata = getBuiltInWorkspaceMetadata(tabGroup);
  if (!metadata) return [];
  const baseOrigin = origin;
  return [
    {
      id: BUILT_IN_AGENT_TAB_ID,
      title: "Agent",
      url: buildWorkspaceTabUrl(baseOrigin, metadata.workspaceId),
      pinned: true,
    },
    {
      id: BUILT_IN_CODE_TAB_ID,
      title: "Code",
      url: buildWorkspaceFolderUrl(baseOrigin, metadata.workspaceDir),
      pinned: true,
    },
    {
      id: BUILT_IN_BEADS_TAB_ID,
      title: "Beads",
      url: buildBeadsWebUrl(baseOrigin),
      pinned: true,
    },
    {
      id: BUILT_IN_FORMS_TAB_ID,
      title: "Forms",
      url: buildFormsUrl(baseOrigin, metadata.workspaceId, metadata.formsBeadId),
      pinned: true,
    },
  ];
}

function getCraftSurfaceTabs(input: {
  tabGroup: TabGroup;
  craftSurfaces: RegisteredCraftSurfaceContribution[];
  origin: string;
}): Tab[] {
  return [...input.craftSurfaces]
    .sort(
      (left, right) =>
        (left.order ?? 0) - (right.order ?? 0) ||
        left.key.localeCompare(right.key),
    )
    .map(
      (surface): Tab => ({
        id: getCraftSurfaceTabId(input.tabGroup.id, surface.key),
        title: surface.defaultTitle ?? surface.title,
        url: expandCraftSurfaceUrl(surface.urlTemplate, input.origin),
        pinned: true,
        ephemeral: {
          kind: "craft-surface",
          pluginId: surface.pluginId,
          surfaceKey: surface.key,
          sourceKey: surface.sourceKey,
        },
      }),
    );
}

function getBuiltInWorkspacePairs(
  tabGroup: TabGroup,
  origin: string,
): ViewPair[] {
  const tabIds = new Set(
    getEffectiveTabs(tabGroup, { origin }).map((tab) => tab.id),
  );
  const pairs: ViewPair[] = [];
  if (tabIds.has(BUILT_IN_AGENT_TAB_ID) && tabIds.has(BUILT_IN_CODE_TAB_ID)) {
    pairs.push({
      id: BUILT_IN_AGENT_CODE_PAIR_ID,
      tabIds: [BUILT_IN_AGENT_TAB_ID, BUILT_IN_CODE_TAB_ID],
      ratios: [50, 50],
    });
  }
  if (tabIds.has(BUILT_IN_AGENT_TAB_ID) && tabIds.has(BUILT_IN_BEADS_TAB_ID)) {
    pairs.push({
      id: BUILT_IN_AGENT_BEADS_PAIR_ID,
      tabIds: [BUILT_IN_AGENT_TAB_ID, BUILT_IN_BEADS_TAB_ID],
      ratios: [50, 50],
    });
  }
  return pairs;
}

export function getCraftSurfaceTabId(
  tabGroupId: string,
  surfaceKey: string,
): string {
  return `${CRAFT_SURFACE_TAB_ID_PREFIX}${tabGroupId}:${surfaceKey}`;
}

export function isEphemeralCraftSurfaceTab(
  tab: Pick<Tab, "id" | "ephemeral"> | undefined,
): boolean {
  return Boolean(
    tab?.ephemeral?.kind === "craft-surface" ||
    tab?.id.startsWith(CRAFT_SURFACE_TAB_ID_PREFIX) ||
    (tab?.id ? isBuiltInWorkspaceTabId(tab.id) : false),
  );
}

export function isEphemeralCraftSurfaceTabId(tabId: string): boolean {
  return (
    tabId.startsWith(CRAFT_SURFACE_TAB_ID_PREFIX) ||
    isBuiltInWorkspaceTabId(tabId)
  );
}

export function tabGroupHasEphemeralCraftSurfaceTab(
  tabGroup: TabGroup,
  tabId: string,
): boolean {
  return isEphemeralCraftSurfaceTab(
    tabGroup.tabs.find((tab) => tab.id === tabId),
  );
}

export function stripEphemeralCraftSurfaceTabsFromTabGroup(
  tabGroup: TabGroup,
): TabGroup {
  const persistentTabs = tabGroup.tabs.filter(
    (tab) => !isEphemeralCraftSurfaceTab(tab),
  );
  const persistentTabIds = new Set(persistentTabs.map((tab) => tab.id));
  return {
    ...tabGroup,
    tabs: persistentTabs.map(({ ephemeral: _ephemeral, ...tab }) => tab),
    pairs: tabGroup.pairs.filter(
      (pair) =>
        !isBuiltInWorkspacePairId(pair.id) &&
        pair.tabIds.every(
          (tabId) =>
            persistentTabIds.has(tabId) && !isEphemeralCraftSurfaceTabId(tabId),
        ),
    ),
  };
}

export function stripEphemeralCraftSurfaceTabsFromWorkspace(
  workspace: WorkspaceState,
): WorkspaceState {
  return {
    ...workspace,
    tabGroups: workspace.tabGroups.map(
      stripEphemeralCraftSurfaceTabsFromTabGroup,
    ),
  };
}

export function filterEphemeralCraftSurfaceActiveItems(
  workspace: WorkspaceState,
  activeItems: Record<string, string>,
): Record<string, string> {
  const effectivePairIds = new Set(
    workspace.tabGroups.flatMap((tabGroup) =>
      tabGroup.pairs.map((pair) => pair.id),
    ),
  );
  return Object.fromEntries(
    Object.entries(activeItems).filter(([tabGroupId, itemId]) => {
      const tabGroup = workspace.tabGroups.find(
        (candidate) => candidate.id === tabGroupId,
      );
      return tabGroup
        ? tabGroupHasEphemeralCraftSurfaceTab(tabGroup, itemId) ||
            effectivePairIds.has(itemId)
        : false;
    }),
  );
}

export function stripEphemeralCraftSurfaceSessionRefs(input: {
  workspace: WorkspaceState;
  session: Pick<
    SavedWorkspaceSession,
    | "activeVoyageEntryId"
    | "voyageEntries"
    | "activeItemsByVoyageEntryId"
    | "visitedTabGroupIds"
  >;
}): Pick<
  SavedWorkspaceSession,
  "voyageEntries" | "activeItemsByVoyageEntryId"
> {
  const tabGroupsById = new Map(
    input.workspace.tabGroups.map((tabGroup) => [tabGroup.id, tabGroup]),
  );
  const sanitizeViewIds = (entry: VoyageEntry): string[] => {
    const tabGroup = tabGroupsById.get(entry.tabGroupId);
    if (!tabGroup) return [];
    const persistentTabIds = new Set(
      tabGroup.tabs
        .filter((tab) => !isEphemeralCraftSurfaceTab(tab))
        .map((tab) => tab.id),
    );
    return entry.viewIds.filter((viewId) => persistentTabIds.has(viewId));
  };

  const voyageEntries = (input.session.voyageEntries ?? []).map((entry) => ({
    ...entry,
    viewIds: sanitizeViewIds(entry),
  }));
  const activeItemsByVoyageEntryId = Object.fromEntries(
    Object.entries(input.session.activeItemsByVoyageEntryId ?? {}).filter(
      ([, itemId]) =>
        !isEphemeralCraftSurfaceTabId(itemId) &&
        !isBuiltInWorkspacePairId(itemId),
    ),
  );

  return { voyageEntries, activeItemsByVoyageEntryId };
}

export function isBuiltInWorkspaceTabId(tabId: string): boolean {
  return BUILT_IN_WORKSPACE_TAB_IDS.has(tabId);
}

export function isBuiltInWorkspacePairId(pairId: string): boolean {
  return BUILT_IN_WORKSPACE_PAIR_IDS.has(pairId);
}

function isGeneratedWorkspaceTab(
  tab: Pick<Tab, "id" | "title" | "url" | "ephemeral">,
): boolean {
  return (
    isEphemeralCraftSurfaceTab(tab) ||
    isAgentTab(tab) ||
    isCodeTab(tab) ||
    isBeadsTab(tab) ||
    isFormsTab(tab)
  );
}

function buildWorkspaceTabUrl(baseOrigin: string, workspaceId: string): string {
  return `${baseOrigin}/workspaces/${workspaceId}`;
}

function buildFormsUrl(baseOrigin: string, workspaceId: string, beadId?: string): string {
  const params = new URLSearchParams({ workspace: workspaceId });
  if (beadId) params.set("bead", beadId);
  return `${baseOrigin}/dashboard/forms?${params.toString()}`;
}

function buildBeadsWebUrl(baseOrigin: string): string {
  if (!baseOrigin) return "/beads";
  try {
    const parsed = new URL(baseOrigin, URL_PARSE_BASE);
    if (isIpHostname(parsed.hostname)) {
      return `${parsed.protocol}//${formatUrlHostname(parsed.hostname)}:${BEADS_WEB_DEFAULT_PORT}`;
    }
    const baseHostname = parsed.hostname
      .replace(/^port-\d+\./, "")
      .replace(/^\d+\./, "");
    const beadsWebBaseHostname = getBeadsWebBaseHostname(baseHostname);
    return `${parsed.protocol}//beads-web.${beadsWebBaseHostname}${parsed.port ? `:${parsed.port}` : ""}`;
  } catch {
    return "/beads";
  }
}

function getBeadsWebBaseHostname(hostname: string): string {
  if (hostname === "localhost" || hostname.endsWith(".localhost")) {
    return "localhost";
  }
  if (hostname === "mysite.com" || hostname.endsWith(".mysite.com")) {
    return "mysite.com";
  }
  return hostname;
}

function formatUrlHostname(hostname: string): string {
  if (hostname.startsWith("[") && hostname.endsWith("]")) return hostname;
  return hostname.includes(":") ? `[${hostname}]` : hostname;
}

function getWorkspaceIdFromTabs(tabs: Tab[]): string | null {
  for (const tab of tabs) {
    const match = tab.url.match(/\/workspaces\/([^/?#]+)/);
    if (match?.[1]) return decodeURIComponent(match[1]);
  }
  return null;
}

function getWorkspaceDirFromTabs(tabs: Tab[]): string | null {
  for (const tab of tabs) {
    try {
      const parsed = new URL(tab.url, URL_PARSE_BASE);
      const folder = parsed.searchParams.get("folder")?.trim();
      if (folder) return folder;
    } catch {
      // Ignore invalid custom URLs.
    }
  }
  return null;
}

function isAgentTab(tab: Pick<Tab, "title" | "url">): boolean {
  return (
    tab.title.trim().toLowerCase() === "agent" ||
    /\/workspaces\/[^/?#]+/.test(tab.url)
  );
}

function isCodeTab(tab: Pick<Tab, "title" | "url">): boolean {
  if (tab.title.trim().toLowerCase() === "code") return true;
  try {
    return new URL(tab.url, URL_PARSE_BASE).searchParams.has("folder");
  } catch {
    return false;
  }
}

function isBeadsTab(tab: Pick<Tab, "id" | "title" | "url">): boolean {
  return (
    tab.id === BUILT_IN_BEADS_TAB_ID ||
    tab.title.trim().toLowerCase() === "beads"
  );
}

function isFormsTab(tab: Pick<Tab, "id" | "title" | "url">): boolean {
  return (
    tab.id === BUILT_IN_FORMS_TAB_ID ||
    tab.title.trim().toLowerCase() === "forms"
  );
}

function isIpHostname(hostname: string): boolean {
  const normalizedHostname = hostname.replace(/^\[(.*)]$/, "$1");
  if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(normalizedHostname)) {
    return normalizedHostname.split(".").every((segment) => {
      const value = Number(segment);
      return Number.isInteger(value) && value >= 0 && value <= 255;
    });
  }
  return normalizedHostname.includes(":");
}

function expandCraftSurfaceUrl(template: string, origin: string): string {
  return template.replaceAll("{{origin}}", origin);
}
