import type { VoyageRepository } from '../store/voyageRepository';
import {
  assertDockviewM32HarnessActivation,
  assertDockviewM32HarnessLayoutMutation,
  assertDockviewM32HarnessVoyageId,
  createDockviewM32HarnessAggregate,
  dockviewM32HarnessVoyageId,
} from './DockviewM32HarnessFixture';

export function createDockviewM32HarnessActions(voyageRepository: VoyageRepository | undefined) {
  const requireRepository = () => {
    if (!voyageRepository) throw new Error('Normalized Voyage authority is unavailable.');
    return voyageRepository;
  };
  return {
    ensureDockviewM32HarnessVoyage: async () => {
      const repository = requireRepository();
      const aggregate = createDockviewM32HarnessAggregate();
      try {
        return await repository.loadVoyage(aggregate.id);
      } catch {
        await repository.createVoyage({
          id: aggregate.id,
          name: aggregate.metadata.name,
          crafts: aggregate.crafts,
          panels: aggregate.panels.map(({ lastActivatedSequence: _lastActivatedSequence, ...panel }) => panel),
          snapshot: aggregate.layout.snapshot,
        });
        return repository.loadVoyage(aggregate.id);
      }
    },
    commitDockviewM32HarnessLayoutMutation: async (args: Parameters<VoyageRepository['commitLayoutMutation']>[0]) => {
      assertDockviewM32HarnessLayoutMutation(args);
      return requireRepository().commitLayoutMutation(args);
    },
    recordDockviewM32HarnessActivation: async (args: { voyageId: string; panelId: string; expectedRevision: number }) => {
      assertDockviewM32HarnessActivation(args);
      return requireRepository().recordActivation(dockviewM32HarnessVoyageId, args.panelId, args.expectedRevision);
    },
    loadDockviewM32HarnessVoyage: async (args?: { voyageId?: string }) => {
      assertDockviewM32HarnessVoyageId(args?.voyageId);
      return requireRepository().loadVoyage(dockviewM32HarnessVoyageId);
    },
  };
}
