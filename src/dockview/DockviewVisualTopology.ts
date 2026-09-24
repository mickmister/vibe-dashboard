import { Orientation, type SerializedDockview } from 'dockview';

export type DockviewTopologyRect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

type DockviewLeafNode = {
  type: 'leaf';
  data: { id: string; views: string[]; activeView?: string };
  size?: number;
};

type DockviewBranchNode = {
  type: 'branch';
  data: DockviewTopologyNode[];
  size?: number;
};

type DockviewTopologyNode = DockviewLeafNode | DockviewBranchNode;

type DockviewAxis = 'horizontal' | 'vertical';

type VisibleDockviewGroup = {
  id: string;
  activePanelId: string | null;
  panelIds: string[];
  rect: DockviewTopologyRect;
};

export function visibleRightAdjacentPanelIds(
  snapshot: SerializedDockview,
  invokingPanelId: string,
): string[] {
  const groups = collectVisibleGroups(snapshot);
  const invoking = groups.find((group) => group.activePanelId === invokingPanelId);
  if (!invoking) return [];
  return groups
    .filter((group) => group.id !== invoking.id && group.activePanelId && isImmediatelyRightOf(invoking.rect, group.rect))
    .map((group) => group.activePanelId!)
    .sort();
}

function collectVisibleGroups(snapshot: SerializedDockview): VisibleDockviewGroup[] {
  const root = snapshot.grid.root as DockviewTopologyNode;
  if (!isBranch(root)) return [];
  const axis = normalizeAxis(snapshot.grid.orientation);
  const rect = {
    x: 0,
    y: 0,
    width: finitePositive(snapshot.grid.width) ? snapshot.grid.width : 1,
    height: finitePositive(snapshot.grid.height) ? snapshot.grid.height : 1,
  };
  return collectGroups(root, rect, axis);
}

function collectGroups(
  node: DockviewTopologyNode,
  rect: DockviewTopologyRect,
  axis: DockviewAxis,
): VisibleDockviewGroup[] {
  if (isLeaf(node)) {
    const activePanelId = node.data.activeView && node.data.views.includes(node.data.activeView)
      ? node.data.activeView
      : node.data.views[0] ?? null;
    return [{
      id: node.data.id,
      activePanelId,
      panelIds: [...node.data.views],
      rect,
    }];
  }
  const children = node.data.filter((child) => isLeaf(child) || isBranch(child));
  const total = children.reduce((sum, child) => sum + weight(child), 0) || children.length || 1;
  let offset = 0;
  return children.flatMap((child) => {
    const share = weight(child) / total;
    const childRect = axis === 'horizontal'
      ? {
        x: rect.x + offset,
        y: rect.y,
        width: rect.width * share,
        height: rect.height,
      }
      : {
        x: rect.x,
        y: rect.y + offset,
        width: rect.width,
        height: rect.height * share,
      };
    offset += axis === 'horizontal' ? childRect.width : childRect.height;
    return collectGroups(child, childRect, opposite(axis));
  });
}

function isImmediatelyRightOf(left: DockviewTopologyRect, right: DockviewTopologyRect): boolean {
  const epsilon = 1;
  return verticalOverlap(left, right) > epsilon
    && Math.abs(left.x + left.width - right.x) <= epsilon;
}

function verticalOverlap(left: DockviewTopologyRect, right: DockviewTopologyRect): number {
  return Math.min(left.y + left.height, right.y + right.height) - Math.max(left.y, right.y);
}

function normalizeAxis(value: unknown): DockviewAxis {
  return value === Orientation.VERTICAL || value === 'VERTICAL' ? 'vertical' : 'horizontal';
}

function opposite(axis: DockviewAxis): DockviewAxis {
  return axis === 'horizontal' ? 'vertical' : 'horizontal';
}

function weight(node: DockviewTopologyNode): number {
  return finitePositive(node.size) ? node.size : 1;
}

function finitePositive(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

function isLeaf(value: unknown): value is DockviewLeafNode {
  return Boolean(value && typeof value === 'object' && (value as { type?: unknown }).type === 'leaf'
    && (value as { data?: unknown }).data && typeof (value as { data?: unknown }).data === 'object');
}

function isBranch(value: unknown): value is DockviewBranchNode {
  return Boolean(value && typeof value === 'object' && (value as { type?: unknown }).type === 'branch'
    && Array.isArray((value as { data?: unknown }).data));
}
