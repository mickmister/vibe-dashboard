import type { Tab, TabGroup, TabPair } from '../../../types';

interface BuildAppDevelopmentGroupArgs {
  tabGroupId: string;
  pairId: string;
  agentTabId: string;
  codeTabId: string;
  name: string;
  taskAttemptId: string;
  containerRef: string;
  baseOrigin: string;
  order: number;
}

interface BuildAppDevelopmentGroupResult {
  tabGroup: TabGroup;
  agentTabId: string;
  pairId: string;
}

export function buildAppDevelopmentGroup(args: BuildAppDevelopmentGroupArgs): BuildAppDevelopmentGroupResult {
  const tabs: Tab[] = [
    {
      id: args.agentTabId,
      title: 'Agent',
      url: `${args.baseOrigin}/workspaces/${args.taskAttemptId}`,
    },
    {
      id: args.codeTabId,
      title: 'Code',
      url: `${args.baseOrigin}/?folder=${args.containerRef}`,
    },
  ];

  const pairs: TabPair[] = [
    {
      id: args.pairId,
      tabIds: [args.agentTabId, args.codeTabId],
      ratios: [50, 50],
    },
  ];

  const tabGroup: TabGroup = {
    id: args.tabGroupId,
    label: args.name.length > 30 ? `${args.name.slice(0, 27)}...` : args.name,
    tabs,
    pairs,
    order: args.order,
  };

  return {
    tabGroup,
    agentTabId: args.agentTabId,
    pairId: args.pairId,
  };
}
