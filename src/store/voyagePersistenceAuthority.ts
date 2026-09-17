import {
  getExternalIntegrationsDb,
  type ExternalIntegrationsDbHandle,
} from '../modules/plugins/kanban/server/database';
import { LEGACY_VOYAGE_MIGRATION_ID } from './db/data_migrations/20260917100000_migrate_legacy_voyages';
import {
  createProductionPanelTargetContextProvider,
  createProductionPanelTargetAuthorityServices,
  type ProductionPanelTargetAuthorityServices,
} from './productionPanelTargetAuthority';
import type { LegacyTargetContextForCraft } from './db/data_migrations/20260917100000_migrate_legacy_voyages';

export type VoyagePersistenceAuthorityHandle = ExternalIntegrationsDbHandle & { legacyTargetContextForCraft?: LegacyTargetContextForCraft };

/**
 * Application startup gate for the one-way Voyage authority cutover.
 * Callers receive no database handle until schema/data migrations and the
 * durable completion ledger have succeeded.
 */
export async function initializeVoyagePersistenceAuthority(
  openDatabase?: () => Promise<ExternalIntegrationsDbHandle>,
  authorityServices: ProductionPanelTargetAuthorityServices = createProductionPanelTargetAuthorityServices(),
): Promise<VoyagePersistenceAuthorityHandle> {
  let productionProvider: LegacyTargetContextForCraft | undefined;
  const open = openDatabase ?? (async () => {
    const legacyTargetContextForCraft = await createProductionPanelTargetContextProvider(authorityServices);
    productionProvider = legacyTargetContextForCraft;
    return getExternalIntegrationsDb({ services: { legacyTargetContextForCraft } });
  });
  const handle = await open();
  const completed = handle.sqlite.prepare('SELECT 1 AS completed FROM Migration WHERE name = ?')
    .get(LEGACY_VOYAGE_MIGRATION_ID) as { completed: number } | undefined;
  if (completed?.completed !== 1) {
    throw Object.assign(new Error('Normalized Voyage persistence cutover is incomplete'), { code: 'VOYAGE_CUTOVER_INCOMPLETE' });
  }
  return productionProvider ? Object.assign(handle, { legacyTargetContextForCraft: productionProvider }) : handle;
}
