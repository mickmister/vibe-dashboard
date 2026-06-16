export type DiffSessionCandidate = {
  id: string;
};

export function selectDiffSessionId<T extends DiffSessionCandidate>(
  sessionsInPriorityOrder: T[],
  currentSessionId: string,
): string {
  if (
    currentSessionId &&
    sessionsInPriorityOrder.some((session) => session.id === currentSessionId)
  ) {
    return currentSessionId;
  }

  return sessionsInPriorityOrder[0]?.id ?? '';
}

