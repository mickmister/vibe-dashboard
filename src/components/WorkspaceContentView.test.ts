import { describe, expect, it, vi } from 'vitest';
import {
  getSubVoyageDropTarget,
  getTileDropInvalidReasonLabel,
  selectSubVoyageAgentTab,
  selectSubVoyageBeadFormsTab,
} from './WorkspaceContentView';

describe('getSubVoyageDropTarget', () => {
  const rect = { left: 100, top: 50, width: 300, height: 180 };

  it('maps side and corner hover regions to SubVoyage drop targets', () => {
    expect(getSubVoyageDropTarget(rect, { x: 110, y: 60 })).toBe('top-left');
    expect(getSubVoyageDropTarget(rect, { x: 390, y: 60 })).toBe('top-right');
    expect(getSubVoyageDropTarget(rect, { x: 110, y: 220 })).toBe('bottom-left');
    expect(getSubVoyageDropTarget(rect, { x: 390, y: 220 })).toBe('bottom-right');
    expect(getSubVoyageDropTarget(rect, { x: 110, y: 140 })).toBe('left');
    expect(getSubVoyageDropTarget(rect, { x: 390, y: 140 })).toBe('right');
    expect(getSubVoyageDropTarget(rect, { x: 250, y: 60 })).toBe('top');
    expect(getSubVoyageDropTarget(rect, { x: 250, y: 220 })).toBe('bottom');
  });

  it('defaults a center hover to the right side', () => {
    expect(getSubVoyageDropTarget(rect, { x: 250, y: 140 })).toBe('right');
  });
});

describe('getTileDropInvalidReasonLabel', () => {
  it('explains invalid tile drops instead of presenting a valid no-op dropzone', () => {
    expect(getTileDropInvalidReasonLabel('max-panes')).toContain('Maximum');
    expect(getTileDropInvalidReasonLabel('sole-entry')).toContain('Add another tab');
    expect(getTileDropInvalidReasonLabel('missing-entry')).toContain('no longer available');
  });
});

describe('SubVoyage BeadsForm handlers', () => {
  it('opens a bead form and selects the Forms tab in the owning SubVoyage cell', async () => {
    const openFormsForBead = vi.fn().mockResolvedValue({
      tabGroupId: 'craft_group',
      formsTabId: 'forms',
    });
    const selectSubVoyageCellTab = vi.fn();

    await selectSubVoyageBeadFormsTab({
      actions: { openFormsForBead },
      sessionActions: { selectSubVoyageCellTab },
      cellId: 'cell_2',
      voyageEntryId: 'entry_2',
      tabGroupId: 'craft_group',
      agentTabId: 'agent',
      beadId: 'vkvw-mu02',
    });

    expect(openFormsForBead).toHaveBeenCalledWith({
      tabGroupId: 'craft_group',
      agentTabId: 'agent',
      beadId: 'vkvw-mu02',
    });
    expect(selectSubVoyageCellTab).toHaveBeenCalledWith(
      'cell_2',
      'entry_2',
      'craft_group',
      'forms',
    );
  });

  it('does not change the SubVoyage cell selection when opening a bead form fails', async () => {
    const openFormsForBead = vi.fn().mockResolvedValue(undefined);
    const selectSubVoyageCellTab = vi.fn();

    await selectSubVoyageBeadFormsTab({
      actions: { openFormsForBead },
      sessionActions: { selectSubVoyageCellTab },
      cellId: 'cell_2',
      voyageEntryId: 'entry_2',
      tabGroupId: 'craft_group',
      agentTabId: 'agent',
      beadId: 'vkvw-mu02',
    });

    expect(selectSubVoyageCellTab).not.toHaveBeenCalled();
  });

  it('returns the owning SubVoyage cell to the built-in Agent tab after form submission', () => {
    const selectSubVoyageCellTab = vi.fn();

    selectSubVoyageAgentTab({
      sessionActions: { selectSubVoyageCellTab },
      cellId: 'cell_2',
      voyageEntryId: 'entry_2',
      tabGroupId: 'craft_group',
    });

    expect(selectSubVoyageCellTab).toHaveBeenCalledWith(
      'cell_2',
      'entry_2',
      'craft_group',
      'agent',
    );
  });
});
