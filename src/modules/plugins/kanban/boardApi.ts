import { EXTERNAL_VIEW_URL_PARAM } from './ExternalKanbanRoute';
import type {
  ExternalKanbanBoardApiResponse,
  ExternalKanbanBoardViewDto,
} from './boardTypes';
import type { ExternalIssueProvider } from './contracts';

export async function fetchExternalKanbanBoardView<BoardView extends ExternalKanbanBoardViewDto>({
  provider,
  externalViewUrl,
  fetchImpl = fetch,
}: {
  provider: ExternalIssueProvider;
  externalViewUrl: string;
  fetchImpl?: typeof fetch;
}): Promise<ExternalKanbanBoardApiResponse<BoardView>> {
  const origin = typeof window === 'undefined' ? 'https://dashboard.local' : window.location.origin;
  const url = new URL(`/dashboard/api/external-trackers/${provider}/board`, origin);
  url.searchParams.set(EXTERNAL_VIEW_URL_PARAM, externalViewUrl);

  const response = await fetchImpl(url.pathname + url.search, {
    headers: { accept: 'application/json' },
  });
  const json = await response.json().catch(() => undefined) as ExternalKanbanBoardApiResponse<BoardView> | undefined;
  if (json?.ok === true || json?.ok === false) return json;

  if (response.status === 404) {
    return {
      ok: false,
      error: {
        code: 'external_trackers_disabled',
        message: 'External tracker views are disabled or unavailable.',
        userAction: 'Enable the external tracker feature flag and try again.',
      },
    };
  }

  return {
    ok: false,
    error: {
      code: 'external_tracker_response_invalid',
      message: `External tracker API returned HTTP ${response.status}.`,
      userAction: 'Try again; if this persists, report the board response shape.',
    },
  };
}
