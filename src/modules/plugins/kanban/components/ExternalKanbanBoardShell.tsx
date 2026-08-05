import React from 'react';
import { Chip } from '@heroui/react';
import type { ExternalKanbanCardDto, ExternalKanbanColumnDto } from '../boardTypes';

export function ExternalKanbanBoardShell({
  children,
  sidePanel,
  overlays,
}: {
  children: React.ReactNode;
  sidePanel?: React.ReactNode;
  overlays?: React.ReactNode;
}) {
  return (
    <main className="dark h-dvh overflow-y-auto overscroll-contain bg-neutral-950 text-neutral-100">
      <div className="flex min-h-full flex-col lg:flex-row">
        <div className="min-w-0 flex-1">{children}</div>
        {sidePanel ?? null}
      </div>
      {overlays ?? null}
    </main>
  );
}

export function ExternalKanbanColumns({
  columns,
  cards,
  renderCard,
  emptyLabel = 'No issues',
}: {
  columns: ExternalKanbanColumnDto[];
  cards: ExternalKanbanCardDto[];
  renderCard: (card: ExternalKanbanCardDto) => React.ReactNode;
  emptyLabel?: string;
}) {
  const renderColumns = withImplicitUnmappedColumn(columns, cards);
  const knownColumnIds = new Set(renderColumns.map((column) => column.id));
  return (
    <div className="grid auto-cols-[minmax(18rem,1fr)] grid-flow-col gap-4 overflow-x-auto pb-2">
      {renderColumns.map((column) => {
        const columnCards = cards.filter((card) => isCardInColumn(card, column, knownColumnIds));
        return (
          <section key={column.id} className="min-w-72 rounded-xl border border-neutral-800 bg-neutral-900/80">
            <div className="flex items-center justify-between border-b border-neutral-800 px-4 py-3">
              <h3 className="text-sm font-semibold text-neutral-100">{column.title}</h3>
              <Chip size="sm" variant="flat" className="bg-neutral-800 text-neutral-300">{columnCards.length}</Chip>
            </div>
            <div className="space-y-3 p-3">
              {columnCards.length === 0 ? <div className="rounded-lg border border-dashed border-neutral-800 p-3 text-sm text-neutral-500">{emptyLabel}</div> : null}
              {columnCards.map((card) => <React.Fragment key={card.id}>{renderCard(card)}</React.Fragment>)}
            </div>
          </section>
        );
      })}
    </div>
  );
}

function withImplicitUnmappedColumn(columns: ExternalKanbanColumnDto[], cards: ExternalKanbanCardDto[]): ExternalKanbanColumnDto[] {
  const knownColumnIds = new Set(columns.map((column) => column.id));
  if (knownColumnIds.has('unmapped')) return columns;
  const needsUnmapped = cards.some((card) => {
    if (card.columnId) return !knownColumnIds.has(card.columnId);
    if (card.statusId) return !columns.some((column) => column.statusIds.includes(card.statusId as string));
    return true;
  });
  if (!needsUnmapped) return columns;
  return [...columns, { id: 'unmapped', title: 'Unmapped', statusIds: [] }];
}

function isCardInColumn(card: ExternalKanbanCardDto, column: ExternalKanbanColumnDto, knownColumnIds: Set<string>): boolean {
  if (card.columnId) {
    if (knownColumnIds.has(card.columnId)) return card.columnId === column.id;
    return column.id === 'unmapped';
  }
  if (card.statusId && column.statusIds.includes(card.statusId)) return true;
  return column.id === 'unmapped';
}
