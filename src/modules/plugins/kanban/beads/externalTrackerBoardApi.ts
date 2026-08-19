import type { ExternalKanbanBoardApiResponse, ExternalKanbanBoardViewDto } from '../boardTypes';

export type ExternalBeadsBoardViewDto = ExternalKanbanBoardViewDto<'beads', {
  id: string;
  name: string;
  url: string;
  sourceDirectory: string;
}, {
  source: 'bd-export';
  cache: 'fresh' | 'cached' | 'stale';
  staleReason?: string;
  lastFetchedAt: string;
  statusSource: 'bd-statuses' | 'export';
  hiddenCompletedCount: number;
}>;
export type ExternalBeadsBoardApiResponse = ExternalKanbanBoardApiResponse<ExternalBeadsBoardViewDto>;

export async function fetchExternalBeadsBoardView({
  sourceDirectory,
  showCompleted,
  refresh,
  fetchImpl = fetch,
}: {
  sourceDirectory?: string;
  showCompleted?: boolean;
  refresh?: boolean;
  fetchImpl?: typeof fetch;
} = {}): Promise<ExternalBeadsBoardApiResponse> {
  const origin = typeof window === 'undefined' ? 'https://dashboard.local' : window.location.origin;
  const url = new URL('/dashboard/api/kanban/beads/board', origin);
  if (sourceDirectory) url.searchParams.set('sourceDirectory', sourceDirectory);
  if (showCompleted) url.searchParams.set('showCompleted', 'true');
  if (refresh) url.searchParams.set('refresh', 'true');

  const response = await fetchImpl(url.pathname + url.search, {
    headers: { accept: 'application/json' },
  });
  const json = await response.json().catch(() => undefined) as ExternalBeadsBoardApiResponse | undefined;
  if (json?.ok === true || json?.ok === false) return json;
  return {
    ok: false,
    error: {
      code: 'beads_board_response_invalid',
      message: `Beads board API returned HTTP ${response.status}.`,
      userAction: 'Try again; if this persists, report the Beads board response shape.',
    },
  };
}
