export interface TaskAttempt {
  id: string;
  name: string;
  container_ref: string | null;
  branch: string;
  archived: boolean;
  pinned: boolean;
  agent_working_dir: string | null;
}

interface ApiResponse<T> {
  success: boolean;
  data: T;
}

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Request failed for ${url}: ${response.statusText}`);
  }
  return response.json() as Promise<T>;
}

export async function listTaskAttempts(): Promise<TaskAttempt[]> {
  const response = await fetchJson<ApiResponse<TaskAttempt[]>>('/api/task-attempts');
  if (!response.success || !Array.isArray(response.data)) {
    throw new Error('Invalid task attempts response');
  }

  return response.data
    .filter((attempt) => !attempt.archived)
    .sort((a, b) => {
      if (a.pinned && !b.pinned) return -1;
      if (!a.pinned && b.pinned) return 1;
      return (a.name || '').localeCompare(b.name || '');
    });
}

export async function refreshTaskAttemptBranchStatus(taskAttemptId: string): Promise<void> {
  const response = await fetch(`/api/task-attempts/${taskAttemptId}/branch-status`);
  if (!response.ok) {
    throw new Error(`Failed to refresh branch status: ${response.statusText}`);
  }
}

export async function getTaskAttempt(taskAttemptId: string): Promise<TaskAttempt> {
  const response = await fetchJson<ApiResponse<TaskAttempt>>(`/api/task-attempts/${taskAttemptId}`);
  if (!response.success || !response.data) {
    throw new Error('Invalid task attempt response');
  }

  return response.data;
}

export async function resolveContainerRef(taskAttempt: TaskAttempt): Promise<string> {
  if (taskAttempt.container_ref) {
    return taskAttempt.container_ref;
  }

  await refreshTaskAttemptBranchStatus(taskAttempt.id);
  const refreshed = await getTaskAttempt(taskAttempt.id);
  return refreshed.container_ref || '';
}
