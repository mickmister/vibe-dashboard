import { fetchExternalKanbanBoardView } from '../boardApi';
import type {
  ExternalKanbanBoardApiResponse,
  ExternalKanbanBoardViewDto,
} from '../boardTypes';
import type { LinearExternalViewKind } from './externalViewUrl';

export interface LinearWorkspaceResourceDto {
  id: string;
  name: string;
  url: string;
  key?: string;
}

export interface ExternalLinearBoardDiagnosticsDto {
  authSource: 'api_key';
  linearMode: 'issue' | 'issues' | 'customView' | 'cycle';
  locatorViewKind: LinearExternalViewKind;
  workspaceSlug: string;
  teamKey?: string;
  projectSlugOrId?: string;
  customViewId?: string;
  customViewName?: string;
  customViewLayout?: string;
  customViewGrouping?: string;
  customViewSubGrouping?: string;
  customViewGroupingFidelity?: 'full' | 'partial' | 'none' | 'unknown';
  cycleIdentifier?: string;
  cycleId?: string;
  cycleName?: string;
  cycleNumber?: number;
  cycleStatus?: 'active' | 'none';
  issueCount: number;
}

export type ExternalLinearBoardViewDto = ExternalKanbanBoardViewDto<
  'linear',
  LinearWorkspaceResourceDto,
  ExternalLinearBoardDiagnosticsDto
>;

export type ExternalLinearBoardApiResponse = ExternalKanbanBoardApiResponse<ExternalLinearBoardViewDto>;

export async function fetchExternalLinearBoardView({
  externalViewUrl,
  fetchImpl = fetch,
}: {
  externalViewUrl: string;
  fetchImpl?: typeof fetch;
}): Promise<ExternalLinearBoardApiResponse> {
  return fetchExternalKanbanBoardView<ExternalLinearBoardViewDto>({
    provider: 'linear',
    externalViewUrl,
    fetchImpl,
  });
}
