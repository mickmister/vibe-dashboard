export const DEFAULT_LINEAR_API_URL = 'https://api.linear.app/graphql';

export interface LinearApiKeyAuthConfig {
  kind: 'api_key';
  apiKey: string;
  apiUrl: string;
}

export function getEnvLinearApiKeyAuth(env: Record<string, string | undefined> = process.env): LinearApiKeyAuthConfig | undefined {
  const apiKey = env.LINEAR_KANBAN_API_KEY?.trim();
  if (!apiKey) return undefined;
  return {
    kind: 'api_key',
    apiKey,
    apiUrl: env.LINEAR_KANBAN_API_URL?.trim() || DEFAULT_LINEAR_API_URL,
  };
}
