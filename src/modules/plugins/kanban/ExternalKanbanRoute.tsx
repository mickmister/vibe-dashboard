import React from 'react';
import { Card, CardBody, Chip } from '@heroui/react';
import {
  EXTERNAL_VIEW_URL_PARAM,
  getKanbanProviders,
  type KanbanExternalViewUnsupportedReason,
} from './contracts';

const URL_PARSE_BASE = 'https://dashboard.local';

export function hasExternalViewQueryParam(search: string): boolean {
  const searchParams = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);
  return searchParams.has(EXTERNAL_VIEW_URL_PARAM);
}

export function ExternalKanbanDashboardRoute({ search }: { search: string }) {
  const searchParams = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);
  const externalUrl = searchParams.get(EXTERNAL_VIEW_URL_PARAM)?.trim();
  if (!externalUrl) {
    return (
      <ExternalKanbanMessage
        title="Unsupported external view"
        message={messageForUnsupportedReason('missing_external_view_url')}
        action="Open a supported Kanban board URL and launch VD again."
      />
    );
  }

  const parsedUrl = parseAbsoluteUrl(externalUrl);
  if (!parsedUrl) {
    return (
      <ExternalKanbanMessage
        title="Unsupported external view"
        message={messageForUnsupportedReason('malformed_url')}
        action="Open a supported Kanban board URL and launch VD again."
      />
    );
  }

  const provider = getKanbanProviders().find((candidate) => candidate.supportsExternalViewUrl(parsedUrl));
  if (!(provider?.parseExternalViewUrl && provider.renderExternalView)) {
    return (
      <ExternalKanbanMessage
        title="Unsupported external view"
        message={messageForUnsupportedReason('unsupported_provider_url')}
        action="Open a supported Kanban board URL and launch VD again."
      />
    );
  }

  const result = provider.parseExternalViewUrl(externalUrl);
  if (result.status !== 'ok') {
    return (
      <ExternalKanbanMessage
        title="Unsupported external view"
        message={messageForUnsupportedReason(result.reason)}
        action={`Open a supported ${provider.displayName} board URL and launch VD again.`}
      />
    );
  }

  return provider.renderExternalView(result.locator);
}

function parseAbsoluteUrl(value: string): URL | undefined {
  try {
    const parsed = new URL(value, URL_PARSE_BASE);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return undefined;
    if (!/^https?:\/\//i.test(value.trim())) return undefined;
    return parsed;
  } catch {
    return undefined;
  }
}

function messageForUnsupportedReason(reason: KanbanExternalViewUnsupportedReason): string {
  if (reason === 'missing_external_view_url') {
    return 'VD did not receive an external board URL to open.';
  }
  if (reason === 'malformed_url') {
    return 'The external board URL is malformed.';
  }
  if (reason === 'unsupported_provider_url') {
    return 'This read-only view currently supports registered Kanban provider URLs only.';
  }
  if (reason.startsWith('unsupported_')) {
    return 'The registered Kanban provider could not parse this board URL.';
  }
  return 'This read-only view currently supports registered Kanban provider URLs only.';
}

function ExternalKanbanMessage({
  title,
  message,
  action,
}: {
  title: string;
  message: string;
  action?: string;
}) {
  return (
    <div className="min-h-screen bg-neutral-950 p-6 text-neutral-100">
      <Card className="mx-auto mt-16 max-w-2xl border border-neutral-800 bg-neutral-900">
        <CardBody className="gap-4 p-6">
          <Chip size="sm" variant="flat" className="w-fit bg-neutral-800 text-neutral-300">
            External Kanban
          </Chip>
          <div>
            <h1 className="text-2xl font-semibold text-neutral-50">{title}</h1>
            <p className="mt-2 text-sm text-neutral-300">{message}</p>
          </div>
          {action ? <p className="text-sm text-neutral-400">{action}</p> : null}
        </CardBody>
      </Card>
    </div>
  );
}
