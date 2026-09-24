import { describe, expect, it } from 'vitest';
import type { PanelTargetResolutionContext, StoredPanelTarget } from '../store/panelTargetRegistry';
import {
  createSplitViewLeaseSession,
  parseSplitViewIntent,
  resolveSplitViewIntent,
  type SplitViewCandidate,
  type SplitViewPanelRef,
} from './DockviewSplitViewWorkflow';

const workspaceA = 'workspace-a';
const workspaceB = 'workspace-b';
const code = (workspaceId: string): StoredPanelTarget => ({ kind: 'code', version: 1, payload: { workspaceId, folderIntent: 'workspace-root' } });
const agent = (workspaceId: string): StoredPanelTarget => ({ kind: 'agent-session', version: 1, payload: { workspaceId, sessionId: `agent-${workspaceId}` } });
const forms = (workspaceId: string): StoredPanelTarget => ({ kind: 'forms', version: 1, payload: { workspaceId } });

function context(craftId: string): PanelTargetResolutionContext {
  const workspaces = Object.fromEntries([workspaceA, workspaceB].map((workspaceId) => [workspaceId, {
    id: workspaceId,
    available: true,
    directory: `/${workspaceId}`,
    origin: 'https://vk.example.test',
    repositoryIds: [],
    locations: {
      overview: `/${workspaceId}/overview`,
      code: `/${workspaceId}/code`,
      changes: `/${workspaceId}/changes`,
      beads: `/${workspaceId}/beads`,
      forms: `/${workspaceId}/forms`,
    },
  }]));
  return {
    craftId,
    hostOrigin: 'https://dashboard.example.test',
    crafts: {
      [workspaceA]: { workspaceId: workspaceA, allowedPluginTargets: [] },
      [workspaceB]: { workspaceId: workspaceB, allowedPluginTargets: [] },
    },
    workspaces,
    agentSessions: {
      [`agent-${workspaceA}`]: { workspaceId: workspaceA, location: '/agent-a' },
      [`agent-${workspaceB}`]: { workspaceId: workspaceB, location: '/agent-b' },
    },
    terminals: {},
    previews: {},
    builtInRoutes: {},
    redirectGuards: {
      [`agent-session:agent-${workspaceA}`]: { deliveryUrl: 'https://dashboard.example.test/guard/agent-a', upstreamOrigin: 'https://vk.example.test' },
      [`agent-session:agent-${workspaceB}`]: { deliveryUrl: 'https://dashboard.example.test/guard/agent-b', upstreamOrigin: 'https://vk.example.test' },
      [`code:${workspaceA}`]: { deliveryUrl: 'https://dashboard.example.test/guard/code-a', upstreamOrigin: 'https://vk.example.test' },
      [`code:${workspaceB}`]: { deliveryUrl: 'https://dashboard.example.test/guard/code-b', upstreamOrigin: 'https://vk.example.test' },
      [`forms:${workspaceA}`]: { deliveryUrl: 'https://dashboard.example.test/guard/forms-a', upstreamOrigin: 'https://vk.example.test' },
      [`forms:${workspaceB}`]: { deliveryUrl: 'https://dashboard.example.test/guard/forms-b', upstreamOrigin: 'https://vk.example.test' },
    },
  };
}

const panels: SplitViewPanelRef[] = [
  { panelId: 'agent-a', voyageId: 'voyage', craftWorkspaceId: workspaceA, target: agent(workspaceA) },
  { panelId: 'code-a', voyageId: 'voyage', craftWorkspaceId: workspaceA, target: code(workspaceA) },
];
const candidates: SplitViewCandidate[] = [
  { craftWorkspaceId: workspaceA, surface: 'code', target: code(workspaceA) },
  { craftWorkspaceId: workspaceA, surface: 'forms', target: forms(workspaceA) },
  { craftWorkspaceId: workspaceB, surface: 'code', target: code(workspaceB) },
];

describe('DockviewSplitViewWorkflow', () => {
  it('parses trusted split route intents and rejects duplicates or untrusted params', () => {
    expect(parseSplitViewIntent('?voyage=voyage&split=agent-a&withSurface=code')).toEqual({
      voyageId: 'voyage',
      invokingPanelId: 'agent-a',
      withSurface: 'code',
    });
    expect(parseSplitViewIntent('?voyage=voyage&split=agent-a&split=other&withSurface=code')).toBeNull();
    expect(parseSplitViewIntent('?voyage=voyage&split=agent-a&withSurface=code&url=https://evil.test')).toBeNull();
    expect(parseSplitViewIntent('?voyage=../voyage&split=agent-a&withSurface=code')).toBeNull();
  });

  it('defaults Split View to same-Craft compatible surfaces and marks absent second surfaces split-only', () => {
    const codeResolution = resolveSplitViewIntent({
      search: '?voyage=voyage&split=agent-a&withSurface=code',
      currentVoyageId: 'voyage',
      panels,
      candidates,
      contextForCraft: context,
    });
    expect(codeResolution).toMatchObject({ ok: true, selected: { craftWorkspaceId: workspaceA }, splitOnly: false });

    const formsResolution = resolveSplitViewIntent({
      search: '?voyage=voyage&split=agent-a&withSurface=forms',
      currentVoyageId: 'voyage',
      panels,
      candidates,
      contextForCraft: context,
    });
    expect(formsResolution).toMatchObject({ ok: true, selected: { craftWorkspaceId: workspaceA }, splitOnly: true });
  });

  it('scopes existing durable target detection to the current Voyage', () => {
    const resolution = resolveSplitViewIntent({
      search: '?voyage=voyage&split=agent-a&withSurface=code',
      currentVoyageId: 'voyage',
      panels: [
        { panelId: 'agent-a', voyageId: 'voyage', craftWorkspaceId: workspaceA, target: agent(workspaceA) },
        { panelId: 'code-in-other-voyage', voyageId: 'other-voyage', craftWorkspaceId: workspaceA, target: code(workspaceA) },
      ],
      candidates,
      contextForCraft: context,
    });

    expect(resolution).toMatchObject({ ok: true, selected: { craftWorkspaceId: workspaceA }, splitOnly: true });
  });

  it('supports permitted cross-Craft split targets and fails closed for stale inputs', () => {
    expect(resolveSplitViewIntent({
      search: '?voyage=voyage&split=agent-a&withCraft=workspace-b&withSurface=code',
      currentVoyageId: 'voyage',
      panels,
      candidates,
      contextForCraft: context,
    })).toMatchObject({ ok: true, selected: { craftWorkspaceId: workspaceB } });
    expect(resolveSplitViewIntent({
      search: '?voyage=old&split=agent-a&withSurface=code',
      currentVoyageId: 'voyage',
      panels,
      candidates,
      contextForCraft: context,
    })).toEqual({ ok: false, reason: 'stale-voyage' });
    expect(resolveSplitViewIntent({
      search: '?voyage=voyage&split=missing&withSurface=code',
      currentVoyageId: 'voyage',
      panels,
      candidates,
      contextForCraft: context,
    })).toEqual({ ok: false, reason: 'invoking-panel-unavailable' });
  });

  it('leases runtimes in stable order and disposes split-only runtimes exactly once on rollback and exit', () => {
    const events: string[] = [];
    const busy = new Set(['z-runtime']);
    const session = createSplitViewLeaseSession({
      pin: () => events.push('pin'),
      unpin: () => events.push('unpin'),
      acquire: (runtimeId) => {
        events.push(`acquire:${runtimeId}`);
        if (busy.has(runtimeId)) throw new Error('runtime-unavailable');
      },
      release: (runtimeId) => events.push(`release:${runtimeId}`),
      dispose: (runtimeId) => events.push(`dispose:${runtimeId}`),
    });
    expect(session.enter([{ runtimeId: 'z-runtime' }, { runtimeId: 'a-split-only', splitOnly: true }]))
      .toEqual({ ok: false, reason: 'runtime-unavailable' });
    expect(events).toEqual(['pin', 'acquire:a-split-only', 'acquire:z-runtime', 'release:a-split-only', 'dispose:a-split-only', 'unpin']);

    busy.clear();
    expect(session.enter([{ runtimeId: 'z-runtime' }, { runtimeId: 'a-split-only', splitOnly: true }])).toEqual({ ok: true });
    expect(session.phase()).toBe('active');
    session.exit();
    expect(events.filter((event) => event === 'dispose:a-split-only')).toHaveLength(2);
    session.exit();
    expect(events.filter((event) => event === 'dispose:a-split-only')).toHaveLength(2);
  });
});
