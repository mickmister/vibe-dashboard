import * as fs from 'fs';
import * as path from 'path';

// Vibe Kanban API Configuration

// Support both VIBE_API_URL (preferred) and VK_API_URL (legacy)
const BASE_URL = process.env.VIBE_API_URL || process.env.VK_API_URL || 'http://localhost:3007';
const WS_BASE_URL = BASE_URL.replace('http', 'ws');

export const config = {
  BASE_URL,
  WS_BASE_URL,

  // API endpoints
  endpoints: {
    projects: `${BASE_URL}/api/projects`,
    repos: `${BASE_URL}/api/repos`,
    tasks: (projectId: string) => `${BASE_URL}/api/tasks?project_id=${projectId}`,
    task: (taskId: string) => `${BASE_URL}/api/tasks/${taskId}`,
    workspaces: `${BASE_URL}/api/workspaces`,
    workspace: (workspaceId: string) => `${BASE_URL}/api/workspaces/${workspaceId}`,
    taskAttempts: `${BASE_URL}/api/task-attempts`,
    taskAttemptsByTask: (taskId: string) => `${BASE_URL}/api/task-attempts?task_id=${taskId}`,
    taskAttempt: (workspaceId: string) => `${BASE_URL}/api/task-attempts/${workspaceId}`,
    taskAttemptSummary: `${BASE_URL}/api/task-attempts/summary`,
    firstMessage: (workspaceId: string) => `${BASE_URL}/api/task-attempts/${workspaceId}/first-message`,
    sessions: (workspaceId: string) => `${BASE_URL}/api/sessions?workspace_id=${workspaceId}`,
    session: (sessionId: string) => `${BASE_URL}/api/sessions/${sessionId}`,
    createSession: `${BASE_URL}/api/sessions`,
    sessionFollowUp: (sessionId: string) => `${BASE_URL}/api/sessions/${sessionId}/follow-up`,
    sessionQueue: (sessionId: string) => `${BASE_URL}/api/sessions/${sessionId}/queue`,
    executionProcess: (processId: string) => `${BASE_URL}/api/execution-processes/${processId}`,
    info: `${BASE_URL}/api/info`,
  },

  // WebSocket endpoints
  wsEndpoints: {
    executionLogs: (processId: string) => `${WS_BASE_URL}/api/execution-processes/${processId}/normalized-logs/ws`,
    sessionProcesses: (sessionId: string) => `${WS_BASE_URL}/api/execution-processes/stream/session/ws?session_id=${sessionId}`,
  },
} as const;

export type Executor =
  | 'CLAUDE_CODE'
  | 'CODEX'
  | 'GEMINI'
  | 'AMP'
  | 'CURSOR_AGENT'
  | 'COPILOT'
  | 'DROID'
  | 'OPENCODE'
  | 'QWEN_CODE';

/** Base roles without numeric suffix */
export type BaseRole = 'implementer' | 'reviewer' | 'pm' | 'assistant';

export const BASE_ROLES: BaseRole[] = ['implementer', 'reviewer', 'pm', 'assistant'];

/**
 * Agent role - can be a base role or a numbered role (e.g., reviewer-2, reviewer-3)
 * Format: <base-role> or <base-role>-<number>
 */
export type AgentRole = string;

// Build regex patterns dynamically from BASE_ROLES to avoid hardcoding
const baseRolesPattern = BASE_ROLES.join('|');

/** Pattern for valid role strings: base role optionally followed by -<number> */
const ROLE_PATTERN = new RegExp(`^(${baseRolesPattern})(-\\d+)?$`);

/** Pattern for base role with arbitrary suffix: base role followed by -<anything> */
const ROLE_WITH_SUFFIX_PATTERN = new RegExp(`^(${baseRolesPattern})-([a-zA-Z0-9_-]+)$`);

/**
 * Check if a string is a valid agent role.
 * Valid: implementer, reviewer, pm, assistant, reviewer-2, pm-3, pm-songdrive, reviewer-foo, etc.
 * Also accepts arbitrary role names (custom roles default to CODEX executor).
 */
export function isValidRole(role: string): role is AgentRole {
  // Allow standard roles with pattern
  if (ROLE_PATTERN.test(role)) return true;

  // Allow base roles with arbitrary suffix (e.g., pm-songdrive, reviewer-foo)
  if (ROLE_WITH_SUFFIX_PATTERN.test(role)) return true;

  // Also allow arbitrary role names (non-empty, reasonable characters)
  // Must not be empty and should be alphanumeric with hyphens/underscores
  return /^[a-zA-Z][a-zA-Z0-9_-]*$/.test(role);
}

/**
 * Parse a role string into its base role and optional suffix.
 * Returns null if not a standard role pattern.
 * For numbered suffixes, suffix is the number as a string.
 * For text suffixes, suffix is the text.
 */
export function parseRole(role: string): { base: BaseRole; suffix: string | null } | null {
  // Try numbered pattern first
  const numberedMatch = role.match(ROLE_PATTERN);
  if (numberedMatch) {
    const base = numberedMatch[1] as BaseRole;
    const suffix = numberedMatch[2] ? numberedMatch[2].slice(1) : null; // Remove leading '-'
    return { base, suffix };
  }

  // Try arbitrary suffix pattern
  const suffixMatch = role.match(ROLE_WITH_SUFFIX_PATTERN);
  if (suffixMatch) {
    const base = suffixMatch[1] as BaseRole;
    const suffix = suffixMatch[2];
    return { base, suffix };
  }

  return null;
}

/**
 * Get the base role from a potentially suffixed role.
 * For arbitrary/custom roles (not matching base-suffix pattern), returns null.
 */
export function getBaseRole(role: AgentRole): BaseRole | null {
  const parsed = parseRole(role);
  if (!parsed) {
    return null;
  }
  return parsed.base;
}

export interface ExecutorProfileId {
  executor: Executor;
  variant?: string;
}

/**
 * Role profile defining executor and variant for a base role.
 */
export interface RoleProfile {
  executor: Executor;
  variant?: string;
}

/**
 * Role profiles mapping base roles to their executor and variant.
 * Source of truth for which executor and variant to use per role.
 *
 * Current executor policy:
 * - All roles use CODEX for now.
 * - Reviewer roles keep HIGH variant for thorough reasoning.
 * - Arbitrary/custom roles default to CODEX.
 */
export const ROLE_PROFILES: Record<BaseRole, RoleProfile> = {
  implementer: {
    executor: 'CODEX',
  },
  reviewer: {
    executor: 'CODEX',
    variant: 'HIGH',
  },
  pm: {
    executor: 'CODEX',
  },
  assistant: {
    executor: 'CODEX',
  },
};

/**
 * Get the executor profile for a given role.
 * Looks up the base role's profile from ROLE_PROFILES.
 *
 * IMPORTANT: This is the source of truth for executor and variant.
 * YAML config files cannot override these settings.
 * For example, reviewer role ALWAYS uses CODEX with HIGH variant,
 * regardless of any YAML config.
 *
 * All roles currently resolve to CODEX; reviewer roles keep HIGH variant.
 * For arbitrary/custom roles (not matching standard pattern),
 * defaults to CODEX executor with no variant.
 */
export function getRoleProfile(role: AgentRole): RoleProfile {
  const parsed = parseRole(role);

  if (role === 'codex' || parsed?.suffix === 'codex') {
    return { executor: 'CODEX' };
  }

  // If it's a standard role, use its profile
  if (parsed) {
    return ROLE_PROFILES[parsed.base];
  }

  // For arbitrary/custom roles, default to CODEX
  return {
    executor: 'CODEX',
  };
}

export interface AgentYamlConfig {
  variant: string;
}

const CONFIG_FILE_NAMES = [
  'vibe-agent.yaml',
  'vibe-agent.yml',
  '.vibe-agent.yaml',
  '.vibe-agent.yml',
];

function findWorktreeRoot(cwd: string): string | null {
  const worktreesIdx = cwd.indexOf('/worktrees/');
  if (worktreesIdx === -1) return null;
  const afterWorktrees = cwd.slice(worktreesIdx + '/worktrees/'.length);
  const worktreeName = afterWorktrees.split('/')[0];
  return cwd.slice(0, worktreesIdx + '/worktrees/'.length + worktreeName.length);
}

function parseYamlVariant(contents: string): string | null {
  const lines = contents.split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const match = trimmed.match(/^variant\s*:\s*(.+)\s*$/);
    if (match) {
      return match[1].replace(/^['"]|['"]$/g, '').trim();
    }
  }
  return null;
}

export type AgentConfigResult =
  | { found: true; config: AgentYamlConfig }
  | { found: false; reason: 'not_in_worktree' }
  | { found: false; reason: 'no_config_file'; root: string }
  | { found: false; reason: 'no_variant'; filePath: string };

/**
 * Get the agent YAML config with detailed result.
 * Returns structured result indicating success or specific failure reason.
 *
 * Config file search order: vibe-agent.yaml, vibe-agent.yml, .vibe-agent.yaml, .vibe-agent.yml
 * First file found wins - if it exists but lacks variant, returns error rather than checking later files.
 *
 * Note: YAML parsing is minimal - only matches top-level `variant: <value>` lines.
 * Nested or indented variant keys are not supported.
 */
export function getAgentYamlConfigResult(cwd: string = process.cwd()): AgentConfigResult {
  const root = findWorktreeRoot(cwd);
  if (!root) return { found: false, reason: 'not_in_worktree' };

  let lastFilePath: string | null = null;
  for (const fileName of CONFIG_FILE_NAMES) {
    const filePath = path.join(root, fileName);
    try {
      const contents = fs.readFileSync(filePath, 'utf-8');
      lastFilePath = filePath;
      const variant = parseYamlVariant(contents);
      if (variant) {
        return { found: true, config: { variant } };
      }
      // File exists but no variant - return specific error
      return { found: false, reason: 'no_variant', filePath };
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') continue;
      throw err;
    }
  }

  return { found: false, reason: 'no_config_file', root };
}

/**
 * Get the agent YAML config. Returns the config if found, or null if not found.
 * The config file must contain a 'variant' field.
 *
 * Note: YAML parsing is minimal - only matches top-level `variant: <value>` lines.
 */
export function getAgentYamlConfig(cwd: string = process.cwd()): AgentYamlConfig | null {
  const result = getAgentYamlConfigResult(cwd);
  return result.found ? result.config : null;
}

/**
 * Get the required agent YAML config. Throws if config file not found or variant not set.
 */
export function getRequiredAgentConfig(cwd: string = process.cwd()): AgentYamlConfig {
  const result = getAgentYamlConfigResult(cwd);

  if (result.found) {
    return result.config;
  }

  switch (result.reason) {
    case 'not_in_worktree':
      throw new Error(
        'Not inside a VK worktree. Cannot locate config file.\n' +
        'Hint: Run from within a worktree directory.'
      );

    case 'no_config_file':
      throw new Error(
        `Config file not found. Create one of:\n` +
        CONFIG_FILE_NAMES.map(f => `  ${path.join(result.root, f)}`).join('\n') +
        `\n\nWith contents:\n  variant: DEFAULT`
      );

    case 'no_variant':
      throw new Error(
        `Config file found but missing 'variant' field: ${result.filePath}\n` +
        `Add to the file:\n  variant: DEFAULT`
      );
  }
}
