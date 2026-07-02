import type { ColumnType, Generated } from 'kysely';

export type Timestamp = ColumnType<Date, Date | string, Date | string>;
export type NullableTimestamp = ColumnType<Date | null, Date | string | null | undefined, Date | string | null | undefined>;
export type SqliteBoolean = ColumnType<boolean, boolean | number, boolean | number>;

export type ExternalProvider = 'jira' | 'github' | 'linear';

export interface BetterAuthUser {
  id: string;
  name: string;
  email: string;
  emailVerified: SqliteBoolean;
  image: string | null;
  createdAt: Generated<Timestamp>;
  updatedAt: Generated<Timestamp>;
}

export interface BetterAuthSession {
  id: string;
  userId: string;
  token: string;
  expiresAt: Timestamp;
  ipAddress: string | null;
  userAgent: string | null;
  createdAt: Generated<Timestamp>;
  updatedAt: Generated<Timestamp>;
}

export interface BetterAuthAccount {
  id: string;
  userId: string;
  accountId: string;
  providerId: string;
  accessToken: string | null;
  refreshToken: string | null;
  accessTokenExpiresAt: NullableTimestamp;
  refreshTokenExpiresAt: NullableTimestamp;
  scope: string | null;
  idToken: string | null;
  password: string | null;
  createdAt: Generated<Timestamp>;
  updatedAt: Generated<Timestamp>;
}

export interface BetterAuthVerification {
  id: string;
  identifier: string;
  value: string;
  expiresAt: Timestamp;
  createdAt: Generated<NullableTimestamp>;
  updatedAt: Generated<NullableTimestamp>;
}

export interface ExternalProviderConnection {
  id: string;
  userId: string;
  provider: ExternalProvider;
  betterAuthAccountId: string;
  providerAccountId: string;
  displayName: string | null;
  resourceMetadataJson: string | null;
  createdAt: Generated<Timestamp>;
  updatedAt: Generated<Timestamp>;
}

export interface Migration {
  id: Generated<number>;
  name: string;
  createdAt: Generated<string>;
}

export interface DB {
  BetterAuthUser: BetterAuthUser;
  BetterAuthSession: BetterAuthSession;
  BetterAuthAccount: BetterAuthAccount;
  BetterAuthVerification: BetterAuthVerification;
  ExternalProviderConnection: ExternalProviderConnection;
  Migration: Migration;
}
