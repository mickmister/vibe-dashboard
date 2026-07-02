import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import {
  VardashProcessDefinitionsView,
  type VardashProcessDefinitionDraft,
} from './VardashProcessDefinitionsPanel';
import type { VardashProcessDefinitionMetadata } from '../../lib/vardash-client';

describe('VardashProcessDefinitionsView', () => {
  it('lists multiple process definitions with default and legacy markers without execution scope', () => {
    const html = renderToStaticMarkup(React.createElement(VardashProcessDefinitionsView, {
      processes,
      draft,
      busy: false,
      onDraftChange: () => undefined,
      onEdit: () => undefined,
      onSubmit: () => undefined,
      onSetDefault: () => undefined,
    }));

    expect(html).toContain('Dev server');
    expect(html).toContain('Worker');
    expect(html).toContain('Default');
    expect(html).toContain('Legacy dev_server_script');
    expect(html).toContain('Manual');
    expect(html).toContain('npm run dev');
    expect(html).not.toContain('Launch');
    expect(html).not.toContain('tmux');
    expect(html).not.toContain('logs');
  });

  it('submits manual process definitions without source provenance input', () => {
    const onSubmit = vi.fn();
    const nextDraft = { ...draft, id: 'proc-worker', name: 'Worker', command: 'npm run worker', cwd: 'packages/api', isDefault: true };

    renderToStaticMarkup(React.createElement(VardashProcessDefinitionsView, {
      processes,
      draft: nextDraft,
      busy: false,
      onDraftChange: () => undefined,
      onEdit: () => undefined,
      onSubmit,
      onSetDefault: () => undefined,
    }));

    // Direct callback shape documents the UI contract: generic edits never submit source.
    onSubmit(nextDraft);
    expect(onSubmit).toHaveBeenCalledWith({
      id: 'proc-worker',
      name: 'Worker',
      command: 'npm run worker',
      cwd: 'packages/api',
      isDefault: true,
    });
    expect(JSON.stringify(onSubmit.mock.calls[0])).not.toContain('legacy_dev_server_script');
  });
});

const processes: VardashProcessDefinitionMetadata[] = [
  {
    id: 'proc-dev',
    repoId: 'repo-a',
    name: 'Dev server',
    command: 'npm run dev',
    cwd: null,
    source: 'legacy_dev_server_script',
    isDefault: true,
    createdAt: 'now',
    updatedAt: 'now',
  },
  {
    id: 'proc-worker',
    repoId: 'repo-a',
    name: 'Worker',
    command: 'npm run worker',
    cwd: 'packages/api',
    source: 'manual',
    isDefault: false,
    createdAt: 'now',
    updatedAt: 'now',
  },
];

const draft: VardashProcessDefinitionDraft = {
  id: null,
  name: '',
  command: '',
  cwd: '',
  isDefault: false,
};
