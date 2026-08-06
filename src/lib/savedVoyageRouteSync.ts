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

export function shouldDeferExplicitRouteCanonicalization({
  routeChanged,
  queryVoyageEntryId,
  sessionNavActiveVoyageEntryId,
}: {
  routeChanged: boolean;
  queryVoyageEntryId?: string;
  sessionNavActiveVoyageEntryId?: string;
}): boolean {
  return Boolean(
    routeChanged &&
      queryVoyageEntryId &&
      sessionNavActiveVoyageEntryId &&
      queryVoyageEntryId !== sessionNavActiveVoyageEntryId,
  );
}
