import type {
  ChatRoutingOverview,
  RepoChatRoute,
  RepoChatRouteUpsertInput,
} from './types';

interface ApiEnvelope<T> {
  success: boolean;
  data: T;
}

class ChatIntegrationBrowserClient {
  constructor(private readonly baseUrl = '/api/chat') {}

  private async request<T>(path: string, init?: RequestInit): Promise<T> {
    const response = await fetch(`${this.baseUrl}${path}`, init);
    if (!response.ok) {
      throw new Error(
        `${init?.method ?? 'GET'} ${path} failed: ${response.status}`
      );
    }

    const payload = (await response.json()) as ApiEnvelope<T>;
    if (!payload.success) {
      throw new Error(
        `${init?.method ?? 'GET'} ${path} returned unsuccessful response`
      );
    }

    return payload.data;
  }

  getRoutingOverview(): Promise<ChatRoutingOverview> {
    return this.request('/routing');
  }

  createRepoRoute(input: RepoChatRouteUpsertInput): Promise<RepoChatRoute> {
    return this.request('/routing/routes', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(input),
    });
  }

  updateRepoRoute(input: RepoChatRouteUpsertInput & { id: number }): Promise<RepoChatRoute> {
    return this.request(`/routing/routes/${input.id}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(input),
    });
  }

  async deleteRepoRoute(id: number): Promise<void> {
    await this.request(`/routing/routes/${id}`, {
      method: 'DELETE',
    });
  }
}

export const chatIntegrationBrowserClient =
  new ChatIntegrationBrowserClient();
