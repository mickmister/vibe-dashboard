import { applyUrlTemplate } from '../../../utils/origin';
import type { TabGroupFactoryContribution } from './types';

export interface VKWorkspaceCompositionContext {
  origin: string;
  workspaceId: string;
  workspaceName: string;
  containerRef: string;
}

export interface ResolvedWorkspaceCompositionTab {
  key: string;
  title: string;
  url: string;
}

export interface ResolvedWorkspaceComposition {
  tabs: ResolvedWorkspaceCompositionTab[];
  pairTabKeys: string[];
  primaryTabKey: string;
}

export function resolveWorkspaceFactoryComposition(input: {
  factory: TabGroupFactoryContribution;
  context: VKWorkspaceCompositionContext;
}): ResolvedWorkspaceComposition {
  const composition = input.factory.workspaceComposition;
  if (!composition || composition.tabs.length === 0) {
    throw new Error(`Plugin factory ${input.factory.key} does not declare a workspace composition`);
  }

  const tabs = composition.tabs.map((tab) => ({
    key: tab.key,
    title: applyUrlTemplate(tab.titleTemplate ?? tab.title, {
      origin: input.context.origin,
      workspaceId: input.context.workspaceId,
      workspaceName: input.context.workspaceName,
      containerRef: input.context.containerRef,
    }),
    url: applyUrlTemplate(tab.urlTemplate, {
      origin: input.context.origin,
      workspaceId: input.context.workspaceId,
      workspaceName: input.context.workspaceName,
      containerRef: input.context.containerRef,
    }),
  }));

  const tabKeys = new Set(tabs.map((tab) => tab.key));
  const pairTabKeys = composition.defaultPairTabKeys?.filter((key) => tabKeys.has(key)) ?? [];
  const primaryTabKey = composition.primaryTabKey && tabKeys.has(composition.primaryTabKey)
    ? composition.primaryTabKey
    : tabs[0]!.key;

  return {
    tabs,
    pairTabKeys,
    primaryTabKey,
  };
}
