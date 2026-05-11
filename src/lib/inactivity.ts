export const INACTIVITY_ACTIVITY_PATH = '/internal/inactivity/activity';
export const INACTIVITY_STATUS_PATH = '/internal/inactivity/status';

export type ActivityEventType =
  | 'window_focus'
  | 'pointer_down'
  | 'key_down'
  | 'navigation_select_space'
  | 'navigation_select_tab'
  | 'navigation_select_pair'
  | 'navigation_set_tab_group'
  | 'navigation_open_workspace'
  | 'iframe_focus'
  | 'iframe_pointer_down'
  | 'iframe_key_down';

export type ActivitySource = 'window' | 'iframe' | 'navigation';

export interface ActivityBeaconPayload {
  type: ActivityEventType;
  source: ActivitySource;
  href?: string;
  spaceId?: string;
  tabGroupId?: string;
  itemId?: string;
  iframeTabId?: string;
  occurredAt?: string;
}

export type IdleReason =
  | 'agent_running'
  | 'recent_user_activity'
  | 'idle_timeout_elapsed';

export interface IdleStatusResponse {
  isIdle: boolean;
  idleReason: IdleReason;
  idleTimeoutMs: number;
  activityDebounceMs: number;
  lastUserActivityAt: string | null;
  lastUserActivityType: ActivityEventType | null;
  lastUserActivitySource: ActivitySource | null;
  hasRunningAgent: boolean;
  agentStateKnown: boolean;
  agentPollIntervalMs: number;
  lastAgentPollAt: string | null;
  lastSuccessfulAgentPollAt: string | null;
  backendBaseUrl: string;
  computedAt: string;
}
