import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import {
  VardashSettingsView,
  getSelectedVardashRepo,
  getVardashRepoLabel,
} from './VardashSettingsPanel';
import type { RepoWithBranch } from '../../lib/vk-client';

describe('VardashSettingsPanel helpers', () => {
  it('auto-selects a single workspace repo and requires explicit selection for multi-repo workspaces', () => {
    expect(getSelectedVardashRepo([repoA], null)).toEqual(repoA);
    expect(getSelectedVardashRepo([repoA, repoB], null)).toBeNull();
    expect(getSelectedVardashRepo([repoA, repoB], 'repo-b')).toEqual(repoB);
    expect(getSelectedVardashRepo([repoA, repoB], 'missing')).toBeNull();
  });

  it('uses display_name as the repo label when available', () => {
    expect(getVardashRepoLabel(repoA)).toBe('Repo A');
    expect(getVardashRepoLabel({ ...repoA, display_name: '' })).toBe('repo-a');
  });
});

describe('VardashSettingsView', () => {
  it('renders workspace-scoped context and a multi-repo explicit selection prompt without secrets', () => {
    const html = renderToStaticMarkup(React.createElement(VardashSettingsView, {
      workspaceId: 'ws-a',
      workspaceDir: '/home/vkuser/repos/workspace',
      repos: [repoA, repoB],
      selectedRepoId: null,
      loading: false,
      onSelectRepo: vi.fn(),
      children: React.createElement('div', null, 'Vardash panels'),
    }));

    expect(html).toContain('Workspace repo env and launches');
    expect(html).toContain('ws-a');
    expect(html).toContain('/home/vkuser/repos/workspace');
    expect(html).toContain('Select repo…');
    expect(html).toContain('This workspace has multiple repos');
    expect(html).not.toContain('Vardash panels');
    expect(html).not.toContain('super-secret');
    expect(html).not.toContain('raw env');
  });

  it('renders child Vardash sections only after a repo is selected', () => {
    const html = renderToStaticMarkup(React.createElement(VardashSettingsView, {
      workspaceId: 'ws-a',
      workspaceDir: '/home/vkuser/repos/workspace',
      repos: [repoA, repoB],
      selectedRepoId: 'repo-b',
      loading: false,
      onSelectRepo: vi.fn(),
      children: React.createElement('div', null, 'Vardash panels'),
    }));

    expect(html).toContain('Editing Vardash settings for');
    expect(html).toContain('Repo B');
    expect(html).toContain('Vardash panels');
  });

  it('auto-renders child Vardash sections for a single workspace repo', () => {
    const html = renderToStaticMarkup(React.createElement(VardashSettingsView, {
      workspaceId: 'ws-a',
      workspaceDir: '/home/vkuser/repos/workspace',
      repos: [repoA],
      selectedRepoId: null,
      loading: false,
      onSelectRepo: vi.fn(),
      children: React.createElement('div', null, 'Vardash panels'),
    }));

    expect(html).toContain('Using repository');
    expect(html).toContain('Repo A');
    expect(html).toContain('Vardash panels');
  });
});

const repoA: RepoWithBranch = {
  id: 'repo-a',
  name: 'repo-a',
  display_name: 'Repo A',
  target_branch: 'main',
};

const repoB: RepoWithBranch = {
  id: 'repo-b',
  name: 'repo-b',
  display_name: 'Repo B',
  target_branch: 'main',
};
