import React, { useState, useEffect, useMemo } from 'react';
import {
  Modal,
  ModalContent,
  ModalHeader,
  ModalBody,
  ModalFooter,
  Button,
  Input,
  Spinner,
} from '@heroui/react';

interface TaskAttempt {
  id: string;
  name: string;
  container_ref: string | null;
  branch: string;
  archived: boolean;
  pinned: boolean;
  agent_working_dir: string | null;
  created_at?: string | number | null;
  updated_at?: string | number | null;
  last_used_at?: string | number | null;
  last_opened_at?: string | number | null;
  last_active_at?: string | number | null;
  repository?: string | null;
  repository_name?: string | null;
  repo?: string | null;
  repo_name?: string | null;
  worktrees?: Array<Record<string, unknown> | string> | null;
}


interface AddVKWorkspaceModalProps {
  isOpen: boolean;
  onClose: () => void;
  onAdd: (taskAttemptId: string, name: string, containerRef: string) => void;
  onAddWithPath?: (workspacePath: string, name: string) => void;
}

export function AddVKWorkspaceModal({
  isOpen,
  onClose,
  onAdd,
  onAddWithPath,
}: AddVKWorkspaceModalProps) {
  const [taskAttempts, setTaskAttempts] = useState<TaskAttempt[]>([]);
  const [filteredAttempts, setFilteredAttempts] = useState<TaskAttempt[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedRepo, setSelectedRepo] = useState('all');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showPathInput, setShowPathInput] = useState(false);
  const [customPath, setCustomPath] = useState('');
  const [customName, setCustomName] = useState('');

  useEffect(() => {
    if (isOpen) {
      fetchTaskAttempts();
    } else {
      // Reset state when modal closes
      setSearchQuery('');
      setSelectedRepo('all');
      setSelectedId(null);
      setShowPathInput(false);
      setCustomPath('');
      setCustomName('');
    }
  }, [isOpen]);

  useEffect(() => {
    const query = searchQuery.trim().toLowerCase();
    const repoFilter = selectedRepo.trim();

    setFilteredAttempts(
      taskAttempts.filter((ta) => {
        const matchesQuery = !query ||
          ta.name?.toLowerCase().includes(query) ||
          ta.branch?.toLowerCase().includes(query) ||
          ta.agent_working_dir?.toLowerCase().includes(query);

        const repoNames = getRepoNames(ta);
        const matchesRepo = repoFilter === 'all' || repoNames.includes(repoFilter);

        return matchesQuery && matchesRepo;
      })
    );
  }, [searchQuery, selectedRepo, taskAttempts]);

  const repoOptions = useMemo(() => {
    const repos = new Set<string>();
    taskAttempts.forEach((ta) => {
      getRepoNames(ta).forEach((repoName) => repos.add(repoName));
    });
    return Array.from(repos).sort((a, b) => a.localeCompare(b));
  }, [taskAttempts]);

  const refreshTaskAttemptContainerAndRefetchTaskAttempt = async (taskAttemptId: string) => {
    const response = await fetch(`/vk-api/workspaces/${taskAttemptId}/git/status`);
    if (!response.ok) {
      throw new Error(`Failed to fetch workspaces: ${response.statusText}`);
    }

    const data = await response.json();
    console.log(data);

    const attempt = await fetch(`/vk-api/workspaces/${taskAttemptId}`).then(r => r.json());
    console.log(attempt);
    return attempt.data;
  };

  const fetchTaskAttempts = async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch('/vk-api/workspaces');
      if (!response.ok) {
        throw new Error(`Failed to fetch workspaces: ${response.statusText}`);
      }
      const data = await response.json();
      if (data.success && Array.isArray(data.data)) {
        // Filter out archived by default, sort by pinned then most-recent.
        const workspaces = data.data
          .filter((ta: TaskAttempt) => !ta.archived)
          .sort((a: TaskAttempt, b: TaskAttempt) => {
            if (a.pinned && !b.pinned) return -1;
            if (!a.pinned && b.pinned) return 1;
            const recentDiff = getMostRecentTimestamp(b) - getMostRecentTimestamp(a);
            if (recentDiff !== 0) return recentDiff;
            return (a.name || '').localeCompare(b.name || '');
          });
        setTaskAttempts(workspaces);
        setFilteredAttempts(workspaces);
      } else {
        throw new Error('Invalid response format');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load workspaces');
    } finally {
      setLoading(false);
    }
  };

  const handleAdd = async () => {
    const selected = taskAttempts.find((ta) => ta.id === selectedId);
    if (!selected) return;

    let containerRef = selected.container_ref;

    if (!containerRef) {
      try {

        const attempt: {container_ref: string | null} = await refreshTaskAttemptContainerAndRefetchTaskAttempt(selected.id);
        containerRef = attempt.container_ref;
      } catch (e) {
        console.error('Failed to refresh container ref', e);
      }
    }

    onAdd(selected.id, selected.name || 'Untitled Workspace', containerRef || '');
    onClose();
  };

  const handleAddWithPath = () => {
    if (!customPath.trim()) return;

    const name = customName.trim() || 'Custom Workspace';

    // If onAddWithPath is provided, use it
    if (onAddWithPath) {
      onAddWithPath(customPath.trim(), name);
    } else {
      // Fallback: treat path as containerRef and create empty taskAttemptId
      onAdd('', name, customPath.trim());
    }
    onClose();
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} size="2xl" backdrop="blur">
      <ModalContent className="bg-neutral-900 border border-neutral-800 text-neutral-100">
        <ModalHeader className="flex flex-col gap-1 border-b border-neutral-800">
          <h2 className="text-lg font-semibold text-white">Add VK Workspace</h2>
          <p className="text-sm text-neutral-400 font-normal">
            {showPathInput
              ? 'Enter workspace path or directory'
              : 'Select a workspace to open in split view (Agent + Code)'}
          </p>
        </ModalHeader>
        <ModalBody>
          {showPathInput ? (
            <div className="space-y-3">
              <Input
                label="Workspace Name"
                placeholder="My Workspace"
                value={customName}
                onChange={(e) => setCustomName(e.target.value)}
                size="sm"
                classNames={{
                  inputWrapper: 'bg-neutral-800 border-neutral-700 data-[hover=true]:bg-neutral-800 group-data-[focus=true]:bg-neutral-800',
                  input: 'text-white',
                  label: 'text-neutral-300',
                }}
              />
              <Input
                label="Path"
                placeholder="/absolute/path or VK workspace ID/URL"
                value={customPath}
                onChange={(e) => setCustomPath(e.target.value)}
                size="sm"
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleAddWithPath();
                }}
                classNames={{
                  inputWrapper: 'bg-neutral-800 border-neutral-700 data-[hover=true]:bg-neutral-800 group-data-[focus=true]:bg-neutral-800',
                  input: 'text-white',
                  label: 'text-neutral-300',
                  description: 'text-neutral-500',
                }}
                description="Provide an absolute directory path or VK workspace ID/URL"
              />
            </div>
          ) : (
            <>
              <div className="flex flex-col gap-2">
                <div className="flex gap-2">
                  <Input
                    placeholder="Search workspaces..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    size="sm"
                    classNames={{
                      inputWrapper: 'bg-neutral-800 border-neutral-700 data-[hover=true]:bg-neutral-800 group-data-[focus=true]:bg-neutral-800',
                      input: 'text-white',
                    }}
                    className="flex-1"
                  />
                  <Button
                    size="sm"
                    variant="flat"
                    onPress={() => setShowPathInput(true)}
                  >
                    Custom Path
                  </Button>
                </div>

                <div className="flex items-center gap-2">
                  <label htmlFor="repo-filter" className="text-xs text-neutral-400 whitespace-nowrap">
                    Repository
                  </label>
                  <select
                    id="repo-filter"
                    value={selectedRepo}
                    onChange={(e) => setSelectedRepo(e.target.value)}
                    className="flex-1 h-8 px-2 rounded-md border border-neutral-700 bg-neutral-800 text-neutral-100 text-sm"
                  >
                    <option value="all">All repositories</option>
                    {repoOptions.map((repoName) => (
                      <option key={repoName} value={repoName}>
                        {repoName}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {loading && (
                <div className="flex items-center justify-center py-8">
                  <Spinner size="lg" />
                </div>
              )}

              {error && (
                <div className="text-red-400 text-sm p-4 bg-red-500/10 rounded">
                  {error}
                </div>
              )}

              {!loading && !error && filteredAttempts.length === 0 && (
                <div className="text-neutral-500 text-center py-8">
                  {searchQuery
                    ? 'No workspaces match your search'
                    : 'No workspaces available'}
                </div>
              )}

              {!loading && !error && filteredAttempts.length > 0 && (
                <div className="flex flex-col gap-2 max-h-96 overflow-y-auto">
                  {filteredAttempts.map((ta) => (
                    <div
                      key={ta.id}
                      onClick={() => setSelectedId(ta.id)}
                      className={`p-3 rounded-lg cursor-pointer transition-colors ${
                        selectedId === ta.id
                          ? 'bg-primary-500/20 border border-primary-500'
                          : 'bg-neutral-800 hover:bg-neutral-700 border border-transparent'
                      }`}
                    >
                      <div className="flex items-start justify-between">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            {ta.pinned && <span className="text-yellow-500">📌</span>}
                            <h3 className="font-medium text-sm truncate">
                              {ta.name || 'Untitled'}
                            </h3>
                          </div>
                          <p className="text-xs text-neutral-400 mt-1">
                            Branch: {ta.branch}
                          </p>
                          {ta.agent_working_dir && (
                            <p className="text-xs text-neutral-500 mt-0.5">
                              Dir: {ta.agent_working_dir}
                            </p>
                          )}
                          {getRepoNames(ta).length > 0 && (
                            <p className="text-xs text-neutral-500 mt-0.5">
                              Repo: {getRepoNames(ta).join(', ')}
                            </p>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </ModalBody>
        <ModalFooter className="border-t border-neutral-800">
          {showPathInput && (
            <Button
              size="sm"
              variant="flat"
              onPress={() => setShowPathInput(false)}
              className="bg-neutral-800 text-neutral-200"
            >
              Back
            </Button>
          )}
          <Button color="default" variant="light" onPress={onClose} className="text-neutral-300">
            Cancel
          </Button>
          <Button
            color="primary"
            onPress={showPathInput ? handleAddWithPath : handleAdd}
            isDisabled={showPathInput ? !customPath.trim() : (!selectedId || loading)}
          >
            {showPathInput ? 'Add' : 'Add Workspace'}
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
}

function getMostRecentTimestamp(taskAttempt: TaskAttempt): number {
  const fields = [
    taskAttempt.last_used_at,
    taskAttempt.last_opened_at,
    taskAttempt.last_active_at,
    taskAttempt.updated_at,
    taskAttempt.created_at,
  ];

  for (const field of fields) {
    const ts = parseTimestamp(field);
    if (ts > 0) return ts;
  }
  return 0;
}

function parseTimestamp(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value > 1e12 ? value : value * 1000;
  }

  if (typeof value === 'string' && value.trim()) {
    const numeric = Number(value);
    if (Number.isFinite(numeric) && numeric > 0) {
      return numeric > 1e12 ? numeric : numeric * 1000;
    }

    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? 0 : parsed;
  }

  return 0;
}

function getRepoNames(taskAttempt: TaskAttempt): string[] {
  const repos = new Set<string>();

  const addRepo = (value: unknown) => {
    if (typeof value !== 'string') return;
    const repo = normalizeRepoName(value);
    if (repo) repos.add(repo);
  };

  addRepo(taskAttempt.repo);
  addRepo(taskAttempt.repo_name);
  addRepo(taskAttempt.repository);
  addRepo(taskAttempt.repository_name);
  addRepo(extractRepoNameFromPath(taskAttempt.agent_working_dir));

  if (Array.isArray(taskAttempt.worktrees)) {
    taskAttempt.worktrees.forEach((worktree) => {
      if (typeof worktree === 'string') {
        addRepo(extractRepoNameFromPath(worktree));
        return;
      }

      if (!worktree || typeof worktree !== 'object') return;
      const record = worktree as Record<string, unknown>;
      addRepo(record.repo);
      addRepo(record.repo_name);
      addRepo(record.repository);
      addRepo(record.repository_name);
      addRepo(record.name);
      addRepo(extractRepoNameFromPath(record.path));
      addRepo(extractRepoNameFromPath(record.working_dir));
      addRepo(extractRepoNameFromPath(record.directory));
    });
  }

  return Array.from(repos).sort((a, b) => a.localeCompare(b));
}

function normalizeRepoName(value: string): string {
  const cleaned = value.trim().replace(/\/+$/, '');
  if (!cleaned) return '';
  const parts = cleaned.split('/').filter(Boolean);
  const last = parts[parts.length - 1] || cleaned;
  return last.replace(/\.git$/i, '');
}

function extractRepoNameFromPath(value: unknown): string {
  if (typeof value !== 'string') return '';
  const trimmed = value.trim();
  if (!trimmed) return '';

  const worktreeMatch = trimmed.match(/\/worktrees\/[^/]+\/([^/]+)/);
  if (worktreeMatch?.[1]) {
    return normalizeRepoName(worktreeMatch[1]);
  }

  return normalizeRepoName(trimmed);
}
