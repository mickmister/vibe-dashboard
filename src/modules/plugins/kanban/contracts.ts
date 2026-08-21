import type React from 'react';

export type KanbanExternalViewUnsupportedReason =
  | 'missing_external_view_url'
  | 'malformed_url'
  | 'unsupported_provider_url'
  | string;

export type KanbanExternalViewParseResult<Locator = unknown> =
  | {
      status: 'ok';
      locator: Locator;
    }
  | {
      status: 'unsupported';
      reason: KanbanExternalViewUnsupportedReason;
      originalUrl?: string;
    };

export interface KanbanProviderRegistration {
  id: string;
  displayName: string;
  supportsExternalViewUrl: (url: URL) => boolean;
  parseExternalViewUrl?: (value: string) => KanbanExternalViewParseResult;
  renderExternalView?: (locator: unknown) => React.ReactElement;
}

export type ExternalIssueProvider = 'jira' | 'github' | 'linear';
