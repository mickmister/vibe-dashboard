import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import {
  formatVardashImportConflict,
  VardashImportFlowView,
  VardashImportPreviewView,
  type VardashImportDraft,
} from './VardashImportPanel';
import type { VardashImportResponse } from '../../lib/vardash-client';

describe('VardashImportFlowView', () => {
  it('renders dry-run preview and conflicts without echoing pasted secret values', () => {
    const preview: VardashImportResponse = {
      dryRun: true,
      keys: [
        { key: 'API_TOKEN', kind: 'secret', required: true, willCreateSavedValue: true },
        { key: 'PORT', kind: 'plain', required: true, willCreateSavedValue: true },
      ],
      diagnostics: [{ line: 3, message: 'Invalid environment variable key' }],
      conflicts: [
        { key: 'API_TOKEN', reason: 'saved_value_name_exists', savedValueName: 'local' },
        { key: 'TOKEN', reason: 'secret_to_plain_with_existing_values' },
      ],
    };

    const html = renderToStaticMarkup(React.createElement(VardashImportFlowView, {
      draft: pastedEnvDraft,
      preview,
      isPreviewing: false,
      isApplying: false,
      onDraftChange: () => undefined,
      onPreview: () => undefined,
      onApply: () => undefined,
    }));
    const previewHtml = renderToStaticMarkup(React.createElement(VardashImportPreviewView, { preview, savedValueName: 'local' }));

    expect(html).toContain('Paste .env values');
    expect(html).toContain('Values default to Secret');
    expect(html).toContain('API_TOKEN');
    expect(html).toContain('Create key + saved value &quot;local&quot;');
    expect(html).toContain('Invalid environment variable key');
    expect(html).toContain('saved value name &quot;local&quot; already exists');
    expect(html).toContain('cannot change existing Secret key with saved values to Plain');
    expect(html).toContain('disabled');
    expect(previewHtml).not.toContain('super-secret');
    expect(previewHtml).not.toContain('TOKEN=super-secret');
  });

  it('distinguishes sample-template metadata seeding and enables apply only after clean dry-run', () => {
    const preview: VardashImportResponse = {
      dryRun: true,
      keys: [{ key: 'API_TOKEN', kind: 'secret', required: true, willCreateSavedValue: false }],
      diagnostics: [],
      conflicts: [],
    };

    const html = renderToStaticMarkup(React.createElement(VardashImportFlowView, {
      draft: { ...pastedEnvDraft, source: 'sample-template' },
      preview,
      isPreviewing: false,
      isApplying: false,
      onDraftChange: () => undefined,
      onPreview: () => undefined,
      onApply: () => undefined,
    }));

    expect(html).toContain('Paste .env.sample / .env.example');
    expect(html).toContain('Creates required keys only; no values saved');
    expect(html).toContain('Create/update required key only');
    expect(html).toContain('>Apply</button>');
  });

  it('formats conflict messages without including raw env values', () => {
    expect(formatVardashImportConflict({ key: 'TOKEN', reason: 'duplicate_key_in_import' })).toBe('TOKEN: duplicate key in import.');
    expect(formatVardashImportConflict({ key: 'TOKEN', reason: 'secret_to_plain_with_existing_values' })).not.toContain('super-secret');
  });
});

const pastedEnvDraft: VardashImportDraft = {
  source: 'pasted-env',
  content: 'API_TOKEN=super-secret\nPORT=3000',
  savedValueName: 'local',
  plainKeysText: 'PORT',
};
