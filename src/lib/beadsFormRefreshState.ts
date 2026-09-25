export type BeadsFormRefreshPayload = {
  selected?: unknown;
  workspaceBeads?: unknown;
};

export function workspaceFormsHydrationFingerprint(result: BeadsFormRefreshPayload): string {
  return JSON.stringify({
    selected: result.selected ?? null,
    workspaceBeads: result.workspaceBeads ?? null,
  });
}

export function shouldHydrateRefreshedWorkspaceForms(input: {
  cached: BeadsFormRefreshPayload;
  fresh: BeadsFormRefreshPayload;
  submittedLocked: boolean;
}): boolean {
  if (input.submittedLocked) return false;
  return workspaceFormsHydrationFingerprint(input.cached) !== workspaceFormsHydrationFingerprint(input.fresh);
}
