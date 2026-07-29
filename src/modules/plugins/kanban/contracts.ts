import type React from 'react';

export const EXTERNAL_VIEW_URL_PARAM = 'external_view_url';

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

const providers = new Map<string, KanbanProviderRegistration>();

export function registerKanbanProvider(provider: KanbanProviderRegistration): void {
  providers.set(provider.id, provider);
}

export function getKanbanProviders(): KanbanProviderRegistration[] {
  return [...providers.values()].sort((left, right) => left.id.localeCompare(right.id));
}
