import { describe, expect, it } from 'vitest';
import {
  activateVoyageEntryInLayout,
  canTileVoyageEntry,
  createVoyageLayoutFromEntries,
  findVoyageEntryInLayout,
  flattenVoyageLayoutEntries,
  moveVoyageEntryToSubVoyageCell,
  normalizeVoyageLayout,
  removeVoyageEntryFromLayout,
  reorderVoyageEntryInLayout,
  upsertVoyageEntryInLayout,
} from './sessionState';
import type { VoyageEntry, VoyageLayout, WorkspaceState } from './types';

function workspace(): WorkspaceState {
  return {
    nextId: 1,
    spaces: [
      {
        id: 'space_home',
        name: 'Home',
        icon: '🏠',
        tabGroupIds: ['craft_1', 'craft_2', 'craft_3', 'craft_4', 'craft_5', 'craft_6'],
      },
    ],
    tabGroups: Array.from({ length: 6 }, (_, index) => {
      const id = `craft_${index + 1}`;
      return {
        id,
        label: `Craft ${index + 1}`,
        order: index,
        tabs: [{ id: `tab_${index + 1}`, title: `Tab ${index + 1}`, url: `/tab-${index + 1}` }],
        pairs: [],
      };
    }),
  };
}

function entry(index: number): VoyageEntry {
  return {
    id: `entry_${index}`,
    tabGroupId: `craft_${index}`,
    viewIds: [`tab_${index}`],
  };
}

describe('SubVoyage tiling state', () => {
  it('starts with all Voyage Entry tabs in the top-left SubVoyage cell', () => {
    const layout = createVoyageLayoutFromEntries(
      workspace(),
      [entry(1), entry(2)],
      'entry_2',
    );

    expect(layout).toMatchObject({
      rows: 1,
      cols: 1,
      activeCellId: 'cell_main',
      cells: [
        {
          id: 'cell_main',
          row: 0,
          col: 0,
          activeVoyageEntryId: 'entry_2',
        },
      ],
    });
    expect(layout.cells[0]?.voyageEntries.map((candidate) => candidate.id)).toEqual([
      'entry_1',
      'entry_2',
    ]);
  });

  it('moves an entry from a multi-tab cell into the exact corner SubVoyage cell', () => {
    const baseLayout = createVoyageLayoutFromEntries(
      workspace(),
      [entry(1), entry(2), entry(3)],
      'entry_1',
    );

    const nextLayout = moveVoyageEntryToSubVoyageCell(
      workspace(),
      baseLayout,
      'entry_2',
      'bottom-right',
    );

    expect(nextLayout.cells).toHaveLength(2);
    expect(nextLayout.rows).toBe(2);
    expect(nextLayout.cols).toBe(2);
    expect(nextLayout.activeCellId).toBe('cell_2');
    const originalCell = nextLayout.cells.find((cell) => cell.id === 'cell_main');
    const tiledCell = nextLayout.cells.find((cell) => cell.id === 'cell_2');
    expect(originalCell?.voyageEntries.map((candidate) => candidate.id)).toEqual([
      'entry_1',
      'entry_3',
    ]);
    expect(tiledCell).toMatchObject({
      id: 'cell_2',
      row: 1,
      col: 1,
      activeVoyageEntryId: 'entry_2',
    });
  });

  it('places top-left drops at the top-left and shifts existing cells deterministically', () => {
    const baseLayout = createVoyageLayoutFromEntries(
      workspace(),
      [entry(1), entry(2), entry(3)],
      'entry_1',
    );

    const nextLayout = moveVoyageEntryToSubVoyageCell(
      workspace(),
      baseLayout,
      'entry_2',
      'top-left',
    );

    expect(nextLayout.rows).toBe(2);
    expect(nextLayout.cols).toBe(2);
    expect(nextLayout.cells.find((cell) => cell.id === 'cell_2')).toMatchObject({
      row: 0,
      col: 0,
      activeVoyageEntryId: 'entry_2',
    });
    expect(nextLayout.cells.find((cell) => cell.id === 'cell_main')).toMatchObject({
      row: 0,
      col: 1,
    });
  });

  it('does not clone the only entry in a cell because duplicate visible entries would share one iframe DOM node', () => {
    const baseLayout = createVoyageLayoutFromEntries(
      workspace(),
      [entry(1)],
      'entry_1',
    );

    const nextLayout = moveVoyageEntryToSubVoyageCell(
      workspace(),
      baseLayout,
      'entry_1',
      'right',
    );

    expect(nextLayout.cells).toHaveLength(1);
    expect(nextLayout.activeCellId).toBe('cell_main');
    expect(nextLayout.cells[0]?.voyageEntries.map((candidate) => candidate.id)).toEqual([
      'entry_1',
    ]);
    expect(canTileVoyageEntry(baseLayout, 'entry_1')).toEqual({
      canTile: false,
      reason: 'sole-entry',
    });
  });

  it('reports max-pane tiling as invalid before silently exceeding the grid', () => {
    const fullLayout = normalizeVoyageLayout(
      workspace(),
      {
        version: 1,
        rows: 2,
        cols: 3,
        activeCellId: 'cell_1',
        cells: Array.from({ length: 6 }, (_, index) => ({
          id: `cell_${index + 1}`,
          row: Math.floor(index / 3),
          col: index % 3,
          activeVoyageEntryId: `entry_${index + 1}`,
          voyageEntries: [entry(index + 1)],
        })),
      },
      [entry(1)],
      'entry_1',
    );

    expect(canTileVoyageEntry(fullLayout, 'entry_1')).toEqual({
      canTile: false,
      reason: 'max-panes',
    });
  });

  it('adds a saved-session craft to the active cell and flattens from layout', () => {
    const baseLayout = createVoyageLayoutFromEntries(workspace(), [entry(1)], 'entry_1');

    const nextLayout = upsertVoyageEntryInLayout(workspace(), baseLayout, entry(2));

    expect(nextLayout.cells[0]?.voyageEntries.map((candidate) => candidate.id)).toEqual([
      'entry_1',
      'entry_2',
    ]);
    expect(flattenVoyageLayoutEntries(nextLayout).map((candidate) => candidate.id)).toEqual([
      'entry_1',
      'entry_2',
    ]);
  });

  it('removes entries from their owning saved-session cell without resurrecting them', () => {
    const tiledLayout = moveVoyageEntryToSubVoyageCell(
      workspace(),
      createVoyageLayoutFromEntries(workspace(), [entry(1), entry(2), entry(3)], 'entry_1'),
      'entry_2',
      'right',
    );

    const nextLayout = removeVoyageEntryFromLayout(workspace(), tiledLayout, 'entry_2');

    expect(findVoyageEntryInLayout(nextLayout, 'entry_2')).toBeUndefined();
    expect(nextLayout.cells.some((cell) => cell.id === 'cell_2')).toBe(false);
    expect(flattenVoyageLayoutEntries(nextLayout).map((candidate) => candidate.id)).toEqual([
      'entry_1',
      'entry_3',
    ]);
  });

  it('reorders entries inside their owning saved-session cell', () => {
    const baseLayout = createVoyageLayoutFromEntries(
      workspace(),
      [entry(1), entry(2), entry(3)],
      'entry_1',
    );

    const nextLayout = reorderVoyageEntryInLayout(
      workspace(),
      baseLayout,
      'entry_3',
      'entry_1',
    );

    expect(nextLayout.cells[0]?.voyageEntries.map((candidate) => candidate.id)).toEqual([
      'entry_3',
      'entry_1',
      'entry_2',
    ]);
  });

  it('activates an entry in a non-active cell when resuming or deep-linking', () => {
    const tiledLayout = moveVoyageEntryToSubVoyageCell(
      workspace(),
      createVoyageLayoutFromEntries(workspace(), [entry(1), entry(2), entry(3)], 'entry_1'),
      'entry_2',
      'right',
    );
    const inactiveMainLayout = activateVoyageEntryInLayout(workspace(), tiledLayout, 'entry_1');

    const nextLayout = activateVoyageEntryInLayout(workspace(), inactiveMainLayout, 'entry_2');

    expect(nextLayout.activeCellId).toBe('cell_2');
    expect(nextLayout.cells.find((cell) => cell.id === 'cell_2')?.activeVoyageEntryId).toBe('entry_2');
  });

  it('moves an entry from a tiled saved Voyage into another tiled saved Voyage using canonical layouts', () => {
    const sourceLayout = moveVoyageEntryToSubVoyageCell(
      workspace(),
      createVoyageLayoutFromEntries(workspace(), [entry(1), entry(2), entry(3)], 'entry_1'),
      'entry_2',
      'right',
    );
    const targetLayout = moveVoyageEntryToSubVoyageCell(
      workspace(),
      createVoyageLayoutFromEntries(
        workspace(),
        [
          entry(4),
          entry(5),
          { ...entry(6), id: 'entry_2' },
        ],
        'entry_4',
      ),
      'entry_5',
      'bottom-right',
    );
    const movedEntry = {
      ...findVoyageEntryInLayout(sourceLayout, 'entry_2')!.entry,
      id: 'entry_2_moved_1',
    };

    const nextSourceLayout = removeVoyageEntryFromLayout(workspace(), sourceLayout, 'entry_2');
    const nextTargetLayout = activateVoyageEntryInLayout(
      workspace(),
      upsertVoyageEntryInLayout(workspace(), targetLayout, movedEntry),
      movedEntry.id,
    );

    expect(findVoyageEntryInLayout(nextSourceLayout, 'entry_2')).toBeUndefined();
    expect(flattenVoyageLayoutEntries(nextSourceLayout).map((candidate) => candidate.id)).toEqual([
      'entry_1',
      'entry_3',
    ]);
    expect(flattenVoyageLayoutEntries(nextSourceLayout)).toEqual(
      nextSourceLayout.cells.flatMap((cell) => cell.voyageEntries),
    );

    expect(findVoyageEntryInLayout(nextTargetLayout, movedEntry.id)?.entry).toMatchObject({
      id: 'entry_2_moved_1',
      tabGroupId: 'craft_2',
    });
    expect(nextTargetLayout.activeCellId).toBe('cell_2');
    expect(nextTargetLayout.cells.find((cell) => cell.id === 'cell_2')?.activeVoyageEntryId).toBe(
      movedEntry.id,
    );
    expect(flattenVoyageLayoutEntries(nextTargetLayout).map((candidate) => candidate.id)).toEqual([
      'entry_4',
      'entry_2',
      'entry_5',
      'entry_2_moved_1',
    ]);
    expect(flattenVoyageLayoutEntries(nextTargetLayout)).toEqual(
      nextTargetLayout.cells.flatMap((cell) => cell.voyageEntries),
    );
  });

  it('opens or updates a VK workspace craft inside a tiled saved Voyage layout', () => {
    const tiledLayout = moveVoyageEntryToSubVoyageCell(
      workspace(),
      createVoyageLayoutFromEntries(workspace(), [entry(1), entry(2), entry(3)], 'entry_1'),
      'entry_2',
      'right',
    );
    const vkEntry: VoyageEntry = {
      id: 'entry_vk',
      tabGroupId: 'craft_4',
      viewIds: ['tab_4'],
    };

    const nextLayout = activateVoyageEntryInLayout(
      workspace(),
      upsertVoyageEntryInLayout(workspace(), tiledLayout, vkEntry),
      vkEntry.id,
    );
    const owningCell = nextLayout.cells.find((cell) =>
      cell.voyageEntries.some((candidate) => candidate.id === vkEntry.id),
    );

    expect(owningCell).toBeDefined();
    expect(nextLayout.activeCellId).toBe(owningCell?.id);
    expect(owningCell?.activeVoyageEntryId).toBe(vkEntry.id);
    expect(findVoyageEntryInLayout(nextLayout, vkEntry.id)?.entry).toMatchObject(vkEntry);
    expect(flattenVoyageLayoutEntries(nextLayout)).toEqual(
      nextLayout.cells.flatMap((cell) => cell.voyageEntries),
    );
  });

  it('normalizes persisted layouts to a maximum 3x2 grid with valid craft entries', () => {
    const staleLayout: VoyageLayout = {
      version: 1,
      rows: 3,
      cols: 3,
      activeCellId: 'missing_cell',
      cells: [
        ...Array.from({ length: 6 }, (_, index) => ({
          id: `cell_${index + 1}`,
          row: index,
          col: index,
          activeVoyageEntryId: `entry_${index + 1}`,
          voyageEntries: [entry(index + 1)],
        })),
        {
          id: 'extra_cell',
          row: 9,
          col: 9,
          activeVoyageEntryId: 'stale',
          voyageEntries: [{ id: 'stale', tabGroupId: 'deleted', viewIds: ['deleted'] }],
        },
      ],
    };

    const normalized = normalizeVoyageLayout(
      workspace(),
      staleLayout,
      [entry(1)],
      'entry_1',
    );

    expect(normalized.cells).toHaveLength(6);
    expect(normalized.rows).toBe(2);
    expect(normalized.cols).toBe(3);
    expect(normalized.activeCellId).toBe('cell_1');
    expect(normalized.cells.map((cell) => [cell.row, cell.col])).toEqual([
      [0, 0],
      [0, 1],
      [0, 2],
      [1, 0],
      [1, 1],
      [1, 2],
    ]);
  });
});
