import { betterAuth } from 'better-auth';
import type Database from 'better-sqlite3';
import type { Kysely } from 'kysely';
import type { DB } from '../../../../../store/kysely_types';
import type { JiraExternalTrackerProvider } from './config';
import { getJiraProviderScopes } from './config';

export interface BetterAuthDatabase {
  sqlite: Database.Database;
  kysely: Kysely<DB>;
}

export interface ExternalTrackerAuthService {
  getSession(headers: Headers): Promise<{ user: { id: string; email: string; name: string } } | null>;
  linkSocialAccount(args: {
    headers: Headers;
    provider: JiraExternalTrackerProvider;
    callbackURL?: string;
  }): Promise<unknown>;
  handler(request: Request): Promise<Response>;
}

interface BetterAuthInstanceForExternalTrackers {
  api: {
    getSession(args: { headers: Headers }): Promise<{ user: { id: string; email: string; name: string } } | null>;
    linkSocialAccount(args: {
      headers: Headers;
      body: {
        provider: 'atlassian';
        callbackURL?: string;
        scopes: string[];
        requestSignUp: false;
      };
    }): Promise<unknown>;
  };
  handler(request: Request): Promise<Response>;
}

export function createExternalTrackerAuth(database: BetterAuthDatabase): BetterAuthInstanceForExternalTrackers {
  return betterAuth({
    appName: 'Vibe Dashboard',
    basePath: '/dashboard/api/auth',
    database: database.sqlite,
    user: {
      modelName: 'BetterAuthUser',
    },
    session: {
      modelName: 'BetterAuthSession',
    },
    account: {
      modelName: 'BetterAuthAccount',
      accountLinking: {
        enabled: true,
        disableImplicitLinking: true,
        allowDifferentEmails: true,
        trustedProviders: [],
        updateUserInfoOnLink: false,
      },
    },
    verification: {
      modelName: 'BetterAuthVerification',
    },
    socialProviders: {
      atlassian: {
        clientId: process.env.ATLASSIAN_CLIENT_ID || '',
        clientSecret: process.env.ATLASSIAN_CLIENT_SECRET || '',
        scope: getJiraProviderScopes(),
      },
    },
  }) as unknown as BetterAuthInstanceForExternalTrackers;
}

export function createExternalTrackerAuthService(auth: BetterAuthInstanceForExternalTrackers): ExternalTrackerAuthService {
  return {
    getSession: async (headers) => {
      const session = await auth.api.getSession({ headers });
      return session ? { user: session.user } : null;
    },
    linkSocialAccount: async ({ headers, provider, callbackURL }) => {
      return auth.api.linkSocialAccount({
        headers,
        body: {
          provider: 'atlassian',
          callbackURL,
          scopes: getJiraProviderScopes(),
          requestSignUp: false,
        },
      });
    },
    handler: (request) => auth.handler(request),
  };
}
