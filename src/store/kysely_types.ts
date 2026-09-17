import type { ColumnType } from "kysely";
export type Generated<T> = T extends ColumnType<infer S, infer I, infer U>
  ? ColumnType<S, I | undefined, U>
  : ColumnType<T, T | undefined, T>;
export type Timestamp = ColumnType<Date, Date | string, Date | string>;

export const ExternalProvider = {
    jira: "jira",
    github: "github",
    linear: "linear"
} as const;
export type ExternalProvider = (typeof ExternalProvider)[keyof typeof ExternalProvider];
export type BetterAuthAccount = {
    id: string;
    userId: string;
    accountId: string;
    providerId: string;
    accessToken: string | null;
    refreshToken: string | null;
    accessTokenExpiresAt: string | null;
    refreshTokenExpiresAt: string | null;
    scope: string | null;
    idToken: string | null;
    password: string | null;
    createdAt: Generated<string>;
    updatedAt: Generated<string>;
};
export type BetterAuthSession = {
    id: string;
    userId: string;
    token: string;
    expiresAt: string;
    ipAddress: string | null;
    userAgent: string | null;
    createdAt: Generated<string>;
    updatedAt: Generated<string>;
};
export type BetterAuthUser = {
    id: string;
    name: string;
    email: string;
    emailVerified: Generated<number>;
    image: string | null;
    createdAt: Generated<string>;
    updatedAt: Generated<string>;
};
export type BetterAuthVerification = {
    id: string;
    identifier: string;
    value: string;
    expiresAt: string;
    createdAt: Generated<string | null>;
    updatedAt: Generated<string | null>;
};
export type ExternalIssue = {
    id: string;
    provider: ExternalProvider;
    issueKey: string;
    issueId: string | null;
    issueUrl: string;
    site: string | null;
    metadataJson: string | null;
    createdAt: Generated<string>;
    updatedAt: Generated<string>;
};
export type ExternalIssueWorkspaceLink = {
    id: string;
    externalIssueId: string;
    vkWorkspaceId: string;
    isPrimary: Generated<number>;
    lastOpenedAt: string | null;
    metadataJson: string | null;
    createdAt: Generated<string>;
    updatedAt: Generated<string>;
};
export type ExternalProviderConnection = {
    id: string;
    userId: string;
    provider: ExternalProvider;
    betterAuthAccountId: string;
    providerAccountId: string;
    displayName: string | null;
    resourceMetadataJson: string | null;
    createdAt: Generated<string>;
    updatedAt: Generated<string>;
};
export type ExternalRepoProjectMapping = {
    id: string;
    repoId: string;
    repoName: string | null;
    provider: ExternalProvider;
    siteHostname: string;
    projectKey: string;
    issueTypeName: string | null;
    metadataJson: string | null;
    createdAt: Generated<string>;
    updatedAt: Generated<string>;
};
export type Migration = {
    id: Generated<number>;
    name: string;
    createdAt: Generated<string>;
};
export type VKWorkspace = {
    id: string;
    workspaceId: string;
    workspaceDir: string | null;
    displayName: string | null;
    metadataJson: string | null;
    createdAt: Generated<string>;
    updatedAt: Generated<string>;
};
export type Voyage = {
    id: string;
    schemaVersion: Generated<number>;
    revision: Generated<number>;
    activationSequence: Generated<number>;
    historyCursorSequence: number | null;
    name: string;
    mission: string | null;
    lifecycleState: Generated<string>;
    createdAt: Generated<string>;
    updatedAt: Generated<string>;
    lastOpenedAt: string | null;
};
export type VoyageCraft = {
    voyageId: string;
    /**
     * External Vibe Kanban workspace logical ID. This intentionally has no
     * database foreign key to VKWorkspace: VK workspaces may live outside this
     * database and their lifecycle is independent from Voyage persistence.
     */
    craftWorkspaceId: string;
    sortKey: string;
    createdAt: Generated<string>;
    updatedAt: Generated<string>;
};
export type VoyageHistory = {
    id: string;
    voyageId: string;
    sequence: number;
    aggregateRevision: number;
    panelsJson: string;
    snapshotJson: string;
    createdAt: Generated<string>;
};
export type VoyageLayout = {
    voyageId: string;
    formatVersion: number;
    dockviewVersion: string;
    aggregateRevision: number;
    snapshotJson: string;
    snapshotHash: string;
    updatedAt: Generated<string>;
};
export type VoyageLayoutQuarantine = {
    id: string;
    voyageId: string;
    sourceRevision: number;
    reasonCode: string;
    rejectedSnapshotJson: string;
    createdAt: Generated<string>;
    resolvedAt: string | null;
};
export type VoyageMigrationDiagnostic = {
    id: string;
    migrationName: string;
    voyageId: string | null;
    sourceKind: string;
    sourceId: string | null;
    outcome: string;
    reasonCode: string;
    detailsJson: string | null;
    createdAt: Generated<string>;
};
export type VoyagePanel = {
    id: string;
    voyageId: string;
    craftWorkspaceId: string | null;
    targetKind: string;
    targetVersion: number;
    targetPayloadJson: string;
    titleMode: string;
    customTitle: string | null;
    closePolicy: string;
    lastActivatedSequence: number | null;
    createdAt: Generated<string>;
    updatedAt: Generated<string>;
};
export type VoyageSettings = {
    singletonKey: Generated<string>;
    warmVoyageLimit: Generated<number>;
    iframeRuntimeLimit: Generated<number>;
    historyLimit: Generated<number>;
    updatedAt: Generated<string>;
};
export type DB = {
    BetterAuthAccount: BetterAuthAccount;
    BetterAuthSession: BetterAuthSession;
    BetterAuthUser: BetterAuthUser;
    BetterAuthVerification: BetterAuthVerification;
    ExternalIssue: ExternalIssue;
    ExternalIssueWorkspaceLink: ExternalIssueWorkspaceLink;
    ExternalProviderConnection: ExternalProviderConnection;
    ExternalRepoProjectMapping: ExternalRepoProjectMapping;
    Migration: Migration;
    VKWorkspace: VKWorkspace;
    Voyage: Voyage;
    VoyageCraft: VoyageCraft;
    VoyageHistory: VoyageHistory;
    VoyageLayout: VoyageLayout;
    VoyageLayoutQuarantine: VoyageLayoutQuarantine;
    VoyageMigrationDiagnostic: VoyageMigrationDiagnostic;
    VoyagePanel: VoyagePanel;
    VoyageSettings: VoyageSettings;
};
