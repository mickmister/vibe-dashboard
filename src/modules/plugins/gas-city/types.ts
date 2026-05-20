import type { PluginContributions } from "../vibe-dashboard/types";

export interface GasCitySessionInfo {
  ID: string;
  Template: string;
  State: string;
  Closed: boolean;
  Title: string;
  Alias: string;
  AgentName: string;
  Provider: string;
  Transport: string;
  Command: string;
  WorkDir: string;
  SessionName: string;
  SessionKey: string;
  ResumeFlag: string;
  ResumeStyle: string;
  ResumeCommand: string;
  CreatedAt: string;
  LastActive: string;
  Attached: boolean;
}

export interface GasCityDashboardState {
  gcBinary: string;
  cityPath: string;
  sessions: GasCitySessionInfo[];
  peekBySessionId: Record<string, string>;
  loading: boolean;
  loaded: boolean;
  error: string | null;
  lastCommandOutput: string;
  statusOutput: string;
}

export function createDefaultGasCityDashboardState(): GasCityDashboardState {
  return {
    gcBinary: "gc",
    cityPath: "",
    sessions: [],
    peekBySessionId: {},
    loading: false,
    loaded: false,
    error: null,
    lastCommandOutput: "",
    statusOutput: "",
  };
}

export interface GasCityPluginModule {
  contributions: PluginContributions;
  states: {
    dashboard: {
      useState: () => GasCityDashboardState;
      getState: () => GasCityDashboardState;
    };
  };
  actions: {
    setConfig: (args: { gcBinary: string; cityPath: string }) => Promise<void>;
    refreshSessions: () => Promise<GasCitySessionInfo[]>;
    refreshStatus: () => Promise<string>;
    createSession: (args: {
      template: string;
      alias?: string;
      title?: string;
    }) => Promise<string>;
    bootstrapSessionFromWorkspace: (args: {
      workspaceId: string;
      workspaceName: string;
      sessionId: string;
      template: string;
      alias?: string;
      title?: string;
      executor: string;
      workingDir?: string;
    }) => Promise<string>;
    suspendSession: (args: { sessionId: string }) => Promise<string>;
    wakeSession: (args: { sessionId: string }) => Promise<string>;
    killSession: (args: { sessionId: string }) => Promise<string>;
    submitToSession: (args: {
      sessionId: string;
      message: string;
      intent?: "default" | "follow_up" | "interrupt_now";
    }) => Promise<string>;
    peekSession: (args: {
      sessionId: string;
      lines?: number;
    }) => Promise<string>;
    clearError: () => Promise<void>;
  };
}

declare module "springboard/module_registry/module_registry" {
  interface AllModules {
    "plugin-gas-city": GasCityPluginModule;
  }
}
