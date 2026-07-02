import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import {
  VardashLaunchView,
  formatVardashLaunchError,
  formatVarlockStatus,
} from './VardashLaunchPanel';
import { VardashApiError, type VardashLaunchReadinessResponse, type VardashLaunchStatusResponse } from '../../lib/vardash-client';

describe('VardashLaunchView', () => {
  it('renders readiness, selected metadata, Varlock status, and launch controls without secret or log exposure', () => {
    const html = renderToStaticMarkup(React.createElement(VardashLaunchView, {
      readiness,
      status: runningStatus,
      runId: 'run-1',
      useVarlock: true,
      loading: false,
      busy: false,
      onUseVarlockChange: vi.fn(),
      onLaunch: vi.fn(),
      onStop: vi.fn(),
    }));

    expect(html).toContain('Explicit repo launch');
    expect(html).toContain('Ready to launch.');
    expect(html).toContain('Dev server');
    expect(html).toContain('API_TOKEN');
    expect(html).toContain('workspace-token');
    expect(html).toContain('Varlock ready.');
    expect(html).toContain('Launch');
    expect(html).toContain('Stop');
    expect(html).not.toContain('Restart');
    expect(html).not.toContain('super-secret');
    expect(html).not.toContain('stdout data');
    expect(html).not.toContain('stderr data');
  });

  it('shows missing required values and disables unsafe stop for terminal status', () => {
    const stoppedStatus: VardashLaunchStatusResponse = { ...runningStatus, status: 'stopped', exitCode: 0 };
    const html = renderToStaticMarkup(React.createElement(VardashLaunchView, {
      readiness: { ...readiness, eligible: false, missingRequired: [{ id: 'key-1', key: 'API_TOKEN', kind: 'secret', required: true, description: null }] },
      status: stoppedStatus,
      runId: 'run-1',
      useVarlock: false,
      loading: false,
      busy: false,
      onUseVarlockChange: vi.fn(),
      onLaunch: vi.fn(),
      onStop: vi.fn(),
    }));

    expect(html).toContain('Not ready to launch.');
    expect(html).toContain('Missing required values');
    expect(html).toContain('API_TOKEN (secret)');
    expect(html).toContain('disabled=""');
  });

  it('formats generic, secret-safe Varlock and API errors', () => {
    expect(formatVarlockStatus({ ...readiness, varlock: { enabled: true, configured: false, available: false, reason: 'varlock_not_configured' } })).toBe('Varlock requested but not configured.');
    expect(formatVarlockStatus({ ...readiness, varlock: { enabled: true, configured: true, available: false, reason: 'varlock_unavailable' } })).toBe('Varlock requested but unavailable.');
    expect(formatVardashLaunchError(new VardashApiError({ path: '/launch', status: 409, statusText: 'Conflict', body: { error: 'launch_failed', detail: 'super-secret' } }))).toBe('Launch failed. Check readiness and try again.');
  });
});

const readiness: VardashLaunchReadinessResponse = {
  workspaceId: 'ws-a',
  repoId: 'repo-a',
  eligible: true,
  process: {
    id: 'proc-1',
    repoId: 'repo-a',
    name: 'Dev server',
    source: 'manual',
    isDefault: true,
  },
  missingRequired: [],
  selectedValues: [
    { key: 'API_TOKEN', kind: 'secret', savedValueId: 'value-1', savedValueName: 'workspace-token' },
    { key: 'PORT', kind: 'plain', savedValueId: 'value-2', savedValueName: 'local-port' },
  ],
  varlock: { enabled: true, configured: true, available: true },
  selectionSemantics: 'workspace-null-inherits-repo-default',
  normalAgentEnvIncludesVardashSecrets: false,
};

const runningStatus: VardashLaunchStatusResponse = {
  runId: 'run-1',
  status: 'running',
  startedAt: '2026-07-02T00:00:00.000Z',
  stoppedAt: null,
  exitCode: null,
};
