import _20260702000000_external_integrations from '../migrations/20260702000000_external_integrations/migration';
import _20260702010000_external_issue_workspace_mappings from '../migrations/20260702010000_external_issue_workspace_mappings/migration';
import _20260702020000_external_repo_project_mappings from '../migrations/20260702020000_external_repo_project_mappings/migration';
import _20260804220000_external_repo_project_mapping_site_scope from '../migrations/20260804220000_external_repo_project_mapping_site_scope/migration';
import _20260917000000_normalized_voyages from '../migrations/20260917000000_normalized_voyages/migration';

export const databaseVersion = 4;

export const migrations = [
  { name: '20260702000000_external_integrations', migration: _20260702000000_external_integrations },
  { name: '20260702010000_external_issue_workspace_mappings', migration: _20260702010000_external_issue_workspace_mappings },
  { name: '20260702020000_external_repo_project_mappings', migration: _20260702020000_external_repo_project_mappings },
  { name: '20260804220000_external_repo_project_mapping_site_scope', migration: _20260804220000_external_repo_project_mapping_site_scope },
  { name: '20260917000000_normalized_voyages', migration: _20260917000000_normalized_voyages },
] as const;
