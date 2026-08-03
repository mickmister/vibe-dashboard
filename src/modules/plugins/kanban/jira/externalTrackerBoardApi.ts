import { fetchExternalKanbanBoardView } from '../boardApi';
import type {
  ExternalKanbanBoardApiResponse,
  ExternalKanbanBoardViewDto,
  ExternalKanbanCardDto,
  ExternalKanbanColumnDto,
  ExternalKanbanSwimlaneDto,
} from '../boardTypes';
import type { JiraExternalViewLocator } from './externalViewUrl';

export type {
  ExternalKanbanCardDto,
  ExternalKanbanColumnDto,
  ExternalKanbanSwimlaneDto,
};

export interface ExternalJiraBoardDiagnosticsDto {
  authSource?: 'oauth' | 'bot';
  jiraMode: 'agile-board' | 'project-search';
  locatorViewKind: JiraExternalViewLocator['viewKind'];
  siteHostname: string;
  projectKey?: string;
  boardId?: string;
  endpointFamily: 'agile-board' | 'enhanced-search-jql';
  jql?: string;
  issueCount: number;
}

export interface JiraAccessibleResourceDto {
  id: string;
  name: string;
  url: string;
  scopes?: string[];
  avatarUrl?: string;
}

export type ExternalJiraBoardViewDto = ExternalKanbanBoardViewDto<
  'jira',
  JiraAccessibleResourceDto,
  ExternalJiraBoardDiagnosticsDto
>;

export type ExternalJiraBoardApiResponse = ExternalKanbanBoardApiResponse<ExternalJiraBoardViewDto>;

export async function fetchExternalJiraBoardView({
  externalViewUrl,
  fetchImpl = fetch,
}: {
  externalViewUrl: string;
  fetchImpl?: typeof fetch;
}): Promise<ExternalJiraBoardApiResponse> {
  return fetchExternalKanbanBoardView<ExternalJiraBoardViewDto>({
    provider: 'jira',
    externalViewUrl,
    fetchImpl,
  });
}
