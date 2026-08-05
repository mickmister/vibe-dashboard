export function shouldDeferStaleRouteNavPersistence({
  routeUnchanged,
  savedSessionChanged,
  savedSessionActiveVoyageEntryId,
  sessionNavActiveVoyageEntryId,
}: {
  routeUnchanged: boolean;
  savedSessionChanged: boolean;
  savedSessionActiveVoyageEntryId?: string;
  sessionNavActiveVoyageEntryId?: string;
}): boolean {
  return Boolean(
    routeUnchanged &&
      savedSessionChanged &&
      savedSessionActiveVoyageEntryId &&
      sessionNavActiveVoyageEntryId &&
      savedSessionActiveVoyageEntryId !== sessionNavActiveVoyageEntryId,
  );
}
