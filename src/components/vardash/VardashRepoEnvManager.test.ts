import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { VardashRepoEnvOverviewView } from './VardashRepoEnvManager';
import type { VardashRepoEnvOverviewResponse } from '../../lib/vardash-client';

describe('VardashRepoEnvOverviewView', () => {
  it('renders repo env metadata without revealing secret values', () => {
    const html = renderToStaticMarkup(React.createElement(VardashRepoEnvOverviewView, {
      overview: overviewFixture,
      repoLabel: 'vibe-dashboard',
      selectedKeyId: 'key-secret',
    }));

    expect(html).toContain('Vardash / Repo: vibe-dashboard');
    expect(html).toContain('API_TOKEN');
    expect(html).toContain('Secret');
    expect(html).toContain('Required');
    expect(html).toContain('prod');
    expect(html).toContain('local-dev');
    expect(html).toContain('Secret saved');
    expect(html).toContain('Secrets are write-only');
    expect(html).toContain('Workspace: ws-a');
    expect(html).not.toContain('super-secret');
    expect(html).not.toContain('local-secret');
    expect(html).not.toContain('copy secret');
    expect(html).not.toContain('Reveal');
  });

  it('shows plain values and labels missing required values and inherit semantics', () => {
    const html = renderToStaticMarkup(React.createElement(VardashRepoEnvOverviewView, {
      overview: overviewFixture,
      repoLabel: 'vibe-dashboard',
      selectedKeyId: 'key-plain',
    }));

    expect(html).toContain('PORT');
    expect(html).toContain('3000');
    expect(html).toContain('inherit repo default');
    expect(html).toContain('OPTIONAL_FLAG');
    expect(html).toContain('Required · no value selected');
  });
});

const overviewFixture: VardashRepoEnvOverviewResponse = {
  repoId: 'repo-a',
  workspaceId: 'ws-a',
  descriptionGuidance: 'Descriptions are metadata. Do not include secret material.',
  rows: [
    {
      key: {
        id: 'key-secret',
        repoId: 'repo-a',
        key: 'API_TOKEN',
        kind: 'secret',
        required: true,
        description: null,
        createdAt: 'now',
        updatedAt: 'now',
      },
      savedValueCount: 2,
      repoDefaultSelection: { savedValueId: 'saved-prod', savedValueName: 'prod', kind: 'secret' },
      workspaceSelection: { mode: 'selected', savedValueId: 'saved-local', savedValueName: 'local-dev', kind: 'secret' },
      savedValues: [
        {
          id: 'saved-prod',
          repoId: 'repo-a',
          envKeyId: 'key-secret',
          name: 'prod',
          kind: 'secret',
          hasValue: true,
          createdAt: 'now',
          updatedAt: 'now',
        },
        {
          id: 'saved-local',
          repoId: 'repo-a',
          envKeyId: 'key-secret',
          name: 'local-dev',
          kind: 'secret',
          hasValue: true,
          createdAt: 'now',
          updatedAt: 'now',
        },
      ],
    },
    {
      key: {
        id: 'key-plain',
        repoId: 'repo-a',
        key: 'PORT',
        kind: 'plain',
        required: true,
        description: null,
        createdAt: 'now',
        updatedAt: 'now',
      },
      savedValueCount: 1,
      repoDefaultSelection: { savedValueId: 'saved-port', savedValueName: 'local', kind: 'plain' },
      workspaceSelection: { mode: 'inherit' },
      savedValues: [
        {
          id: 'saved-port',
          repoId: 'repo-a',
          envKeyId: 'key-plain',
          name: 'local',
          kind: 'plain',
          hasValue: true,
          value: '3000',
          createdAt: 'now',
          updatedAt: 'now',
        },
      ],
    },
    {
      key: {
        id: 'key-missing',
        repoId: 'repo-a',
        key: 'OPTIONAL_FLAG',
        kind: 'plain',
        required: true,
        description: null,
        createdAt: 'now',
        updatedAt: 'now',
      },
      savedValueCount: 0,
      repoDefaultSelection: null,
      workspaceSelection: { mode: 'inherit' },
      savedValues: [],
    },
  ],
};
