import React from 'react';
import type { Tab, TabGroup } from '../../../types';
import { PreviewRunConfigsPanel } from '../../../components/PreviewRunConfigsPanel';
import { WorkspaceWorkflowsPage } from '../workflows/components/WorkspaceWorkflowsPage';
import {
  BUILT_IN_WORKFLOWS_TAB_ID,
  getBuiltInWorkspaceMetadata,
} from './craft-surfaces';

export interface ReactCraftSurfaceTarget {
  kind: 'react';
  pluginId: string;
  surfaceKey: string;
  props: Record<string, string>;
}

type ReactCraftSurfaceComponent = (
  props: Record<string, string>,
) => React.ReactElement;

const FIRST_PARTY_REACT_SURFACES: Record<string, ReactCraftSurfaceComponent> = {
  'vibe-dashboard/workflows': (props) => (
    <WorkspaceWorkflowsPage workspaceId={props.workspaceId ?? ''} embedded />
  ),
  'dev.mickmister.preview-server/run-configs': (props) => (
    <PreviewRunConfigsPanel workspaceId={props.workspaceId ?? ''} />
  ),
};

export function getReactCraftSurfaceTarget(
  tab: Tab,
  tabGroup: Pick<TabGroup, 'tabs' | 'workspace'>,
): ReactCraftSurfaceTarget | null {
  const workspace = getBuiltInWorkspaceMetadata(tabGroup);
  if (tab.id === BUILT_IN_WORKFLOWS_TAB_ID && workspace?.workspaceId) {
    return {
      kind: 'react',
      pluginId: 'vibe-dashboard',
      surfaceKey: 'workflows',
      props: { workspaceId: workspace.workspaceId },
    };
  }

  if (tab.ephemeral?.kind !== 'craft-surface') return null;

  const key = getReactCraftSurfaceLookupKey(tab.ephemeral);
  if (!key) return null;

  return {
    kind: 'react',
    pluginId: tab.ephemeral.pluginId,
    surfaceKey: tab.ephemeral.surfaceKey,
    props: workspace?.workspaceId
      ? { workspaceId: workspace.workspaceId }
      : {},
  };
}

export function hasReactCraftSurface(
  target: Pick<ReactCraftSurfaceTarget, 'pluginId' | 'surfaceKey'>,
): boolean {
  return getReactCraftSurfaceComponent(target) != null;
}

export function ReactCraftSurfaceHost({
  target,
}: {
  target: ReactCraftSurfaceTarget;
}): React.ReactElement {
  const Component = getReactCraftSurfaceComponent(target);
  if (!Component) return <UnknownReactCraftSurface target={target} />;
  return (
    <div
      className="h-full min-h-0 bg-neutral-950"
      data-testid={`react-craft-surface:${target.pluginId}/${target.surfaceKey}`}
    >
      <Component {...target.props} />
    </div>
  );
}

function getReactCraftSurfaceLookupKey(surface: {
  pluginId: string;
  surfaceKey: string;
  sourceKey?: string;
}): string | null {
  const keys = [
    surface.sourceKey ? `${surface.pluginId}/${surface.sourceKey}` : null,
    `${surface.pluginId}/${surface.surfaceKey}`,
  ].filter((key): key is string => key != null);

  return keys.find((key) => FIRST_PARTY_REACT_SURFACES[key]) ?? null;
}

function getReactCraftSurfaceComponent(target: {
  pluginId: string;
  surfaceKey: string;
}): ReactCraftSurfaceComponent | null {
  const sourceKey = target.surfaceKey.startsWith(`${target.pluginId}/`)
    ? target.surfaceKey.slice(target.pluginId.length + 1)
    : null;
  const keys = [
    sourceKey ? `${target.pluginId}/${sourceKey}` : null,
    `${target.pluginId}/${target.surfaceKey}`,
  ].filter((key): key is string => key != null);

  const key = keys.find((candidate) => FIRST_PARTY_REACT_SURFACES[candidate]);
  if (!key) return null;
  return FIRST_PARTY_REACT_SURFACES[key] ?? null;
}

function UnknownReactCraftSurface({
  target,
}: {
  target: ReactCraftSurfaceTarget;
}) {
  return (
    <div className="flex h-full items-center justify-center bg-neutral-950 p-6 text-center text-sm text-neutral-400">
      <div>
        <p className="font-medium text-neutral-200">
          React surface unavailable
        </p>
        <p className="mt-2">
          {target.pluginId}/{target.surfaceKey}
        </p>
      </div>
    </div>
  );
}
