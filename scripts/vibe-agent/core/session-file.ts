// Session File Storage - manages role mappings in .vibe-sessions-{workspace_id}.json

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { AgentRole } from '../config.js';
import type { SessionFile } from '../types.js';

/**
 * Centralized directory for workspace session files.
 * Stored outside of worktrees to avoid being cleaned up.
 */
export const WORKSPACE_DATA_DIR = path.join(os.homedir(), 'repos', 'WORKSPACE_DATA');

/**
 * Ensure the workspace data directory exists.
 */
export function ensureWorkspaceDataDir(): void {
  if (!fs.existsSync(WORKSPACE_DATA_DIR)) {
    fs.mkdirSync(WORKSPACE_DATA_DIR, { recursive: true });
  }
}

/**
 * Find the worktree root directory from the current working directory.
 * The worktree root is the directory directly under /worktrees/.
 *
 * Example: /var/tmp/vibe-kanban/worktrees/6813-pm-for-songdrive/project-manager
 *       -> /var/tmp/vibe-kanban/worktrees/6813-pm-for-songdrive
 */
export function findWorktreeRoot(cwd: string): string {
  const worktreesIdx = cwd.indexOf('/worktrees/');
  if (worktreesIdx === -1) {
    throw new Error('Not inside a VK worktree (path does not contain /worktrees/)');
  }
  const afterWorktrees = cwd.slice(worktreesIdx + '/worktrees/'.length);
  const worktreeName = afterWorktrees.split('/')[0];
  return cwd.slice(0, worktreesIdx + '/worktrees/'.length + worktreeName.length);
}

/**
 * Get the path to the session file for a workspace.
 * Stored in ~/repos/WORKSPACE_DATA to persist across worktree cleanups.
 * Uses the full workspace UUID to prevent collisions.
 */
export function getSessionFilePath(workspaceId: string): string {
  return path.join(WORKSPACE_DATA_DIR, `.vibe-sessions-${workspaceId}.json`);
}

/**
 * Read the session file for a workspace.
 * Returns empty object if file doesn't exist.
 */
export function readSessionFile(workspaceId: string): SessionFile {
  const filePath = getSessionFilePath(workspaceId);
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    return JSON.parse(content) as SessionFile;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return {}; // File doesn't exist yet
    }
    throw err;
  }
}

/**
 * Write the session file for a workspace.
 * Uses atomic write (temp + rename) to prevent corruption.
 */
export function writeSessionFile(workspaceId: string, data: SessionFile): void {
  ensureWorkspaceDataDir();
  const filePath = getSessionFilePath(workspaceId);
  const tempPath = `${filePath}.tmp.${process.pid}`;
  fs.writeFileSync(tempPath, JSON.stringify(data, null, 2));
  fs.renameSync(tempPath, filePath);
}

/**
 * Find the session ID for a given role in a workspace.
 */
export function findSessionByRole(workspaceId: string, role: AgentRole): string | null {
  const sessionFile = readSessionFile(workspaceId);
  const entry = Object.entries(sessionFile).find(([_, r]) => r === role);
  return entry ? entry[0] : null;
}

/**
 * Get the role for a session ID.
 */
export function getRoleForSession(workspaceId: string, sessionId: string): AgentRole | null {
  const sessionFile = readSessionFile(workspaceId);
  return sessionFile[sessionId] ?? null;
}

/**
 * Register a session with a role.
 * Enforces: one role per session.
 * Multiple sessions can have the same role (e.g., reviewer, reviewer-2).
 * If the same role is registered again, the old session is replaced.
 */
export function registerSession(
  workspaceId: string,
  sessionId: string,
  role: AgentRole
): void {
  const sessionFile = readSessionFile(workspaceId);

  // Remove any existing mapping for this session ID (one role per session)
  if (sessionFile[sessionId]) {
    delete sessionFile[sessionId];
  }

  // Remove any existing session with the exact same role string
  // (e.g., re-registering "reviewer-2" replaces the old "reviewer-2")
  for (const [sid, r] of Object.entries(sessionFile)) {
    if (r === role) {
      delete sessionFile[sid];
    }
  }

  // Register
  sessionFile[sessionId] = role;
  writeSessionFile(workspaceId, sessionFile);
}

/**
 * Remove a session from the session file.
 */
export function unregisterSession(workspaceId: string, sessionId: string): void {
  const sessionFile = readSessionFile(workspaceId);
  delete sessionFile[sessionId];
  writeSessionFile(workspaceId, sessionFile);
}
