export default `
DROP INDEX IF EXISTS "ExternalRepoProjectMapping_repoId_provider_key";

CREATE UNIQUE INDEX IF NOT EXISTS "ExternalRepoProjectMapping_repoId_provider_siteHostname_key" ON "ExternalRepoProjectMapping"("repoId", "provider", "siteHostname");
`;
