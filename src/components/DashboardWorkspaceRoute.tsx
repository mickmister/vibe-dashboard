import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { defineMessages, FormattedMessage, useIntl } from 'react-intl';
import type { SavedWorkspaceSession } from '../types';
import { getDefaultSpace } from '../types';
import { usePluginRegistry } from '../modules/plugins/vibe-dashboard/registry';
import type { PluginRegistryState } from '../modules/plugins/vibe-dashboard/types';
import { resolveWorkspaceFactoryComposition } from '../modules/plugins/vibe-dashboard/workspace-composition';
import { useModule } from '../hooks/useModule';
import { resolveWorkspaceContainerRef } from '../lib/vkWorkspaceOpen';
import { getSavedWorkspaceSessions } from '../lib/savedVoyageState';
import { fetchVdWorkspaceOpenOptions } from '../lib/vdWorkspaceOpenApi';
import { isValidVdWorkspaceId } from '../lib/vdWorkspaceLinks';
import { buildExistingVdWorkspaceDashboardPath, findSavedVoyageForVdWorkspaceRoute } from '../lib/vdWorkspaceRoute';

const dashboardWorkspaceRouteMessages = defineMessages({
  openingWorkspace: {
    defaultMessage: 'Opening workspace',
    description: 'Title shown while a shared VD workspace link is opening.',
  },
  workspaceLinkUnavailable: {
    defaultMessage: 'Workspace link unavailable',
    description: 'Title shown when a shared VD workspace link cannot be opened.',
  },
  openingStatus: {
    defaultMessage: 'Opening VK workspace…',
    description: 'Status text shown while loading a shared VK workspace link.',
  },
  invalidLink: {
    defaultMessage: 'This VD workspace link is invalid.',
    description: 'Error shown when a shared VD workspace link has an invalid workspace identifier.',
  },
  missingFactory: {
    defaultMessage: 'VD could not find a workspace view factory for this link.',
    description: 'Error shown when no workspace view factory can open a shared VD workspace link.',
  },
  detailsLoadFailed: {
    defaultMessage: 'VD could not load VK workspace details for this link.',
    description: 'Error shown when workspace metadata cannot be loaded for a shared VD workspace link.',
  },
  workspaceNotFound: {
    defaultMessage: 'This VK workspace could not be found or is archived.',
    description: 'Error shown when a shared VK workspace link points to a missing or archived workspace.',
  },
  openFailed: {
    defaultMessage: 'VD could not open this VK workspace link.',
    description: 'Error shown when creating a saved dashboard session from a shared VK workspace link fails.',
  },
});

function getDefaultVKWorkspaceFactoryKeyForRoute(
  pluginRegistry: PluginRegistryState,
): string | undefined {
  return Object.values(pluginRegistry.tabGroupFactories)
    .filter((factory) => factory.launchMode === 'vk-workspace')
    .sort(
      (left, right) =>
        (left.order ?? 0) - (right.order ?? 0) ||
        left.key.localeCompare(right.key),
    )[0]?.key;
}

export function DashboardWorkspaceRoute() {
  const intl = useIntl();
  const { workspaceId } = useParams<{ workspaceId: string }>();
  const navigate = useNavigate();
  const workspaceModule = useModule('workspace');
  const workspace = workspaceModule.states.workspace.useState();
  const savedSessions = workspaceModule.states.savedVoyages.useState();
  const savedVoyages = useMemo(
    () => getSavedWorkspaceSessions(savedSessions),
    [savedSessions],
  );
  const pluginRegistryState = usePluginRegistry();
  const actions = workspaceModule.actions;
  const [status, setStatus] = useState<'loading' | 'error'>('loading');
  const [message, setMessage] = useState(() =>
    intl.formatMessage(dashboardWorkspaceRouteMessages.openingStatus),
  );

  useEffect(() => {
    let cancelled = false;
    const openWorkspace = async () => {
      if (!isValidVdWorkspaceId(workspaceId)) {
        setStatus('error');
        setMessage(intl.formatMessage(dashboardWorkspaceRouteMessages.invalidLink));
        return;
      }

      const existing = findSavedVoyageForVdWorkspaceRoute(
        workspace,
        savedVoyages,
        workspaceId,
      );
      if (existing) {
        navigate(
          buildExistingVdWorkspaceDashboardPath({
            workspace,
            savedVoyages,
            existing,
          }),
          { replace: true },
        );
        return;
      }

      const space = getDefaultSpace(workspace);
      const factoryKey = getDefaultVKWorkspaceFactoryKeyForRoute(pluginRegistryState);
      const factory = factoryKey ? pluginRegistryState.tabGroupFactories[factoryKey] : undefined;
      if (!(space && factory)) {
        setStatus('error');
        setMessage(intl.formatMessage(dashboardWorkspaceRouteMessages.missingFactory));
        return;
      }

      const optionsResult = await fetchVdWorkspaceOpenOptions().catch(() => undefined);
      if (!optionsResult?.ok) {
        if (cancelled) return;
        setStatus('error');
        setMessage(intl.formatMessage(dashboardWorkspaceRouteMessages.detailsLoadFailed));
        return;
      }
      const candidate = optionsResult.workspaces.find(
        (entry) => entry.workspaceId === workspaceId,
      );
      if (!candidate) {
        if (cancelled) return;
        setStatus('error');
        setMessage(intl.formatMessage(dashboardWorkspaceRouteMessages.workspaceNotFound));
        return;
      }

      const workspaceName = candidate.displayName || candidate.branch || workspaceId;
      const containerRef = await resolveWorkspaceContainerRef(
        workspaceId,
        candidate.workspaceDir,
      );
      const composition = resolveWorkspaceFactoryComposition({
        factory,
        context: {
          origin: typeof window === 'undefined' ? '' : window.location.origin,
          workspaceId,
          workspaceName,
          containerRef,
        },
      });
      const result = await actions.createSavedSessionForVKWorkspace({
        voyageName: workspaceName,
        taskAttemptId: workspaceId,
        workspaceName,
        containerRef,
        activeSpaceId: space.id,
        composition,
      });
      if (cancelled) return;
      if (!result?.savedSession) {
        setStatus('error');
        setMessage(intl.formatMessage(dashboardWorkspaceRouteMessages.openFailed));
        return;
      }
      navigate(
        buildExistingVdWorkspaceDashboardPath({
          workspace,
          savedVoyages: [result.savedSession as SavedWorkspaceSession, ...savedVoyages],
          existing: { session: result.savedSession as SavedWorkspaceSession },
        }),
        { replace: true },
      );
    };
    void openWorkspace();
    return () => {
      cancelled = true;
    };
  }, [actions, intl, navigate, pluginRegistryState, savedVoyages, workspace, workspaceId]);

  return (
    <div className="dark fixed inset-0 flex items-center justify-center bg-neutral-950 p-6 text-neutral-100">
      <div className="max-w-md rounded-2xl border border-neutral-800 bg-neutral-900 p-6 shadow-2xl">
        <div className="text-xs font-semibold uppercase tracking-[0.2em] text-neutral-500">
          <FormattedMessage
            defaultMessage="VD workspace link"
            description="Eyebrow label for a shared VD workspace link status page."
          />
        </div>
        <h1 className="mt-3 text-xl font-semibold">
          {status === 'loading' ? (
            <FormattedMessage {...dashboardWorkspaceRouteMessages.openingWorkspace} />
          ) : (
            <FormattedMessage {...dashboardWorkspaceRouteMessages.workspaceLinkUnavailable} />
          )}
        </h1>
        <p className="mt-2 text-sm text-neutral-300">{message}</p>
        {status === 'error' ? (
          <button
            type="button"
            className="mt-4 rounded-lg border border-neutral-700 px-4 py-2 text-sm text-neutral-100 hover:bg-neutral-800"
            onClick={() => navigate('/dashboard', { replace: true })}
          >
            <FormattedMessage
              defaultMessage="Go to dashboard"
              description="Button label that returns users from a failed shared workspace link to the dashboard."
            />
          </button>
        ) : null}
      </div>
    </div>
  );
}
