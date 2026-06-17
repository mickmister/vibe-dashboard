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
        tasks: (projectId) => `${BASE_URL}/api/tasks?project_id=${projectId}`,
        task: (taskId) => `${BASE_URL}/api/tasks/${taskId}`,
        taskAttempts: `${BASE_URL}/api/task-attempts`,
        taskAttemptsByTask: (taskId) => `${BASE_URL}/api/task-attempts?task_id=${taskId}`,
        taskAttempt: (workspaceId) => `${BASE_URL}/api/task-attempts/${workspaceId}`,
        taskAttemptSummary: `${BASE_URL}/api/task-attempts/summary`,
        firstMessage: (workspaceId) => `${BASE_URL}/api/task-attempts/${workspaceId}/first-message`,
        sessions: (workspaceId) => `${BASE_URL}/api/sessions?workspace_id=${workspaceId}`,
        session: (sessionId) => `${BASE_URL}/api/sessions/${sessionId}`,
        createSession: `${BASE_URL}/api/sessions`,
        sessionFollowUp: (sessionId) => `${BASE_URL}/api/sessions/${sessionId}/follow-up`,
        executionProcess: (processId) => `${BASE_URL}/api/execution-processes/${processId}`,
        info: `${BASE_URL}/api/info`,
    },
    // WebSocket endpoints
    wsEndpoints: {
        executionLogs: (processId) => `${WS_BASE_URL}/api/execution-processes/${processId}/normalized-logs/ws`,
        sessionProcesses: (sessionId) => `${WS_BASE_URL}/api/execution-processes/stream/session/ws?session_id=${sessionId}`,
    },
};
export const BASE_ROLES = ['implementer', 'reviewer', 'pm', 'assistant'];
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
export function isValidRole(role) {
    // Allow standard roles with pattern
    if (ROLE_PATTERN.test(role))
        return true;
    // Allow base roles with arbitrary suffix (e.g., pm-songdrive, reviewer-foo)
    if (ROLE_WITH_SUFFIX_PATTERN.test(role))
        return true;
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
export function parseRole(role) {
    // Try numbered pattern first
    const numberedMatch = role.match(ROLE_PATTERN);
    if (numberedMatch) {
        const base = numberedMatch[1];
        const suffix = numberedMatch[2] ? numberedMatch[2].slice(1) : null; // Remove leading '-'
        return { base, suffix };
    }
    // Try arbitrary suffix pattern
    const suffixMatch = role.match(ROLE_WITH_SUFFIX_PATTERN);
    if (suffixMatch) {
        const base = suffixMatch[1];
        const suffix = suffixMatch[2];
        return { base, suffix };
    }
    return null;
}
/**
 * Get the base role from a potentially suffixed role.
 * For arbitrary/custom roles (not matching base-suffix pattern), returns null.
 */
export function getBaseRole(role) {
    const parsed = parseRole(role);
    if (!parsed) {
        return null;
    }
    return parsed.base;
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
export const ROLE_PROFILES = {
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
export function getRoleProfile(role) {
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
const CONFIG_FILE_NAMES = [
    'vibe-agent.yaml',
    'vibe-agent.yml',
    '.vibe-agent.yaml',
    '.vibe-agent.yml',
];
function findWorktreeRoot(cwd) {
    const worktreesIdx = cwd.indexOf('/worktrees/');
    if (worktreesIdx === -1)
        return null;
    const afterWorktrees = cwd.slice(worktreesIdx + '/worktrees/'.length);
    const worktreeName = afterWorktrees.split('/')[0];
    return cwd.slice(0, worktreesIdx + '/worktrees/'.length + worktreeName.length);
}
function parseYamlVariant(contents) {
    const lines = contents.split('\n');
    for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#'))
            continue;
        const match = trimmed.match(/^variant\s*:\s*(.+)\s*$/);
        if (match) {
            return match[1].replace(/^['"]|['"]$/g, '').trim();
        }
    }
    return null;
}
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
export function getAgentYamlConfigResult(cwd = process.cwd()) {
    const root = findWorktreeRoot(cwd);
    if (!root)
        return { found: false, reason: 'not_in_worktree' };
    let lastFilePath = null;
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
        }
        catch (err) {
            if (err.code === 'ENOENT')
                continue;
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
export function getAgentYamlConfig(cwd = process.cwd()) {
    const result = getAgentYamlConfigResult(cwd);
    return result.found ? result.config : null;
}
/**
 * Get the required agent YAML config. Throws if config file not found or variant not set.
 */
export function getRequiredAgentConfig(cwd = process.cwd()) {
    const result = getAgentYamlConfigResult(cwd);
    if (result.found) {
        return result.config;
    }
    switch (result.reason) {
        case 'not_in_worktree':
            throw new Error('Not inside a VK worktree. Cannot locate config file.\n' +
                'Hint: Run from within a worktree directory.');
        case 'no_config_file':
            throw new Error(`Config file not found. Create one of:\n` +
                CONFIG_FILE_NAMES.map(f => `  ${path.join(result.root, f)}`).join('\n') +
                `\n\nWith contents:\n  variant: DEFAULT`);
        case 'no_variant':
            throw new Error(`Config file found but missing 'variant' field: ${result.filePath}\n` +
                `Add to the file:\n  variant: DEFAULT`);
    }
}
