// Agent Context - discovers the current agent's context from environment
import { client } from './client.js';
import { readSessionFile, getRoleForSession } from './session-file.js';
import { getRoleProfile } from '../config.js';
/**
 * Detect the executor type based on environment.
 * Codex sets CODEX_HOME or runs from ~/.codex
 */
export function detectExecutorType() {
    if (process.env.CODEX_HOME ||
        process.env.CODEX_CI ||
        process.env.CODEX_MANAGED_BY_NPM ||
        process.env.HOME?.includes('codex')) {
        return 'CODEX';
    }
    return 'CLAUDE_CODE';
}
/**
 * Discover the current session ID.
 *
 * Priority:
 * 1. VK_SESSION_ID env var (if VK ever adds this)
 * 2. Most recent session of same executor type (heuristic)
 */
export async function discoverSessionId(workspaceId) {
    // Check env var first (future VK enhancement)
    if (process.env.VK_SESSION_ID) {
        return process.env.VK_SESSION_ID;
    }
    // Fallback: find most recent session of our executor type
    const sessions = await client.getSessions(workspaceId);
    const executorType = detectExecutorType();
    const mySessions = sessions
        .filter(s => s.executor === executorType)
        .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
    if (mySessions.length === 0) {
        throw new Error(`No ${executorType} sessions found for workspace ${workspaceId}`);
    }
    // Most recent session of our type is likely us
    return mySessions[0].id;
}
/**
 * Get the full agent context from environment.
 */
export async function getAgentContext() {
    const workspaceId = process.env.VK_WORKSPACE_ID;
    if (!workspaceId) {
        throw new Error('VK_WORKSPACE_ID not set - not running in VK context');
    }
    const projectId = process.env.VK_PROJECT_ID ?? null;
    const projectName = process.env.VK_PROJECT_NAME ?? null;
    const taskId = process.env.VK_TASK_ID ?? null;
    const workspaceBranch = process.env.VK_WORKSPACE_BRANCH ?? null;
    // Try to discover session ID
    let sessionId = null;
    try {
        sessionId = await discoverSessionId(workspaceId);
    }
    catch {
        // Session discovery failed, leave as null
    }
    // Try to get role from session file
    let role = null;
    if (sessionId) {
        try {
            role = getRoleForSession(workspaceId, sessionId);
        }
        catch {
            // Session file read failed, leave as null
        }
    }
    return {
        projectId,
        projectName,
        taskId,
        workspaceId,
        workspaceBranch,
        sessionId,
        role,
    };
}
/**
 * Get session for a target role.
 * This is used by `vibe-agent send` to route messages.
 *
 * Returns the registered session for the role, or null if not found.
 * Caller is responsible for creating a new session if null.
 */
export async function getSessionForRole(workspaceId, targetRole) {
    // Check session file for registered role
    try {
        const sessionFile = readSessionFile(workspaceId);
        const sessionId = Object.entries(sessionFile).find(([_, r]) => r === targetRole)?.[0];
        if (sessionId) {
            try {
                return await client.getSession(sessionId);
            }
            catch {
                // Session may have been deleted, return null
                return null;
            }
        }
    }
    catch {
        // Session file read failed, return null
        return null;
    }
    return null;
}
/**
 * Map target role to executor type.
 * Uses ROLE_PROFILES to determine the executor for the base role.
 * Handles numbered roles (e.g., reviewer-2) by extracting the base role.
 */
export function roleToExecutor(role) {
    const profile = getRoleProfile(role);
    return profile.executor;
}
