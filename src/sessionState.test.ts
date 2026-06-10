import { describe, expect, it } from 'vitest';
import {
  createVoyageLayoutFromEntries,
  moveVoyageEntryToSubVoyageCell,
  normalizeVoyageLayout,
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

  it('moves an entry from a multi-tab cell into a new side/corner SubVoyage cell', () => {
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
    expect(nextLayout.rows).toBe(1);
    expect(nextLayout.cols).toBe(2);
    expect(nextLayout.activeCellId).toBe('cell_2');
    expect(nextLayout.cells[0]?.voyageEntries.map((candidate) => candidate.id)).toEqual([
      'entry_1',
      'entry_3',
    ]);
    expect(nextLayout.cells[1]).toMatchObject({
      id: 'cell_2',
      row: 0,
      col: 1,
      activeVoyageEntryId: 'entry_2',
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
