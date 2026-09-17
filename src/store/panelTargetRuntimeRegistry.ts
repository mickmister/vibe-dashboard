export interface PanelTargetRuntimeRegistrySnapshot {
  terminals: Record<string, { workspaceId: string; location: string }>;
  previews: Record<string, { workspaceId: string; location: string }>;
  builtInRoutes: Record<string, { location: string; allowedCraftIds: string[]; capabilities?: unknown }>;
}

let snapshot: PanelTargetRuntimeRegistrySnapshot = { terminals: {}, previews: {}, builtInRoutes: {} };

/** Canonical read-only boundary for live backend and built-in route definitions. */
export function getPanelTargetRuntimeRegistrySnapshot(): PanelTargetRuntimeRegistrySnapshot {
  return structuredClone(snapshot);
}

export function replacePanelTargetRuntimeRegistry(next: PanelTargetRuntimeRegistrySnapshot): void {
  snapshot = structuredClone(next);
}

export function clearPanelTargetRuntimeRegistryForTests(): void {
  snapshot = { terminals: {}, previews: {}, builtInRoutes: {} };
}
