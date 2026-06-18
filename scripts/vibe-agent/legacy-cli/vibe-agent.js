#!/usr/bin/env node
// vibe-agent CLI - Agent communication for Vibe Kanban
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execFileSync, spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { client } from '../core/client.js';
import { WORKSPACE_DATA_DIR, ensureWorkspaceDataDir, registerSession, readSessionFile, } from '../core/session-file.js';
import { getAgentContext, getSessionForRole, roleToExecutor, } from '../core/context.js';
import { BASE_ROLES, isValidRole } from '../config.js';
// Message helpers
export function buildSendPrompt(message) {
    return message;
}
export const REQUEST_REVIEW_PROMPT = `Review the code on this branch thoroughly. Come back with concerns and actionable steps to resolve them. List pros and cons of each fix strategy.

In the conclusion of the whole response, list your recommendations for each concern succinctly. In a way where there is enough information that I can just read the ending and understand everything that I need to process, while the rest of the message is detailed and fully reasoned.`;
export function parseRequestReviewArgs(args = []) {
    let reviewerRole = 'reviewer';
    const sendFlags = [];
    const extraInstructionParts = [];
    for (let i = 0; i < args.length; i++) {
        const arg = args[i];
        if (arg === '--json') {
            sendFlags.push(arg);
            continue;
        }
        if (arg === '--timeout' || arg === '--timeout-ms') {
            const value = requireFlagValue(args, i, arg);
            sendFlags.push(arg, value);
            i++;
            continue;
        }
        if (arg.startsWith('--timeout=') || arg.startsWith('--timeout-ms=')) {
            sendFlags.push(arg);
            continue;
        }
        if (arg === '--reviewer') {
            reviewerRole = requireFlagValue(args, i, arg);
            i++;
            continue;
        }
        if (arg.startsWith('--reviewer=')) {
            reviewerRole = arg.slice('--reviewer='.length);
            continue;
        }
        extraInstructionParts.push(arg);
    }
    return {
        reviewerRole,
        extraInstructions: extraInstructionParts.join(' ').trim(),
        sendFlags,
    };
}
export function buildRequestReviewPrompt(extraInstructions = '') {
    const trimmed = extraInstructions.trim();
    if (!trimmed)
        return REQUEST_REVIEW_PROMPT;
    return `${REQUEST_REVIEW_PROMPT}

Additional review instructions:
${trimmed}`;
}
export function buildRequestReviewArgs(args = []) {
    const parsed = parseRequestReviewArgs(args);
    return ['--respond', parsed.reviewerRole, buildRequestReviewPrompt(parsed.extraInstructions), ...parsed.sendFlags];
}
export function parseSendArgs(args) {
    let jsonOutput = false;
    let respond = false;
    let timeoutMs;
    const positionalArgs = [];
    for (let i = 0; i < args.length; i++) {
        const arg = args[i];
        if (arg === '--json') {
            jsonOutput = true;
            continue;
        }
        if (arg === '--respond') {
            respond = true;
            continue;
        }
        if (arg === '--timeout' || arg === '--timeout-ms') {
            const value = requireFlagValue(args, i, arg);
            timeoutMs = arg === '--timeout-ms' ? parseTimeoutMs(value, 'ms') : parseTimeoutMs(value);
            i++;
            continue;
        }
        if (arg.startsWith('--timeout=')) {
            timeoutMs = parseTimeoutMs(arg.slice('--timeout='.length));
            continue;
        }
        if (arg.startsWith('--timeout-ms=')) {
            timeoutMs = parseTimeoutMs(arg.slice('--timeout-ms='.length), 'ms');
            continue;
        }
        positionalArgs.push(arg);
    }
    const [targetRoleArg, message, ...unexpectedArgs] = positionalArgs;
    if (unexpectedArgs.length > 0) {
        throw new Error('Too many positional arguments for send. Quote the message as a single argument.');
    }
    const parsed = {
        targetRoleArg: targetRoleArg ?? '',
        message: message ?? '',
        jsonOutput,
        respond,
    };
    if (timeoutMs !== undefined)
        parsed.timeoutMs = timeoutMs;
    return parsed;
}
function isStopHookFeedbackEntry(entry) {
    const entryType = entry?.content?.entry_type?.type;
    const content = entry?.content?.content;
    return entryType === 'system_message' && typeof content === 'string' && content.startsWith('Stop hook feedback:');
}
function collectAssistantMessages(entries, startInclusive, endExclusive) {
    const messages = [];
    for (let i = startInclusive; i < endExclusive; i++) {
        const entry = entries[i];
        if (!entry)
            continue;
        const entryType = entry.content?.entry_type?.type;
        const content = entry.content?.content;
        if (entryType === 'assistant_message' && typeof content === 'string' && content.trim()) {
            const trimmed = content.trim();
            if (messages[messages.length - 1] !== trimmed) {
                messages.push(trimmed);
            }
        }
    }
    return messages;
}
function joinAssistantMessages(messages) {
    return messages.length > 0 ? messages.join('\n\n') : null;
}
export function extractFinalAssistantMessage(entries) {
    const stopHookIndex = entries.findIndex(isStopHookFeedbackEntry);
    if (stopHookIndex === -1) {
        return joinAssistantMessages(collectAssistantMessages(entries, 0, entries.length));
    }
    const preHookMessage = joinAssistantMessages(collectAssistantMessages(entries, 0, stopHookIndex));
    const postHookMessage = joinAssistantMessages(collectAssistantMessages(entries, stopHookIndex + 1, entries.length));
    if (preHookMessage && postHookMessage) {
        if (preHookMessage === postHookMessage)
            return preHookMessage;
        return [
            'Pre-hook response:',
            preHookMessage,
            '',
            'Post-hook response:',
            postHookMessage,
        ].join('\n');
    }
    return preHookMessage ?? postHookMessage;
}
export function formatRespondMessage(role, response) {
    return `Response from ${role}:

${response}`;
}
export function buildNoAssistantResponseLogMessage(processId) {
    return `No final assistant response found for process ${processId}; not sending a response.`;
}
const TERMINAL_PROCESS_STATUSES = new Set(['completed', 'failed', 'killed']);
const CALLBACK_IDLE_POLL_INTERVAL_MS = 2_000;
const REQUEST_REVIEW_QUIET_WINDOW_MS = 10_000;
export function hasActiveSessionTurn(processes) {
    return processes.some((process) => {
        if (process.dropped)
            return false;
        if (TERMINAL_PROCESS_STATUSES.has(process.status))
            return false;
        return process.completed_at == null;
    });
}
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}
async function waitForSessionIdle(sessionId, outputFile, label = 'Recipient') {
    let loggedWait = false;
    while (true) {
        const processes = await client.getSessionProcesses(sessionId);
        if (!hasActiveSessionTurn(processes)) {
            if (loggedWait) {
                fs.appendFileSync(outputFile, `${new Date().toISOString()} ${label} session is idle.\n`);
            }
            return;
        }
        if (!loggedWait) {
            fs.appendFileSync(outputFile, `${new Date().toISOString()} ${label} session ${sessionId} is already in a turn; waiting.\n`);
            loggedWait = true;
        }
        await sleep(CALLBACK_IDLE_POLL_INTERVAL_MS);
    }
}
async function waitForSessionQuiet(sessionId, outputFile, quietWindowMs = REQUEST_REVIEW_QUIET_WINDOW_MS) {
    while (true) {
        await waitForSessionIdle(sessionId, outputFile, 'Requester');
        fs.appendFileSync(outputFile, `${new Date().toISOString()} Requester session is idle; waiting ${quietWindowMs}ms for immediate follow-up turns such as auto-commit.\n`);
        await sleep(quietWindowMs);
        const processes = await client.getSessionProcesses(sessionId);
        if (!hasActiveSessionTurn(processes)) {
            fs.appendFileSync(outputFile, `${new Date().toISOString()} Requester session remained idle; proceeding.\n`);
            return;
        }
        fs.appendFileSync(outputFile, `${new Date().toISOString()} Requester session became active again during quiet window; waiting for it to finish.\n`);
    }
}
function parseTimeoutMs(value, defaultUnit = null) {
    const normalizedValue = value.trim();
    const match = normalizedValue.match(/^(\d+(?:\.\d+)?)(ms|s|m|h)?$/i);
    if (!match) {
        throw new Error(`Invalid timeout: ${value}. Use milliseconds or a duration like 30s, 10m, or 1h.`);
    }
    const amount = Number(match[1]);
    const unit = (match[2] ?? defaultUnit ?? 'ms').toLowerCase();
    const multiplier = unit === 'h' ? 60 * 60 * 1000 : unit === 'm' ? 60 * 1000 : unit === 's' ? 1000 : 1;
    const timeoutMs = Math.round(amount * multiplier);
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) {
        throw new Error(`Invalid timeout: ${value}. Timeout must be greater than 0ms.`);
    }
    return timeoutMs;
}
function requireFlagValue(args, index, flag) {
    const value = args[index + 1];
    if (!value || value.startsWith('--')) {
        throw new Error(`${flag} requires a value`);
    }
    return value;
}
export function parseCallbackArgs(args) {
    let jsonOutput = false;
    let timeoutMs;
    let completionMessage;
    const positionalArgs = [];
    for (let i = 0; i < args.length; i++) {
        const arg = args[i];
        if (arg === '--json') {
            jsonOutput = true;
            continue;
        }
        if (arg === '--timeout' || arg === '--timeout-ms') {
            const value = requireFlagValue(args, i, arg);
            timeoutMs = arg === '--timeout-ms' ? parseTimeoutMs(value, 'ms') : parseTimeoutMs(value);
            i++;
            continue;
        }
        if (arg.startsWith('--timeout=')) {
            timeoutMs = parseTimeoutMs(arg.slice('--timeout='.length));
            continue;
        }
        if (arg.startsWith('--timeout-ms=')) {
            timeoutMs = parseTimeoutMs(arg.slice('--timeout-ms='.length), 'ms');
            continue;
        }
        if (arg === '--message' || arg === '-m') {
            completionMessage = requireFlagValue(args, i, arg);
            i++;
            continue;
        }
        if (arg.startsWith('--message=')) {
            completionMessage = arg.slice('--message='.length);
            continue;
        }
        positionalArgs.push(arg);
    }
    const [command, legacyCompletionMessage, ...unexpectedArgs] = positionalArgs;
    if (unexpectedArgs.length > 0) {
        throw new Error('Too many positional arguments. Use --message for the callback completion message.');
    }
    if (completionMessage === undefined && legacyCompletionMessage !== undefined) {
        completionMessage = legacyCompletionMessage;
    }
    const parsed = {
        command: command?.trim() ?? '',
        jsonOutput,
    };
    if (completionMessage !== undefined)
        parsed.completionMessage = completionMessage;
    if (timeoutMs !== undefined)
        parsed.timeoutMs = timeoutMs;
    return parsed;
}
function parsePositiveInteger(value, flag) {
    const parsed = Number.parseInt(value, 10);
    if (!Number.isSafeInteger(parsed) || parsed <= 0) {
        throw new Error(`${flag} must be a positive integer`);
    }
    return parsed;
}
export function parseFullSummaryArgs(args) {
    const parsed = {
        sessionIds: [],
        all: false,
        noAdvance: false,
        jsonOutput: false,
        includeRunning: false,
        limitTurns: 200,
        limitSessions: 50,
    };
    for (let i = 0; i < args.length; i++) {
        const arg = args[i];
        if (arg === '--json') {
            parsed.jsonOutput = true;
            continue;
        }
        if (arg === '--all') {
            parsed.all = true;
            continue;
        }
        if (arg === '--no-advance') {
            parsed.noAdvance = true;
            continue;
        }
        if (arg === '--include-running') {
            parsed.includeRunning = true;
            continue;
        }
        if (arg === '--session' || arg === '-s') {
            parsed.sessionIds.push(requireFlagValue(args, i, arg));
            i++;
            continue;
        }
        if (arg.startsWith('--session=')) {
            parsed.sessionIds.push(arg.slice('--session='.length));
            continue;
        }
        if (arg === '--limit-turns' || arg === '--limit-messages') {
            parsed.limitTurns = parsePositiveInteger(requireFlagValue(args, i, arg), arg);
            i++;
            continue;
        }
        if (arg.startsWith('--limit-turns=')) {
            parsed.limitTurns = parsePositiveInteger(arg.slice('--limit-turns='.length), '--limit-turns');
            continue;
        }
        if (arg.startsWith('--limit-messages=')) {
            parsed.limitTurns = parsePositiveInteger(arg.slice('--limit-messages='.length), '--limit-messages');
            continue;
        }
        if (arg === '--limit-sessions') {
            parsed.limitSessions = parsePositiveInteger(requireFlagValue(args, i, arg), arg);
            i++;
            continue;
        }
        if (arg.startsWith('--limit-sessions=')) {
            parsed.limitSessions = parsePositiveInteger(arg.slice('--limit-sessions='.length), '--limit-sessions');
            continue;
        }
        throw new Error(`Unknown full_summary option: ${arg}`);
    }
    parsed.sessionIds = [...new Set(parsed.sessionIds)];
    return parsed;
}
function entryType(entry) {
    return entry?.content?.entry_type?.type;
}
function entryText(entry) {
    const content = entry?.content?.content;
    if (typeof content === 'string')
        return content;
    if (content == null)
        return null;
    return JSON.stringify(content);
}
function isLikelyReadToolCall(content) {
    return /\b(cat|sed|grep|rg|find|ls|head|tail|git\s+(status|diff|show|log|ls-files)|pwd|tree)\b/.test(content);
}
function isLikelyWriteToolCall(content) {
    if (/^[\w./-]+\.(ts|tsx|js|jsx|json|md|cjs|mjs|css|html|yml|yaml|sh)$/.test(content.trim())) {
        return true;
    }
    return /\b(apply_patch|tee|touch|mkdir|rm|mv|cp|perl\s+-pi|python|node|git\s+(add|commit|checkout|merge|rebase|reset|clean)|bd\s+(create|update|close))\b|(^|[^>])>\s*[\w./-]+/.test(content);
}
function isLikelyWebSearchToolCall(content) {
    return /search_query|image_query|web\.run|browser\.search|google|bing/i.test(content);
}
export function summarizeToolCalls(entries) {
    const summary = { reads: 0, writes: 0, webSearches: 0, other: 0, total: 0 };
    for (const entry of entries) {
        if (entryType(entry) !== 'tool_use')
            continue;
        const content = entryText(entry) ?? '';
        summary.total++;
        if (isLikelyWebSearchToolCall(content)) {
            summary.webSearches++;
        }
        else if (isLikelyWriteToolCall(content)) {
            summary.writes++;
        }
        else if (isLikelyReadToolCall(content)) {
            summary.reads++;
        }
        else {
            summary.other++;
        }
    }
    return summary;
}
export function summarizeTurnConversation(entries) {
    const firstToolIndex = entries.findIndex(entry => entryType(entry) === 'tool_use');
    const lastToolIndex = (() => {
        for (let i = entries.length - 1; i >= 0; i--) {
            if (entryType(entries[i]) === 'tool_use')
                return i;
        }
        return -1;
    })();
    if (firstToolIndex === -1) {
        return {
            agentPreResponse: null,
            agentResponse: joinAssistantMessages(collectAssistantMessages(entries, 0, entries.length)),
            toolCalls: summarizeToolCalls(entries),
        };
    }
    return {
        agentPreResponse: joinAssistantMessages(collectAssistantMessages(entries, 0, firstToolIndex)),
        agentResponse: joinAssistantMessages(collectAssistantMessages(entries, lastToolIndex + 1, entries.length)),
        toolCalls: summarizeToolCalls(entries),
    };
}
function extractInitialUserMessage(entries) {
    for (const entry of entries) {
        if (entryType(entry) !== 'user_message')
            continue;
        const text = entryText(entry);
        if (text?.trim())
            return text.trim();
    }
    return null;
}
export function summarizeCommitNumstat(hash, subject, numstat) {
    const files = [];
    for (const line of numstat.split('\n')) {
        if (!line.trim())
            continue;
        const [addedRaw, deletedRaw, filePath] = line.split('\t');
        if (!filePath)
            continue;
        const binary = addedRaw === '-' || deletedRaw === '-';
        files.push({
            path: filePath,
            added: binary ? 0 : Number.parseInt(addedRaw, 10) || 0,
            deleted: binary ? 0 : Number.parseInt(deletedRaw, 10) || 0,
            binary,
        });
    }
    return {
        hash,
        subject,
        filesChanged: files.length,
        linesAdded: files.reduce((sum, file) => sum + file.added, 0),
        linesDeleted: files.reduce((sum, file) => sum + file.deleted, 0),
        files,
    };
}
function extractPromptFromProcess(process) {
    const action = process.executor_action;
    const prompt = action?.typ?.prompt ?? action?.prompt;
    return typeof prompt === 'string' ? prompt : null;
}
function extractWorkingDirFromProcess(process) {
    const action = process.executor_action;
    const workingDir = action?.typ?.working_dir ?? action?.working_dir;
    return typeof workingDir === 'string' && workingDir.trim() ? workingDir : null;
}
function isGitRepository(candidate) {
    try {
        execFileSync('git', ['rev-parse', '--show-toplevel'], {
            cwd: candidate,
            encoding: 'utf8',
            stdio: ['ignore', 'ignore', 'ignore'],
        });
        return true;
    }
    catch {
        return false;
    }
}
export function resolveProcessWorkingDirectory(process, workspaceId, invocationCwd) {
    const workingDir = extractWorkingDirFromProcess(process);
    if (!workingDir) {
        return null;
    }
    const candidates = [];
    if (path.isAbsolute(workingDir)) {
        candidates.push(workingDir);
    }
    else {
        candidates.push(path.resolve(invocationCwd, workingDir), path.resolve(path.dirname(invocationCwd), workingDir));
        const worktreesRoot = '/var/tmp/vibe-kanban/worktrees';
        const workspacePrefix = workspaceId.slice(0, 4);
        try {
            for (const entry of fs.readdirSync(worktreesRoot, { withFileTypes: true })) {
                if (!entry.isDirectory() || !entry.name.startsWith(`${workspacePrefix}-`))
                    continue;
                candidates.push(path.join(worktreesRoot, entry.name, workingDir));
            }
        }
        catch {
            // The VK worktree root is an optional convenience, not a hard dependency.
        }
        candidates.push(path.join(os.homedir(), 'repos', workingDir));
    }
    const seen = new Set();
    for (const candidate of candidates) {
        const resolved = path.resolve(candidate);
        if (seen.has(resolved))
            continue;
        seen.add(resolved);
        if (fs.existsSync(resolved) && isGitRepository(resolved)) {
            return resolved;
        }
    }
    return null;
}
function truncateText(value, maxChars) {
    if (value == null || value.length <= maxChars)
        return value;
    return `${value.slice(0, maxChars)}\n\n[truncated ${value.length - maxChars} chars]`;
}
function getFullSummaryStatePath(workspaceId) {
    const overrideDir = process.env.VIBE_AGENT_FULL_SUMMARY_STATE_DIR;
    if (overrideDir) {
        fs.mkdirSync(overrideDir, { recursive: true });
        return path.join(overrideDir, `.vibe-full-summary-pager-${workspaceId}.json`);
    }
    ensureWorkspaceDataDir();
    return path.join(WORKSPACE_DATA_DIR, `.vibe-full-summary-pager-${workspaceId}.json`);
}
function getLegacyFullSummaryStatePaths() {
    const overrideDir = process.env.VIBE_AGENT_FULL_SUMMARY_STATE_DIR;
    if (overrideDir) {
        return [path.join(overrideDir, 'pager-state.json')];
    }
    return [
        path.join(WORKSPACE_DATA_DIR, '.vibe-agent-full-summary-pager-state.json'),
        path.join(os.homedir(), '.vibe-agent', 'full-summary', 'pager-state.json'),
    ];
}
export function normalizeFullSummaryStateForWorkspace(rawState, workspaceId) {
    const state = rawState;
    if (!state || state.version !== 1)
        return null;
    if (state.readers && typeof state.readers === 'object') {
        return {
            version: 1,
            readers: state.readers,
            excludedSessionIds: Array.isArray(state.excludedSessionIds) ? state.excludedSessionIds : [],
        };
    }
    const legacyReaders = state.workspaces?.[workspaceId]?.readers;
    if (legacyReaders && typeof legacyReaders === 'object') {
        return { version: 1, readers: legacyReaders, excludedSessionIds: [] };
    }
    return null;
}
function readFullSummaryState(workspaceId) {
    const candidatePaths = [
        getFullSummaryStatePath(workspaceId),
        ...getLegacyFullSummaryStatePaths(),
    ];
    for (const candidatePath of candidatePaths) {
        try {
            const raw = fs.readFileSync(candidatePath, 'utf8');
            const state = normalizeFullSummaryStateForWorkspace(JSON.parse(raw), workspaceId);
            if (state)
                return state;
        }
        catch {
            // Missing or corrupt state should not block summaries.
        }
    }
    return { version: 1, readers: {}, excludedSessionIds: [] };
}
function writeFullSummaryState(workspaceId, state) {
    const filePath = getFullSummaryStatePath(workspaceId);
    const tempPath = `${filePath}.tmp.${process.pid}`;
    fs.writeFileSync(tempPath, `${JSON.stringify(state, null, 2)}\n`);
    fs.renameSync(tempPath, filePath);
}
function getReaderId() {
    return process.env.VK_SESSION_ID || 'unknown-session';
}
function findWorkspaceNameInTrackingFiles(workspaceId) {
    const trackingDir = path.join(globalThis.process.cwd(), 'tracking');
    try {
        for (const entry of fs.readdirSync(trackingDir, { withFileTypes: true })) {
            if (!entry.isFile() || !entry.name.endsWith('.jsonl'))
                continue;
            const filePath = path.join(trackingDir, entry.name);
            for (const line of fs.readFileSync(filePath, 'utf8').split('\n')) {
                if (!line.includes(workspaceId))
                    continue;
                try {
                    const record = JSON.parse(line);
                    if (record.workspace_id === workspaceId) {
                        return record.title || record.branch || null;
                    }
                }
                catch {
                    // Ignore malformed tracking lines.
                }
            }
        }
    }
    catch {
        // Tracking files are optional.
    }
    return null;
}
function findWorkspaceNameFromWorktree(workspaceId) {
    const worktreesRoot = '/var/tmp/vibe-kanban/worktrees';
    const workspacePrefix = workspaceId.slice(0, 4);
    try {
        const entry = fs.readdirSync(worktreesRoot, { withFileTypes: true })
            .find(dirent => dirent.isDirectory() && dirent.name.startsWith(`${workspacePrefix}-`));
        return entry?.name ?? null;
    }
    catch {
        return null;
    }
}
function getWorkspaceDisplayName(workspaceId) {
    return findWorkspaceNameInTrackingFiles(workspaceId)
        ?? findWorkspaceNameFromWorktree(workspaceId)
        ?? null;
}
function getCommitSummariesBetween(startIso, endIso, cwd = globalThis.process.cwd()) {
    try {
        const endDate = endIso ? new Date(new Date(endIso).getTime() + 5 * 60 * 1000) : new Date();
        const logOutput = execFileSync('git', [
            'log',
            '--all',
            `--since=${startIso}`,
            `--until=${endDate.toISOString()}`,
            '--pretty=format:%H%x00%s',
        ], { cwd, encoding: 'utf8' }).trim();
        if (!logOutput)
            return [];
        return logOutput.split('\n').filter(Boolean).map(line => {
            const [hash, subject = ''] = line.split('\0');
            const numstat = execFileSync('git', ['show', '--numstat', '--format=', hash], { cwd, encoding: 'utf8' });
            return summarizeCommitNumstat(hash.slice(0, 12), subject, numstat);
        });
    }
    catch {
        return [];
    }
}
function extractCommitHashes(text) {
    if (!text)
        return [];
    const hashes = [];
    for (const line of text.split('\n')) {
        if (!/\bcommit\b/i.test(line))
            continue;
        hashes.push(...Array.from(line.matchAll(/\b[0-9a-f]{7,40}\b/gi), match => match[0]));
    }
    return [...new Set(hashes)];
}
function getCommitSummary(hash, cwd) {
    try {
        const fullHash = execFileSync('git', ['rev-parse', hash], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
        const subject = execFileSync('git', ['show', '-s', '--format=%s', fullHash], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
        const numstat = execFileSync('git', ['show', '--numstat', '--format=', fullHash], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
        return summarizeCommitNumstat(fullHash.slice(0, 12), subject, numstat);
    }
    catch {
        return null;
    }
}
function getCommitSummariesForTurn(process, agentResponse, toolCalls, cwd) {
    const mentionedHashes = extractCommitHashes(agentResponse);
    if (mentionedHashes.length > 0) {
        return mentionedHashes
            .map(hash => getCommitSummary(hash, cwd))
            .filter((summary) => summary !== null);
    }
    if (toolCalls.writes === 0) {
        return [];
    }
    return getCommitSummariesBetween(process.created_at, process.completed_at, cwd);
}
async function callback(args) {
    let parsed;
    try {
        parsed = parseCallbackArgs(args);
    }
    catch (err) {
        console.error(`Error: ${err.message}`);
        console.error('Usage: vibe-agent callback "command to run" [--message "completion message"] [--timeout <duration>] [--json]');
        process.exit(1);
    }
    const { command: commandToRun, completionMessage, jsonOutput, timeoutMs } = parsed;
    if (!commandToRun) {
        console.error('Usage: vibe-agent callback "command to run" [--message "completion message"] [--timeout <duration>] [--json]');
        process.exit(1);
    }
    try {
        const ctx = await getAgentContext();
        const sessionId = process.env.VK_SESSION_ID ?? ctx.sessionId;
        if (!sessionId) {
            throw new Error('Could not determine invoking session; VK_SESSION_ID was not set and session discovery failed');
        }
        const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vibe-agent-callback-'));
        const outputFile = path.join(tempDir, 'output.log');
        fs.closeSync(fs.openSync(outputFile, 'w'));
        const payload = {
            command: commandToRun,
            completionMessage,
            outputFile,
            sessionId,
            cwd: process.cwd(),
            timeoutMs,
        };
        const runner = spawn(process.execPath, [fileURLToPath(import.meta.url), '__callback-runner', JSON.stringify(payload)], {
            detached: true,
            stdio: 'ignore',
            env: process.env,
            cwd: process.cwd(),
        });
        runner.unref();
        if (jsonOutput) {
            console.log(JSON.stringify({
                status: 'started',
                command: commandToRun,
                completion_message: completionMessage ?? null,
                output_file: outputFile,
                session_id: sessionId,
                runner_pid: runner.pid,
                timeout_ms: timeoutMs ?? null,
            }, null, 2));
        }
        else {
            console.log('Callback command started in the background.');
            console.log(`Command:     ${commandToRun}`);
            if (completionMessage) {
                console.log(`Message:     ${completionMessage}`);
            }
            console.log(`Output file: ${outputFile}`);
            console.log(`Session:     ${sessionId}`);
            if (timeoutMs) {
                console.log(`Timeout:     ${timeoutMs}ms`);
            }
            if (runner.pid) {
                console.log(`Runner PID:  ${runner.pid}`);
            }
        }
    }
    catch (err) {
        console.error(`Error: ${err.message}`);
        process.exit(1);
    }
}
async function callbackRunner(args) {
    const payloadRaw = args[0];
    if (!payloadRaw) {
        console.error('Usage: vibe-agent __callback-runner <payload-json>');
        process.exit(1);
    }
    const payload = JSON.parse(payloadRaw);
    const startedAt = new Date();
    let exitCode = null;
    let signal = null;
    let timedOut = false;
    try {
        await new Promise((resolve) => {
            const fd = fs.openSync(payload.outputFile, 'a');
            let settled = false;
            let killTimer = null;
            const child = spawn(payload.command, {
                shell: true,
                cwd: payload.cwd,
                env: process.env,
                stdio: ['ignore', fd, fd],
                detached: true,
            });
            const closeFd = () => {
                try {
                    fs.closeSync(fd);
                }
                catch {
                    // Ignore double-close races between error/close and timeout cleanup.
                }
            };
            const finish = () => {
                if (settled)
                    return;
                settled = true;
                if (killTimer)
                    clearTimeout(killTimer);
                closeFd();
                resolve();
            };
            let timeoutTimer = null;
            if (payload.timeoutMs) {
                timeoutTimer = setTimeout(() => {
                    timedOut = true;
                    fs.appendFileSync(payload.outputFile, `\n[vibe-agent callback timed out after ${payload.timeoutMs}ms; terminating command]\n`);
                    if (child.pid) {
                        try {
                            process.kill(-child.pid, 'SIGTERM');
                        }
                        catch {
                            child.kill('SIGTERM');
                        }
                        killTimer = setTimeout(() => {
                            if (child.pid) {
                                try {
                                    process.kill(-child.pid, 'SIGKILL');
                                }
                                catch {
                                    child.kill('SIGKILL');
                                }
                            }
                        }, 5000);
                    }
                }, payload.timeoutMs);
            }
            child.on('error', (err) => {
                if (timeoutTimer)
                    clearTimeout(timeoutTimer);
                fs.appendFileSync(payload.outputFile, `\n[vibe-agent callback failed to start command: ${err.message}]\n`);
                exitCode = 1;
                finish();
            });
            child.on('close', (code, sig) => {
                if (timeoutTimer)
                    clearTimeout(timeoutTimer);
                exitCode = code;
                signal = sig;
                finish();
            });
        });
    }
    catch (err) {
        fs.appendFileSync(payload.outputFile, `\n[vibe-agent callback runner error: ${err.message}]\n`);
        exitCode = 1;
    }
    const finishedAt = new Date();
    const durationMs = finishedAt.getTime() - startedAt.getTime();
    const status = timedOut ? 'timed out' : exitCode === 0 ? 'completed successfully' : 'finished';
    const exitSummary = timedOut
        ? `timed out after ${payload.timeoutMs}ms`
        : signal ? `signal ${signal}` : `exit code ${exitCode ?? 'unknown'}`;
    const defaultMessage = [
        `Callback command ${status}: ${payload.command}`,
        '',
        `Result: ${exitSummary}`,
        `Duration: ${durationMs}ms`,
        ...(payload.timeoutMs ? [`Timeout: ${payload.timeoutMs}ms`] : []),
        `Output file: ${payload.outputFile}`,
        '',
        'The output file contains stdout and stderr from the command.',
        '',
        'if you intend to run the command again in the background, please use `vibe-agent callback` again.',
    ].join('\n');
    const message = payload.completionMessage ?? defaultMessage;
    try {
        await waitForSessionIdle(payload.sessionId, payload.outputFile);
        const session = await client.getSession(payload.sessionId);
        await client.sendMessage(payload.sessionId, {
            prompt: message,
            executor_config: {
                executor: session.executor,
            },
            retry_process_id: null,
            force_when_dirty: null,
            perform_git_reset: null,
        });
    }
    catch (err) {
        fs.appendFileSync(payload.outputFile, `\n[vibe-agent callback failed to send completion message: ${err.message}]\n`);
    }
}
async function sendRespondMessage(replySessionId, prompt) {
    const replySession = await client.getSession(replySessionId);
    await client.sendMessage(replySessionId, {
        prompt,
        executor_config: {
            executor: replySession.executor,
        },
        retry_process_id: null,
        force_when_dirty: null,
        perform_git_reset: null,
    });
}
async function respondRunner(args) {
    const payloadRaw = args[0];
    if (!payloadRaw) {
        console.error('Usage: vibe-agent __respond-runner <payload-json>');
        process.exit(1);
    }
    const payload = JSON.parse(payloadRaw);
    try {
        const entries = await client.fetchConversation(payload.processId, payload.timeoutMs);
        const response = extractFinalAssistantMessage(entries);
        if (!response) {
            fs.appendFileSync(payload.outputFile, `${new Date().toISOString()} ${buildNoAssistantResponseLogMessage(payload.processId)}\n`);
            return;
        }
        await sendRespondMessage(payload.replySessionId, formatRespondMessage(payload.targetRole, response));
    }
    catch (err) {
        const message = `vibe-agent send --respond failed while waiting for ${payload.targetRole}: ${err.message}`;
        try {
            await sendRespondMessage(payload.replySessionId, message);
        }
        catch (sendErr) {
            fs.appendFileSync(payload.outputFile, `${new Date().toISOString()} ${message}\nFailed to send failure response: ${sendErr.message}\n`);
        }
    }
}
async function requestReviewRunner(args) {
    const payloadRaw = args[0];
    if (!payloadRaw) {
        console.error('Usage: vibe-agent __request-review-runner <payload-json>');
        process.exit(1);
    }
    const payload = JSON.parse(payloadRaw);
    try {
        process.chdir(payload.cwd);
        fs.appendFileSync(payload.outputFile, `${new Date().toISOString()} Waiting for requester session ${payload.requesterSessionId} to finish current and immediate follow-up turns before sending request-review.\n`);
        await waitForSessionQuiet(payload.requesterSessionId, payload.outputFile, payload.quietWindowMs);
        fs.appendFileSync(payload.outputFile, `${new Date().toISOString()} Sending delayed request-review.\n`);
        await send(buildRequestReviewArgs(payload.requestReviewArgs));
        fs.appendFileSync(payload.outputFile, `${new Date().toISOString()} Delayed request-review sent.\n`);
    }
    catch (err) {
        fs.appendFileSync(payload.outputFile, `${new Date().toISOString()} Delayed request-review failed: ${err.message}\n`);
    }
}
export function buildRequestReviewScheduledMessage(outputFile, sessionId) {
    return [
        'Request review scheduled.',
        'It will be sent after this session finishes the current turn and remains briefly idle so any immediate auto-commit turn can complete.',
        `Session:     ${sessionId}`,
        `Output file: ${outputFile}`,
    ].join('\n');
}
async function whoami(args) {
    const jsonOutput = args.includes('--json');
    try {
        const ctx = await getAgentContext();
        if (jsonOutput) {
            console.log(JSON.stringify(ctx, null, 2));
        }
        else {
            console.log(`Task:      ${ctx.taskId ?? 'unknown'}`);
            console.log(`Workspace: ${ctx.workspaceId}`);
            console.log(`Role:      ${ctx.role ?? 'unregistered'}`);
            console.log(`Session:   ${ctx.sessionId ?? 'unknown'}`);
            if (ctx.projectName) {
                console.log(`Project:   ${ctx.projectName}`);
            }
            if (ctx.workspaceBranch) {
                console.log(`Branch:    ${ctx.workspaceBranch}`);
            }
        }
    }
    catch (err) {
        console.error(`Error: ${err.message}`);
        process.exit(1);
    }
}
async function ensureSessionName(sessionId, currentName, role) {
    if (currentName === role)
        return;
    await client.updateSession(sessionId, { name: role });
}
async function send(args) {
    let parsed;
    try {
        parsed = parseSendArgs(args);
    }
    catch (err) {
        console.error(`Error: ${err.message}`);
        console.error('Usage: vibe-agent send [--respond] <role> "<message>" [--timeout <duration>] [--json]');
        process.exit(1);
    }
    const { targetRoleArg, message, jsonOutput, respond, timeoutMs } = parsed;
    if (!targetRoleArg || !message) {
        console.error('Usage: vibe-agent send [--respond] <role> "<message>" [--timeout <duration>] [--json]');
        console.error(`Standard roles: ${BASE_ROLES.join(', ')} (or with suffix: reviewer-2, etc.), human`);
        console.error('Custom roles are also allowed (use CODEX by default)');
        process.exit(1);
    }
    // Special case: human routes to notification (not fully implemented)
    if (targetRoleArg === 'human') {
        console.error('Sending to human is not yet implemented (requires VK notification system)');
        process.exit(1);
    }
    if (!isValidRole(targetRoleArg)) {
        console.error(`Invalid role: ${targetRoleArg}`);
        console.error(`Standard roles: ${BASE_ROLES.join(', ')} (or with suffix: reviewer-2, etc.), human`);
        console.error('Custom roles are also allowed (use CODEX by default)');
        process.exit(1);
    }
    const targetRole = targetRoleArg;
    const workspaceId = process.env.VK_WORKSPACE_ID;
    if (!workspaceId) {
        console.error('Error: VK_WORKSPACE_ID not set - not running in VK context');
        process.exit(1);
    }
    try {
        const executor = roleToExecutor(targetRole);
        // Find existing session for target role
        let session = await getSessionForRole(workspaceId, targetRole);
        // Auto-create session if not found, or replace an existing role session whose executor no longer matches.
        if (!session || session.executor !== executor) {
            const previousSession = session;
            session = await client.createSession({
                workspace_id: workspaceId,
                executor,
                name: targetRole,
            });
            // Register the newly created session with the role
            registerSession(workspaceId, session.id, targetRole);
            if (!jsonOutput) {
                if (previousSession) {
                    console.log(`Created new ${executor} session for ${targetRole}: ${session.id} (replaced ${previousSession.executor} session ${previousSession.id})`);
                }
                else {
                    console.log(`Created new ${executor} session for ${targetRole}: ${session.id}`);
                }
            }
        }
        if (session.name !== targetRole) {
            try {
                await ensureSessionName(session.id, session.name, targetRole);
                session = { ...session, name: targetRole };
            }
            catch (err) {
                if (!jsonOutput) {
                    console.warn(`Warning: failed to name session ${session.id} as ${targetRole}: ${err.message}`);
                }
            }
        }
        // Send exactly the caller-provided message; do not prepend onboarding,
        // quick-reference, or response instructions.
        const finalMessage = buildSendPrompt(message);
        // Send message using the live follow-up API shape
        const result = await client.sendMessage(session.id, {
            prompt: finalMessage,
            executor_config: {
                executor: session.executor,
            },
            retry_process_id: null,
            force_when_dirty: null,
            perform_git_reset: null,
        });
        let respondRunnerPid;
        let replySessionId = null;
        let respondOutputFile = null;
        if (respond) {
            const ctx = await getAgentContext();
            replySessionId = process.env.VK_SESSION_ID ?? ctx.sessionId;
            if (!replySessionId) {
                throw new Error('Could not determine reply session; VK_SESSION_ID was not set and session discovery failed');
            }
            const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vibe-agent-respond-'));
            respondOutputFile = path.join(tempDir, 'output.log');
            fs.closeSync(fs.openSync(respondOutputFile, 'w'));
            const payload = {
                processId: result.id,
                replySessionId,
                targetRole,
                outputFile: respondOutputFile,
                ...(timeoutMs !== undefined ? { timeoutMs } : {}),
            };
            const runner = spawn(process.execPath, [fileURLToPath(import.meta.url), '__respond-runner', JSON.stringify(payload)], {
                detached: true,
                stdio: 'ignore',
                env: process.env,
                cwd: process.cwd(),
            });
            runner.unref();
            respondRunnerPid = runner.pid;
        }
        if (jsonOutput) {
            console.log(JSON.stringify({
                session_id: session.id,
                process_id: result.id,
                status: result.status,
                ...(respond ? {
                    respond_monitor_pid: respondRunnerPid ?? null,
                    reply_session_id: replySessionId,
                    respond_output_file: respondOutputFile,
                } : {}),
            }, null, 2));
        }
        else if (respond) {
            console.log(`Message sent to ${targetRole}; response will be routed back to this session when ready.`);
            console.log(`Session:      ${session.id}`);
            console.log(`Process:      ${result.id}`);
            console.log(`Status:       ${result.status}`);
            console.log(`Reply Session:${replySessionId ? ` ${replySessionId}` : ' (unknown)'}`);
            if (respondRunnerPid) {
                console.log(`Monitor PID:  ${respondRunnerPid}`);
            }
            if (respondOutputFile) {
                console.log(`Monitor Log:  ${respondOutputFile}`);
            }
        }
        else {
            console.log(`Message sent to ${targetRole}`);
            console.log(`Session:  ${session.id}`);
            console.log(`Process:  ${result.id}`);
            console.log(`Status:   ${result.status}`);
        }
    }
    catch (err) {
        console.error(`Error: ${err.message}`);
        process.exit(1);
    }
}
async function requestReview(args) {
    const jsonOutput = args.includes('--json');
    try {
        // Validate arguments before scheduling so invalid reviewer/timeout options fail immediately.
        buildRequestReviewArgs(args);
        const parsed = parseRequestReviewArgs(args);
        if (!isValidRole(parsed.reviewerRole)) {
            throw new Error(`Invalid reviewer role: ${parsed.reviewerRole}`);
        }
        const ctx = await getAgentContext();
        const requesterSessionId = process.env.VK_SESSION_ID ?? ctx.sessionId;
        if (!requesterSessionId) {
            throw new Error('Could not determine requester session; VK_SESSION_ID was not set and session discovery failed');
        }
        const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vibe-agent-request-review-'));
        const outputFile = path.join(tempDir, 'output.log');
        fs.closeSync(fs.openSync(outputFile, 'w'));
        const payload = {
            requesterSessionId,
            requestReviewArgs: args,
            outputFile,
            cwd: process.cwd(),
            quietWindowMs: REQUEST_REVIEW_QUIET_WINDOW_MS,
        };
        const runner = spawn(process.execPath, [fileURLToPath(import.meta.url), '__request-review-runner', JSON.stringify(payload)], {
            detached: true,
            stdio: 'ignore',
            env: process.env,
            cwd: process.cwd(),
        });
        runner.unref();
        if (jsonOutput) {
            console.log(JSON.stringify({
                status: 'scheduled',
                session_id: requesterSessionId,
                output_file: outputFile,
                runner_pid: runner.pid ?? null,
                quiet_window_ms: REQUEST_REVIEW_QUIET_WINDOW_MS,
            }, null, 2));
        }
        else {
            console.log(buildRequestReviewScheduledMessage(outputFile, requesterSessionId));
            if (runner.pid) {
                console.log(`Runner PID:  ${runner.pid}`);
            }
        }
    }
    catch (err) {
        console.error(`Error: ${err.message}`);
        console.error('Usage: vibe-agent request-review [instructions] [--reviewer <role>] [--timeout <duration>] [--timeout-ms <ms>] [--json]');
        process.exit(1);
    }
}
async function submit(args) {
    const message = args[0];
    const jsonOutput = args.includes('--json');
    const filesFlagIdx = args.indexOf('--files');
    const files = filesFlagIdx !== -1 ? args[filesFlagIdx + 1] : undefined;
    if (!message) {
        console.error('Usage: vibe-agent submit "<message>" [--files <file1,file2>] [--json]');
        process.exit(1);
    }
    // Build the full message
    let fullMessage = message;
    if (files) {
        fullMessage += `\n\nFiles changed: ${files}`;
    }
    // Submit sends to reviewer
    const submitArgs = ['reviewer', fullMessage];
    if (jsonOutput)
        submitArgs.push('--json');
    await send(submitArgs);
}
async function review(args) {
    const action = args[0];
    const message = args[1];
    const jsonOutput = args.includes('--json');
    if (!action || !['approve', 'changes'].includes(action)) {
        console.error('Usage: vibe-agent review <approve|changes> "<message>" [--change "..."] [--json]');
        process.exit(1);
    }
    if (!message) {
        console.error('Usage: vibe-agent review <approve|changes> "<message>" [--change "..."] [--json]');
        process.exit(1);
    }
    // Collect --change flags for changes action
    const changes = [];
    let i = 2;
    while (i < args.length) {
        if (args[i] === '--change' && args[i + 1]) {
            changes.push(args[i + 1]);
            i += 2;
        }
        else {
            i++;
        }
    }
    // Build the full message
    let fullMessage = action === 'approve' ? `APPROVED: ${message}` : `CHANGES REQUESTED: ${message}`;
    if (changes.length > 0) {
        fullMessage += '\n\nRequired changes:\n' + changes.map((c, i) => `${i + 1}. ${c}`).join('\n');
    }
    // Review sends to implementer
    const reviewArgs = ['implementer', fullMessage];
    if (jsonOutput)
        reviewArgs.push('--json');
    await send(reviewArgs);
}
async function help(args) {
    const message = args[0];
    const jsonOutput = args.includes('--json');
    const typeFlagIdx = args.indexOf('--type');
    const blockerType = typeFlagIdx !== -1 ? args[typeFlagIdx + 1] : undefined;
    if (!message) {
        console.error('Usage: vibe-agent help "<message>" [--type <type>] [--json]');
        console.error('Types: unclear_spec, blocked_by_other, technical');
        process.exit(1);
    }
    // Build the full message
    let fullMessage = 'HELP REQUESTED';
    if (blockerType) {
        fullMessage += ` [${blockerType}]`;
    }
    fullMessage += `: ${message}`;
    // Help sends to PM
    const helpArgs = ['pm', fullMessage];
    if (jsonOutput)
        helpArgs.push('--json');
    await send(helpArgs);
}
async function registerSelf(args) {
    const roleArg = args[0];
    const jsonOutput = args.includes('--json');
    if (!roleArg) {
        console.error('Usage: vibe-agent register-self <role> [--json]');
        console.error(`Standard roles: ${BASE_ROLES.join(', ')} (or with suffix: reviewer-2, etc.)`);
        console.error('Custom roles are also allowed (use CODEX by default)');
        process.exit(1);
    }
    if (!isValidRole(roleArg)) {
        console.error(`Invalid role: ${roleArg}`);
        console.error(`Standard roles: ${BASE_ROLES.join(', ')} (or with suffix: reviewer-2, etc.)`);
        console.error('Custom roles are also allowed (use CODEX by default)');
        process.exit(1);
    }
    const role = roleArg;
    const workspaceId = process.env.VK_WORKSPACE_ID;
    if (!workspaceId) {
        console.error('Error: VK_WORKSPACE_ID not set - not running in VK context');
        process.exit(1);
    }
    try {
        // Get all sessions for this workspace
        const sessions = await client.getSessions(workspaceId);
        if (sessions.length === 0) {
            console.error('Error: No sessions found for this workspace');
            process.exit(1);
        }
        // Find most recent session (by created_at)
        const mostRecent = sessions.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())[0];
        // Register it with the specified role
        registerSession(workspaceId, mostRecent.id, role);
        if (jsonOutput) {
            console.log(JSON.stringify({
                session_id: mostRecent.id,
                role,
                workspace_id: workspaceId,
            }, null, 2));
        }
        else {
            console.log(`Registered session ${mostRecent.id} as ${role}`);
            console.log(`Workspace: ${workspaceId}`);
        }
    }
    catch (err) {
        console.error(`Error: ${err.message}`);
        process.exit(1);
    }
}
async function sessionsCommand(args) {
    const subcommand = args[0];
    const commandArgs = subcommand === 'list' ? args.slice(1) : args;
    const jsonOutput = commandArgs.includes('--json');
    const includeNumMessages = commandArgs.includes('--include-num-messages');
    const allowedArgs = new Set(['--json', '--include-num-messages']);
    const unknownArg = commandArgs.find(arg => arg.startsWith('-') && !allowedArgs.has(arg));
    if ((subcommand && subcommand !== 'list' && !allowedArgs.has(subcommand)) || unknownArg) {
        console.error('Usage: vibe-agent sessions list [--include-num-messages] [--json]');
        process.exit(1);
    }
    const workspaceId = process.env.VK_WORKSPACE_ID;
    if (!workspaceId) {
        console.error('Error: VK_WORKSPACE_ID not set - not running in VK context');
        process.exit(1);
    }
    try {
        const sessions = await client.getSessions(workspaceId);
        const workspaceName = getWorkspaceDisplayName(workspaceId);
        const sessionFile = readSessionFile(workspaceId);
        const currentSessionId = process.env.VK_SESSION_ID ?? null;
        const baseSessionInfo = sessions
            .slice()
            .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
            .map(s => ({
            id: s.id,
            executor: s.executor,
            role: sessionFile[s.id] ?? s.name ?? null,
            name: s.name ?? null,
            created_at: s.created_at,
            updated_at: s.updated_at,
            current: currentSessionId === s.id,
        }));
        const sessionInfo = includeNumMessages
            ? await Promise.all(baseSessionInfo.map(async (s) => {
                const processes = await client.getSessionProcesses(s.id);
                return {
                    ...s,
                    num_messages: processes.length,
                    num_terminal_messages: processes.filter(isTerminalProcess).length,
                };
            }))
            : baseSessionInfo;
        if (jsonOutput) {
            console.log(JSON.stringify({ workspace_id: workspaceId, workspace_name: workspaceName, sessions: sessionInfo }, null, 2));
            return;
        }
        console.log(`Workspace: ${workspaceId}`);
        if (workspaceName) {
            console.log(`Name:      ${workspaceName}`);
        }
        console.log('Sessions:');
        for (const s of sessionInfo) {
            const role = s.role ? ` (${s.role})` : '';
            const current = s.current ? ' [current]' : '';
            console.log(`  ${s.id} - ${s.executor}${role}${current}`);
            const messageCount = includeNumMessages
                ? `; messages: ${s.num_messages} (${s.num_terminal_messages} terminal)`
                : '';
            console.log(`    created: ${s.created_at}${messageCount}`);
        }
    }
    catch (err) {
        console.error(`Error: ${err.message}`);
        process.exit(1);
    }
}
async function excludeMe(args) {
    const jsonOutput = args.includes('--json');
    const unknownArg = args.find(arg => arg.startsWith('-') && arg !== '--json');
    if (unknownArg) {
        console.error('Usage: vibe-agent exclude-me [--json]');
        process.exit(1);
    }
    const workspaceId = process.env.VK_WORKSPACE_ID;
    if (!workspaceId) {
        console.error('Error: VK_WORKSPACE_ID not set - not running in VK context');
        process.exit(1);
    }
    try {
        const ctx = await getAgentContext();
        const sessionId = process.env.VK_SESSION_ID ?? ctx.sessionId;
        if (!sessionId) {
            throw new Error('Could not determine invoking session; VK_SESSION_ID was not set and session discovery failed');
        }
        const state = readFullSummaryState(workspaceId);
        const excludedSessionIds = new Set(state.excludedSessionIds ?? []);
        const alreadyExcluded = excludedSessionIds.has(sessionId);
        excludedSessionIds.add(sessionId);
        state.excludedSessionIds = Array.from(excludedSessionIds).sort();
        writeFullSummaryState(workspaceId, state);
        if (jsonOutput) {
            console.log(JSON.stringify({
                workspace_id: workspaceId,
                session_id: sessionId,
                excluded: true,
                already_excluded: alreadyExcluded,
                state_file: getFullSummaryStatePath(workspaceId),
            }, null, 2));
            return;
        }
        if (alreadyExcluded) {
            console.log(`Session ${sessionId} was already excluded from full_summary output.`);
        }
        else {
            console.log(`Session ${sessionId} is now excluded from full_summary output.`);
        }
        console.log(`Workspace: ${workspaceId}`);
        console.log(`State:     ${getFullSummaryStatePath(workspaceId)}`);
    }
    catch (err) {
        console.error(`Error: ${err.message}`);
        process.exit(1);
    }
}
function isTerminalProcess(process) {
    return TERMINAL_PROCESS_STATUSES.has(process.status) || process.completed_at != null;
}
function xmlEscape(value) {
    return value
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&apos;');
}
function xmlAttrs(attrs) {
    return Object.entries(attrs)
        .filter(([, value]) => value !== null && value !== undefined)
        .map(([key, value]) => ` ${key}="${xmlEscape(String(value))}"`)
        .join('');
}
function xmlTextElement(indent, name, value, emptyValue) {
    return `${indent}<${name}>${xmlEscape(value ?? emptyValue)}</${name}>`;
}
export function formatFullSummaryText(result) {
    const lines = [];
    lines.push(`<full_summary${xmlAttrs({
        workspace_id: result.workspace_id,
        workspace_name: result.workspace_name,
        reader_session_id: result.reader_session_id,
        excluded_current_session_id: result.excluded_current_session_id,
        excluded_session_ids: result.excluded_session_ids.join(',') || null,
    })}>`);
    lines.push(`  <guardrails${xmlAttrs({
        total_matching_sessions: result.guardrails.total_matching_sessions,
        sessions_returned: result.guardrails.sessions_returned,
        turns_returned: result.guardrails.turns_returned,
        limited: result.guardrails.limited,
    })}>`);
    if (result.guardrails.message) {
        lines.push(xmlTextElement('    ', 'message', result.guardrails.message, ''));
    }
    lines.push('  </guardrails>');
    if (result.turns.length === 0) {
        lines.push('  <turns />');
        lines.push('</full_summary>');
        return lines.join('\n');
    }
    lines.push('  <turns>');
    for (const [index, turn] of result.turns.entries()) {
        lines.push(`    <turn${xmlAttrs({
            index: index + 1,
            process_id: turn.process.id,
            status: turn.process.status,
            created_at: turn.process.created_at,
            completed_at: turn.process.completed_at,
            run_reason: turn.process.run_reason,
        })}>`);
        lines.push(`      <session${xmlAttrs({
            id: turn.session.id,
            executor: turn.session.executor,
            role: turn.session.role,
            name: turn.session.name,
            created_at: turn.session.created_at,
        })} />`);
        lines.push(xmlTextElement('      ', 'initial_user_prompt', truncateText(turn.initialUserPrompt, 6000), '(not found)'));
        lines.push(xmlTextElement('      ', 'agent_pre_response', truncateText(turn.agentPreResponse, 4000), '(none)'));
        lines.push(`      <tool_calls${xmlAttrs({
            total: turn.toolCalls.total,
            reads: turn.toolCalls.reads,
            writes: turn.toolCalls.writes,
            web_searches: turn.toolCalls.webSearches,
            other: turn.toolCalls.other,
        })} />`);
        lines.push(xmlTextElement('      ', 'agent_response', truncateText(turn.agentResponse, 6000), '(none)'));
        lines.push(`      <git_commit_summary${xmlAttrs({ repository_path: turn.gitRepositoryPath })}>`);
        if (turn.gitCommitSummaryNote) {
            lines.push(xmlTextElement('        ', 'note', turn.gitCommitSummaryNote, ''));
        }
        else if (turn.gitCommits.length === 0) {
            lines.push('        <commits />');
        }
        else {
            lines.push('        <commits>');
            for (const commit of turn.gitCommits) {
                lines.push(`          <commit${xmlAttrs({
                    hash: commit.hash,
                    subject: commit.subject,
                    files_changed: commit.filesChanged,
                    lines_added: commit.linesAdded,
                    lines_deleted: commit.linesDeleted,
                })}>`);
                lines.push('            <files>');
                for (const file of commit.files) {
                    lines.push(`              <file${xmlAttrs({
                        path: file.path,
                        added: file.added,
                        deleted: file.deleted,
                        binary: file.binary,
                    })} />`);
                }
                lines.push('            </files>');
                lines.push('          </commit>');
            }
            lines.push('        </commits>');
        }
        lines.push('      </git_commit_summary>');
        lines.push('    </turn>');
    }
    lines.push('  </turns>');
    lines.push('</full_summary>');
    return lines.join('\n');
}
async function fullSummary(args) {
    let parsed;
    try {
        parsed = parseFullSummaryArgs(args);
    }
    catch (err) {
        console.error(`Error: ${err.message}`);
        console.error('Usage: vibe-agent full_summary [--session <id>] [--all] [--no-advance] [--include-running] [--limit-turns <n>] [--limit-sessions <n>] [--json]');
        process.exit(1);
    }
    const workspaceId = process.env.VK_WORKSPACE_ID;
    if (!workspaceId) {
        console.error('Error: VK_WORKSPACE_ID not set - not running in VK context');
        process.exit(1);
    }
    try {
        const currentSessionId = process.env.VK_SESSION_ID ?? null;
        const readerId = getReaderId();
        const workspaceName = getWorkspaceDisplayName(workspaceId);
        const state = readFullSummaryState(workspaceId);
        const readerState = state.readers[readerId] ?? { seenProcessIds: [], lastQueriedAt: new Date(0).toISOString() };
        const seenProcessIds = new Set(parsed.all ? [] : readerState.seenProcessIds);
        const excludedSessionIds = new Set(state.excludedSessionIds ?? []);
        const sessionFile = readSessionFile(workspaceId);
        let sessions = await client.getSessions(workspaceId);
        sessions = sessions.filter(s => s.id !== currentSessionId && !excludedSessionIds.has(s.id));
        if (parsed.sessionIds.length > 0) {
            const wanted = new Set(parsed.sessionIds);
            sessions = sessions.filter(s => wanted.has(s.id));
        }
        sessions = sessions.sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime());
        const totalMatchingSessions = sessions.length;
        const sessionLimitHit = sessions.length > parsed.limitSessions;
        sessions = sessions.slice(0, parsed.limitSessions);
        const turns = [];
        let messageLimitHit = false;
        for (let sessionIndex = 0; sessionIndex < sessions.length; sessionIndex++) {
            const session = sessions[sessionIndex];
            const processes = (await client.getSessionProcesses(session.id))
                .filter(process => parsed.includeRunning || isTerminalProcess(process))
                .filter(process => !seenProcessIds.has(process.id))
                .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
            if (turns.length + processes.length > parsed.limitTurns) {
                messageLimitHit = true;
            }
            for (const process of processes) {
                if (turns.length >= parsed.limitTurns)
                    break;
                const entries = await client.fetchConversation(process.id, 10_000);
                const conversation = summarizeTurnConversation(entries);
                const gitRepositoryPath = resolveProcessWorkingDirectory(process, workspaceId, globalThis.process.cwd());
                const gitNote = gitRepositoryPath
                    ? null
                    : 'Skipped: process working directory could not be resolved to a local git repository without using deprecated workspace APIs.';
                turns.push({
                    session: {
                        id: session.id,
                        executor: session.executor,
                        role: sessionFile[session.id] ?? session.name ?? null,
                        name: session.name ?? null,
                        created_at: session.created_at,
                    },
                    process: {
                        id: process.id,
                        status: process.status,
                        created_at: process.created_at,
                        completed_at: process.completed_at,
                        run_reason: process.run_reason,
                    },
                    initialUserPrompt: extractPromptFromProcess(process) ?? extractInitialUserMessage(entries),
                    agentPreResponse: conversation.agentPreResponse,
                    toolCalls: conversation.toolCalls,
                    agentResponse: conversation.agentResponse,
                    gitCommits: gitRepositoryPath ? getCommitSummariesForTurn(process, conversation.agentResponse, conversation.toolCalls, gitRepositoryPath) : [],
                    gitCommitSummaryNote: gitNote,
                    gitRepositoryPath,
                });
            }
            if (turns.length >= parsed.limitTurns) {
                if (sessionIndex < sessions.length - 1) {
                    messageLimitHit = true;
                }
                break;
            }
        }
        const limited = sessionLimitHit || messageLimitHit;
        const result = {
            workspace_id: workspaceId,
            workspace_name: workspaceName,
            reader_session_id: readerId,
            excluded_current_session_id: currentSessionId,
            excluded_session_ids: Array.from(excludedSessionIds).sort(),
            filters: {
                session_ids: parsed.sessionIds,
                all: parsed.all,
                include_running: parsed.includeRunning,
                limit_turns: parsed.limitTurns,
                limit_sessions: parsed.limitSessions,
            },
            guardrails: {
                total_matching_sessions: totalMatchingSessions,
                sessions_returned: sessions.length,
                turns_returned: turns.length,
                limited,
                message: limited
                    ? 'Output was limited by guardrails. Re-run with --session <id>, --limit-messages <n> (alias: --limit-turns), --limit-sessions <n>, or --all intentionally.'
                    : null,
            },
            turns,
        };
        if (!parsed.noAdvance && !parsed.all) {
            const nextSeen = new Set(readerState.seenProcessIds);
            for (const turn of turns) {
                nextSeen.add(turn.process.id);
            }
            state.readers[readerId] = {
                seenProcessIds: Array.from(nextSeen).slice(-5000),
                lastQueriedAt: new Date().toISOString(),
            };
            writeFullSummaryState(workspaceId, state);
        }
        if (parsed.jsonOutput) {
            console.log(JSON.stringify(result, null, 2));
            return;
        }
        console.log(formatFullSummaryText(result));
    }
    catch (err) {
        console.error(`Error: ${err.message}`);
        process.exit(1);
    }
}
async function status(args) {
    const jsonOutput = args.includes('--json');
    const workspaceId = process.env.VK_WORKSPACE_ID;
    if (!workspaceId) {
        console.error('Error: VK_WORKSPACE_ID not set - not running in VK context');
        process.exit(1);
    }
    try {
        // Get all sessions for this workspace
        const sessions = await client.getSessions(workspaceId);
        if (sessions.length === 0) {
            if (jsonOutput) {
                console.log(JSON.stringify({ sessions: [], summary: null }, null, 2));
            }
            else {
                console.log('No sessions found for this workspace');
            }
            return;
        }
        // Get workspace summary (may fail if API has issues)
        let summary = null;
        try {
            const summaries = await client.getWorkspaceSummary([workspaceId]);
            summary = summaries[0] ?? null;
        }
        catch {
            // Summary endpoint may not be available; continue without it
        }
        // Read session file for roles
        const sessionFile = readSessionFile(workspaceId);
        const sessionInfo = sessions.map(s => ({
            id: s.id,
            executor: s.executor,
            role: sessionFile[s.id] ?? null,
            created_at: s.created_at,
        }));
        if (jsonOutput) {
            console.log(JSON.stringify({
                workspace_id: workspaceId,
                sessions: sessionInfo,
                summary: summary ? {
                    latest_process_status: summary.latest_process_status,
                    has_pending_approval: summary.has_pending_approval,
                    has_unseen_turns: summary.has_unseen_turns,
                } : null,
            }, null, 2));
        }
        else {
            console.log(`Workspace: ${workspaceId}`);
            console.log('');
            console.log('Sessions:');
            for (const s of sessionInfo) {
                const role = s.role ? ` (${s.role})` : '';
                console.log(`  ${s.id} - ${s.executor}${role}`);
            }
            if (summary) {
                console.log('');
                console.log(`Status: ${summary.latest_process_status}`);
                if (summary.has_pending_approval) {
                    console.log('  ⚠ Has pending approval');
                }
                if (summary.has_unseen_turns) {
                    console.log('  📬 Has unseen messages');
                }
            }
        }
    }
    catch (err) {
        console.error(`Error: ${err.message}`);
        process.exit(1);
    }
}
function showHelp() {
    console.log(`vibe-agent - Agent CLI for Vibe Kanban

Usage: vibe-agent <command> [options]

Commands:
  whoami                       Show current context (role shows as
                               'unregistered' until first send/submit/etc.)
    --json                     Output as JSON

  register-self <role>         Register most recent session with a role
    --json                     Output as JSON
    (Use this as first agent in workspace to register yourself)

  send <role> "<message>"      Send message to another agent
    --respond                  Route the receiving agent final response back to this session
    --timeout <duration>       Timeout for --respond wait (for example: 30s, 10m, 1h)
    --timeout-ms <ms>          Timeout for --respond wait in milliseconds
    --json                     Output as JSON
    (Auto-creates and registers session if none exists for the role)

  request-review [instructions] Schedule a thorough branch code review from reviewer
                              after this session's current/auto-commit turns finish
    --reviewer <role>          Target a specific reviewer role (default: reviewer)
    --timeout <duration>       Timeout for the response wait (for example: 30s, 10m, 1h)
    --timeout-ms <ms>          Timeout for the response wait in milliseconds
    --json                     Output as JSON

  submit "<message>"           Submit work for review (sends to reviewer)
    --files <file1,file2>      List of changed files
    --json                     Output as JSON

  review <approve|changes>     Submit review result (sends to implementer)
    "<message>"
    --change "<text>"          Specific change item (repeatable)
    --json                     Output as JSON

  help "<message>"             Request help with a blocker (sends to pm)
    --type <type>              Blocker type (unclear_spec, blocked_by_other, technical)
    --json                     Output as JSON

  status                       Check workspace status and sessions
    --json                     Output as JSON

  sessions list                List sessions in the current workspace
    --include-num-messages     Include session process/message counts
    --json                     Output as JSON

  exclude-me                   Exclude this session from future full_summary output
    --json                     Output as JSON

  full_summary                 Summarize new completed turns across sessions in
                               the current workspace, excluding this session.
    --session <id>             Include only a specific session (repeatable)
    --all                      Ignore this caller's pager state for this run
    --no-advance               Do not update this caller's pager state
    --include-running          Include non-terminal turns too
    --limit-messages <n>       Max turns/messages to print (default: 200)
    --limit-turns <n>          Alias for --limit-messages
    --limit-sessions <n>       Max sessions to scan (default: 50)
    --json                     Output as JSON

  callback "command to run"    Run a shell command in the background and
                               message this session when it finishes
    --message "text"           Override the completion message sent back to this session
    --timeout <duration>       Stop the command after a timeout (for example: 30s, 10m, 1h)
    --timeout-ms <ms>          Stop the command after a timeout in milliseconds
    --json                     Output as JSON

  onboarding                   Print repo workflow conventions for agents

Standard roles: ${BASE_ROLES.join(', ')} (or with suffix: reviewer-2, pm-3, etc.)
Custom roles are also allowed (default to CODEX executor)

Environment variables:
  VK_WORKSPACE_ID    Workspace ID (required, set by VK)
  VK_SESSION_ID      Session ID (required by callback; optional elsewhere for discovery)
  VK_PROJECT_ID      Project ID
  VK_PROJECT_NAME    Project name
  VK_TASK_ID         Task ID
  VK_WORKSPACE_BRANCH  Workspace branch
  VIBE_API_URL       VK API URL (default: http://localhost:3007)
`);
}
function onboarding() {
    console.log(`Vibe agent onboarding

Core workflow:
  - Use bd for task tracking in this repo. Create or update beads for meaningful work.
  - Always reference beads by id and title, for example: vkvw-3516 — Vendor vibe-agent and vk CLIs with onboarding.
  - Filter to branch-relevant beads before choosing work. Useful commands:
      bd list --json
      bd search "<topic>" --json
      bd show <bead-id> --json
      bd comment <bead-id> "<update>"
  - Keep unrelated beads as-is; do not close or rewrite tasks that are outside the current branch.
  - Prefer small, mergeable changes with tests. Avoid risky nitpicks.
  - Before handing back code, review your own diff and run focused validation.

Container conventions:
  - You run as vkuser, not root. Use sudo for system administration and package installs when normal Linux defaults require it.
  - sudo is expected to be passwordless in the vkvd image.
  - Conventional mutable paths such as /usr/local, /opt, /var/lib/vd, and /var/tmp/vibe-kanban are intended to be shared-writable.
  - vibe-agent and vk should be available on PATH.

Current branch conventions:
  - Runtime/plugin orchestration code belongs under ./plugins, not ./src.
  - ./src is for the VD web application/server source.
  - Built-in plugin service metadata lives under ./plugins.

Notes conventions:
  - User/workspace notes support is planned but not active in this repo yet.
  - Future onboarding should explain vibe-agent notes changed once that command exists.
`);
}

// Main entry point
async function main() {
    const args = process.argv.slice(2);
    const command = args[0];
    const commandArgs = args.slice(1);
    if (!command || command === '--help' || command === '-h') {
        showHelp();
        process.exit(0);
    }
    switch (command) {
        case 'onboarding':
            onboarding();
            break;
        case 'whoami':
            await whoami(commandArgs);
            break;
        case 'register-self':
            await registerSelf(commandArgs);
            break;
        case 'send':
            await send(commandArgs);
            break;
        case 'request-review':
            await requestReview(commandArgs);
            break;
        case 'submit':
            await submit(commandArgs);
            break;
        case 'review':
            await review(commandArgs);
            break;
        case 'help':
            await help(commandArgs);
            break;
        case 'status':
            await status(commandArgs);
            break;
        case 'sessions':
            await sessionsCommand(commandArgs);
            break;
        case 'exclude-me':
            await excludeMe(commandArgs);
            break;
        case 'full_summary':
            await fullSummary(commandArgs);
            break;
        case 'callback':
            await callback(commandArgs);
            break;
        case '__callback-runner':
            await callbackRunner(commandArgs);
            break;
        case '__respond-runner':
            await respondRunner(commandArgs);
            break;
        case '__request-review-runner':
            await requestReviewRunner(commandArgs);
            break;
        default:
            console.error(`Unknown command: ${command}`);
            console.error('Run vibe-agent --help for usage');
            process.exit(1);
    }
}
const invokedPath = process.argv[1] ?? '';
const isDirectInvocation = invokedPath && fileURLToPath(import.meta.url) === invokedPath;
const isBinShimInvocation = /(?:^|[\\/])bin[\\/]vibe-agent$/.test(invokedPath);
if (isDirectInvocation || isBinShimInvocation) {
    main().catch(err => {
        console.error('Error:', err.message);
        process.exit(1);
    });
}
