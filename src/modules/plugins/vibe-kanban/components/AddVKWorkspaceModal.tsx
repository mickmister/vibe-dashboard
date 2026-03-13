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
import {
  vkClient,
  type RepoWithBranch,
  type Workspace,
} from '../../../../lib/vk-client';

interface WorkspaceOption extends Workspace {
  repos: RepoWithBranch[];
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
  const canAddWithPath = typeof onAddWithPath === 'function';
  const [taskAttempts, setTaskAttempts] = useState<WorkspaceOption[]>([]);
  const [filteredAttempts, setFilteredAttempts] = useState<WorkspaceOption[]>([]);
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
      void fetchTaskAttempts();
    } else {
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
      }),
    );
  }, [searchQuery, selectedRepo, taskAttempts]);

  const repoOptions = useMemo(() => {
    const repos = new Set<string>();
    taskAttempts.forEach((ta) => {
      getRepoNames(ta).forEach((repoName) => repos.add(repoName));
    });
    return Array.from(repos).sort((a, b) => a.localeCompare(b));
  }, [taskAttempts]);

  const refreshWorkspaceContainerAndRefetch = async (workspaceId: string) => {
    await vkClient.getWorkspaceBranchStatus(workspaceId);
    return vkClient.getWorkspace(workspaceId);
  };

  const fetchTaskAttempts = async () => {
    setLoading(true);
    setError(null);
    try {
      const allWorkspaces = await vkClient.getWorkspaces();
      const activeWorkspaces = allWorkspaces.filter((workspace) => !workspace.archived);

      const repoResults = await Promise.allSettled(
        activeWorkspaces.map((workspace) =>
          vkClient
            .getWorkspaceRepos(workspace.id)
            .then((repos) => ({ workspaceId: workspace.id, repos })),
        ),
      );

      const repoMap = new Map<string, RepoWithBranch[]>();
      for (const result of repoResults) {
        if (result.status === 'fulfilled') {
          repoMap.set(result.value.workspaceId, result.value.repos);
        }
      }

      const workspaces = activeWorkspaces
        .map((workspace) => ({
          ...workspace,
          repos: repoMap.get(workspace.id) ?? [],
        }))
        .sort((a, b) => {
          if (a.pinned && !b.pinned) return -1;
          if (!a.pinned && b.pinned) return 1;
          const recentDiff = getMostRecentTimestamp(b) - getMostRecentTimestamp(a);
          if (recentDiff !== 0) return recentDiff;
          return (a.name || '').localeCompare(b.name || '');
        });

      setTaskAttempts(workspaces);
      setFilteredAttempts(workspaces);
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
        const refreshed = await refreshWorkspaceContainerAndRefetch(selected.id);
        containerRef = refreshed.container_ref;
      } catch (e) {
        console.error('Failed to refresh container ref', e);
      }
    }

    onAdd(selected.id, selected.name || 'Untitled Workspace', containerRef || '');
    onClose();
  };

  const handleAddWithPath = () => {
    if (!canAddWithPath || !customPath.trim()) return;

    const name = customName.trim() || 'Custom Workspace';
    onAddWithPath(customPath.trim(), name);
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
                  {canAddWithPath && (
                    <Button
                      size="sm"
                      variant="flat"
                      onPress={() => setShowPathInput(true)}
                    >
                      Custom Path
                    </Button>
                  )}
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
                  {searchQuery || selectedRepo !== 'all'
                    ? 'No workspaces match your filters'
                    : 'No workspaces available'}
                </div>
              )}

              {!loading && !error && filteredAttempts.length > 0 && (
                <div className="flex flex-col gap-2 max-h-96 overflow-y-auto">
                  {filteredAttempts.map((ta) => {
                    const repoNames = getRepoNames(ta);
                    return (
                      <div
                        key={ta.id}
                        onClick={() => setSelectedId(ta.id)}
                        className={`p-3 rounded-lg cursor-pointer transition-colors ${
                          selectedId === ta.id
                            ? 'bg-primary-500/20 border border-primary-500'
                            : 'bg-neutral-800 hover:bg-neutral-700 border border-transparent'
                        }`}
                      >
                        <div className="flex items-start justify-between gap-3">
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
                              <p className="text-xs text-neutral-500 mt-0.5 truncate">
                                Dir: {ta.agent_working_dir}
                              </p>
                            )}
                            {repoNames.length > 0 && (
                              <p className="text-xs text-neutral-500 mt-0.5 truncate">
                                Repo: {repoNames.join(', ')}
                              </p>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
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

function getMostRecentTimestamp(workspace: Workspace): number {
  const updated = Date.parse(workspace.updated_at || '');
  const created = Date.parse(workspace.created_at || '');
  return Math.max(Number.isNaN(updated) ? 0 : updated, Number.isNaN(created) ? 0 : created);
}

function getRepoNames(workspace: WorkspaceOption): string[] {
  return workspace.repos
    .map((repo) => repo.display_name || repo.name)
    .filter((name): name is string => Boolean(name));
}
