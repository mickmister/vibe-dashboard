// VK API Types

import type { Executor, AgentRole } from "./config.js";

export interface Project {
  id: string;
  name: string;
  default_agent_working_dir: string;
  remote_project_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface Task {
  id: string;
  project_id: string;
  title: string;
  description: string | null;
  status: "todo" | "inprogress" | "inreview" | "done" | "cancelled";
  parent_workspace_id: string | null;
  shared_task_id: string | null;
  has_in_progress_attempt: boolean | null;
  last_attempt_failed: boolean | null;
  executor: Executor | null;
  created_at: string;
  updated_at: string;
}

export interface Workspace {
  id: string;
  task_id: string | null;
  container_ref: string | null;
  branch: string;
  agent_working_dir: string | null;
  setup_completed_at: string | null;
  archived: boolean;
  pinned: boolean;
  name: string | null;
  worktree_deleted?: boolean;
  created_at: string;
  updated_at: string;
}

export interface Repo {
  id: string;
  path: string;
  name: string;
  display_name: string;
  setup_script: string | null;
  parallel_setup_script: boolean | null;
  dev_server_script: string | null;
  cleanup_script: string | null;
  copy_files: unknown[] | null;
  created_at: string;
  updated_at: string;
}

export interface Session {
  id: string;
  workspace_id: string;
  executor: Executor;
  name?: string | null;
  created_at: string;
  updated_at: string;
}

export interface ExecutionProcess {
  id: string;
  session_id: string;
  status: "running" | "completed" | "failed" | "killed";
  created_at: string;
  started_at: string;
  completed_at: string | null;
  updated_at: string;
  exit_code: number | null;
  dropped: boolean;
  run_reason: string;
  executor_action: unknown;
}

export interface QueuedMessage {
  id: string;
  session_id: string;
  workspace_id: string;
  status:
    | "queued"
    | "leased"
    | "starting"
    | "running"
    | "completed"
    | "failed"
    | "cancelled";
  source: "from_user" | "workflow" | "agent" | "system";
  priority: number | bigint;
  data: { message: string; session_command?: unknown | null };
}

export interface QueueStatus {
  count: number;
  message: QueuedMessage | null;
  messages: QueuedMessage[];
  status: "empty" | "queued";
}

export interface QueueMessageResponse {
  queued_item: QueuedMessage;
  status: QueueStatus;
}

export interface WorkspaceSummary {
  workspace_id: string;
  latest_session_id: string | null;
  latest_process_status: "running" | "completed" | "failed" | "killed";
  latest_process_completed_at: string | null;
  has_pending_approval: boolean;
  has_running_dev_server: boolean;
  files_changed: number | null;
  lines_added: number | null;
  lines_removed: number | null;
  has_unseen_turns: boolean;
  pr_status: string | null;
}

export interface ConversationEntry {
  content?: {
    entry_type?: {
      type?: string;
    };
    content?: string | unknown;
  };
}

// API Response envelope
export interface ApiResponse<T> {
  success: boolean;
  data: T;
  error_data: unknown | null;
  message: string | null;
}

// Request bodies
export interface CreateTaskBody {
  project_id: string;
  title: string;
  description?: string;
  status: "todo" | "inprogress" | "inreview" | "done" | "cancelled";
}

export interface CreateWorkspaceBody {
  task_id: string;
  executor_profile_id: {
    executor: Executor;
    variant?: string;
  };
  repos: Array<{
    repo_id: string;
    target_branch: string;
  }>;
}

export interface CreateSessionBody {
  workspace_id: string;
  executor: Executor;
  name?: string | null;
}

export interface UpdateSessionBody {
  name?: string | null;
}

export interface SendMessageBody {
  prompt: string;
  variant?: string;
  executor_profile_id?: {
    executor: Executor;
    variant?: string;
  };
  executor_config?: {
    executor: Executor;
  };
  retry_process_id?: string | null;
  force_when_dirty?: boolean | null;
  perform_git_reset?: boolean | null;
}

export interface QueueMessageBody {
  message: string;
  source?: "from_user" | "workflow" | "agent" | "system";
  priority?: number | null;
}

// Session file format
export type SessionFile = Record<string, AgentRole>;

// Agent context
export interface AgentContext {
  projectId: string | null;
  projectName: string | null;
  taskId: string | null;
  workspaceId: string;
  workspaceBranch: string | null;
  sessionId: string | null;
  role: AgentRole | null;
}
