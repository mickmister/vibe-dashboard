import type { PluginManifest } from "../vibe-dashboard/types";
import type { GasCityGeneratedConfigPreview } from "./city-config-renderer";

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

export type GasCityPackImportScope = "city" | "rig";

export type GasCityPackSafetyTier =
  | "read_only"
  | "safe_structured_control"
  | "authored_text"
  | "executable_or_provider"
  | "destructive_runtime_action";

export interface GasCityGeneratedCityRuntime {
  cityId: string;
  cityName: string;
  runtimeRoot: string;
  cityTomlPath: string;
  lastRenderedAt: string | null;
}

export interface GasCityRenderGeneratedConfigResult {
  runtime: GasCityGeneratedCityRuntime;
  packTomlPath: string;
}

export interface GasCityLocalPackRef {
  id: string;
  binding: string;
  sourcePath: string;
  scope: GasCityPackImportScope;
  rigName: string | null;
  enabled: boolean;
  addedAt: string;
  lastValidatedAt: string | null;
}

export interface GasCityDiscoveredCapability {
  id: string;
  kind:
    | "agent"
    | "named_session"
    | "formula"
    | "order"
    | "command"
    | "doctor"
    | "overlay"
    | "template_fragment"
    | "asset";
  name: string;
  title: string | null;
  safetyTier: GasCityPackSafetyTier;
  sourcePath: string | null;
  executesLocalCode: boolean;
}

export interface GasCityPackValidationCache {
  packRefId: string;
  sourcePath: string;
  checkedAt: string;
  packName: string | null;
  bindingSuggestion: string | null;
  capabilities: GasCityDiscoveredCapability[];
  warnings: string[];
  errors: string[];
}

export interface GasCityOrderSafeOverride {
  packRefId: string;
  orderName: string;
  rigName: string | null;
  enabled: boolean | null;
  interval: string | null;
}

export interface GasCityAgentSafeOverride {
  packRefId: string;
  agentName: string;
  rigName: string | null;
  minActiveSessions: number | null;
  maxActiveSessions: number | null;
  defaultSlingFormula: string | null;
  providerOptionDefaults: Record<string, string>;
}

export interface GasCityBuilderState {
  version: 1;
  generatedCity: GasCityGeneratedCityRuntime;
  localPackRefs: GasCityLocalPackRef[];
  validationCacheByPackRefId: Record<string, GasCityPackValidationCache>;
  orderOverrides: GasCityOrderSafeOverride[];
  agentOverrides: GasCityAgentSafeOverride[];
}

export interface GasCityDashboardState {
  gcBinary: string;
  cityPath: string;
  cityBuilder: GasCityBuilderState;
  sessions: GasCitySessionInfo[];
  peekBySessionId: Record<string, string>;
  loading: boolean;
  loaded: boolean;
  error: string | null;
  lastCommandOutput: string;
  statusOutput: string;
}

export function createDefaultGasCityBuilderState(): GasCityBuilderState {
  return {
    version: 1,
    generatedCity: {
      cityId: "default",
      cityName: "vd-generated",
      runtimeRoot: "",
      cityTomlPath: "",
      lastRenderedAt: null,
    },
    localPackRefs: [],
    validationCacheByPackRefId: {},
    orderOverrides: [],
    agentOverrides: [],
  };
}

export function createDefaultGasCityDashboardState(): GasCityDashboardState {
  return {
    gcBinary: "gc",
    cityPath: "",
    cityBuilder: createDefaultGasCityBuilderState(),
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
  manifest: PluginManifest;
  states: {
    dashboard: {
      useState: () => GasCityDashboardState;
      getState: () => GasCityDashboardState;
    };
  };
  actions: {
    setConfig: (args: { gcBinary: string; cityPath: string }) => Promise<void>;
    renderGeneratedCityConfig: (args?: {
      runtimeRoot?: string;
      cityName?: string;
      cityId?: string;
    }) => Promise<GasCityRenderGeneratedConfigResult>;
    previewGeneratedCityConfig: (args?: {
      runtimeRoot?: string;
      cityName?: string;
      cityId?: string;
    }) => Promise<GasCityGeneratedConfigPreview>;
    scanLocalPack: (args: {
      packRefId: string;
      sourcePath: string;
    }) => Promise<GasCityPackValidationCache>;
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
