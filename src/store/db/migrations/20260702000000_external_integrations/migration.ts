export default `
CREATE TABLE IF NOT EXISTS "BetterAuthUser" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "name" TEXT NOT NULL,
  "email" TEXT NOT NULL,
  "emailVerified" INTEGER NOT NULL DEFAULT 0,
  "image" TEXT,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS "BetterAuthUser_email_key" ON "BetterAuthUser"("email");

CREATE TABLE IF NOT EXISTS "BetterAuthSession" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "userId" TEXT NOT NULL,
  "token" TEXT NOT NULL,
  "expiresAt" DATETIME NOT NULL,
  "ipAddress" TEXT,
  "userAgent" TEXT,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "BetterAuthSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "BetterAuthUser" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "BetterAuthSession_token_key" ON "BetterAuthSession"("token");
CREATE INDEX IF NOT EXISTS "BetterAuthSession_userId_idx" ON "BetterAuthSession"("userId");
CREATE INDEX IF NOT EXISTS "BetterAuthSession_expiresAt_idx" ON "BetterAuthSession"("expiresAt");

CREATE TABLE IF NOT EXISTS "BetterAuthAccount" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "userId" TEXT NOT NULL,
  "accountId" TEXT NOT NULL,
  "providerId" TEXT NOT NULL,
  "accessToken" TEXT,
  "refreshToken" TEXT,
  "accessTokenExpiresAt" DATETIME,
  "refreshTokenExpiresAt" DATETIME,
  "scope" TEXT,
  "idToken" TEXT,
  "password" TEXT,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "BetterAuthAccount_userId_fkey" FOREIGN KEY ("userId") REFERENCES "BetterAuthUser" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "BetterAuthAccount_providerId_accountId_key" ON "BetterAuthAccount"("providerId", "accountId");
CREATE INDEX IF NOT EXISTS "BetterAuthAccount_userId_idx" ON "BetterAuthAccount"("userId");
CREATE INDEX IF NOT EXISTS "BetterAuthAccount_providerId_idx" ON "BetterAuthAccount"("providerId");

CREATE TABLE IF NOT EXISTS "BetterAuthVerification" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "identifier" TEXT NOT NULL,
  "value" TEXT NOT NULL,
  "expiresAt" DATETIME NOT NULL,
  "createdAt" DATETIME DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS "BetterAuthVerification_identifier_idx" ON "BetterAuthVerification"("identifier");
CREATE INDEX IF NOT EXISTS "BetterAuthVerification_expiresAt_idx" ON "BetterAuthVerification"("expiresAt");

CREATE TABLE IF NOT EXISTS "ExternalProviderConnection" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "userId" TEXT NOT NULL,
  "provider" TEXT NOT NULL CHECK ("provider" IN ('jira', 'github', 'linear')),
  "betterAuthAccountId" TEXT NOT NULL,
  "providerAccountId" TEXT NOT NULL,
  "displayName" TEXT,
  "resourceMetadataJson" TEXT,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ExternalProviderConnection_userId_fkey" FOREIGN KEY ("userId") REFERENCES "BetterAuthUser" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "ExternalProviderConnection_betterAuthAccountId_fkey" FOREIGN KEY ("betterAuthAccountId") REFERENCES "BetterAuthAccount" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "ExternalProviderConnection_provider_providerAccountId_key" ON "ExternalProviderConnection"("provider", "providerAccountId");
CREATE INDEX IF NOT EXISTS "ExternalProviderConnection_userId_idx" ON "ExternalProviderConnection"("userId");
CREATE INDEX IF NOT EXISTS "ExternalProviderConnection_provider_idx" ON "ExternalProviderConnection"("provider");
CREATE INDEX IF NOT EXISTS "ExternalProviderConnection_betterAuthAccountId_idx" ON "ExternalProviderConnection"("betterAuthAccountId");
`;
