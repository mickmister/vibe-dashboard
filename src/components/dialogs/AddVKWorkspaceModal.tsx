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
} from '../../lib/vk-client';
import { resolveWorkspaceContainerRef } from '../../lib/vkWorkspaceOpen';
import type { WorkspaceState } from '../../types';

interface WorkspaceOption extends Workspace {
  repos: RepoWithBranch[];
}

let cachedWorkspaceOptions: WorkspaceOption[] | null = null;
let cachedWorkspaceOptionsPromise: Promise<WorkspaceOption[]> | null = null;

interface AddVKWorkspaceModalProps {
  isOpen: boolean;
  onClose: () => void;
  onComplete?: () => void;
  onAdd: (taskAttemptId: string, name: string, containerRef: string) => void;
  onAddToSpace?: (
    taskAttemptId: string,
    name: string,
    containerRef: string,
    spaceId: string
  ) => void;
  onNavigateToTabGroup?: (spaceId: string, tabGroupId: string) => void;
  onAddWithPath?: (workspacePath: string, name: string) => void;
  workspaceState?: WorkspaceState;
  allowCustomPath?: boolean;
}

export function AddVKWorkspaceModal({
  isOpen,
  onClose,
  onComplete,
  onAdd,
  onAddToSpace,
  onNavigateToTabGroup,
  onAddWithPath,
  workspaceState,
  allowCustomPath = true,
}: AddVKWorkspaceModalProps) {
  const [taskAttempts, setTaskAttempts] = useState<WorkspaceOption[]>(
    () => cachedWorkspaceOptions ?? []
  );
  const [filteredAttempts, setFilteredAttempts] = useState<WorkspaceOption[]>([]);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedRepo, setSelectedRepo] = useState('all');
  const [showPathInput, setShowPathInput] = useState(false);
  const [customPath, setCustomPath] = useState('');
  const [customName, setCustomName] = useState('');
  const [spacePickerTarget, setSpacePickerTarget] =
    useState<WorkspaceOption | null>(null);

  const workspaceTabGroupMap = useMemo(
    () => buildWorkspaceTabGroupMap(workspaceState),
    [workspaceState]
  );

  const availableSpaces = useMemo(() => {
    if (!workspaceState) return [];
    return workspaceState.spaces;
  }, [workspaceState]);

  useEffect(() => {
    if (isOpen) {
      void fetchTaskAttempts();
    } else {
      // Reset state when modal closes
      setSearchQuery('');
      setSelectedRepo('all');
      setShowPathInput(false);
      setCustomPath('');
      setCustomName('');
      setSpacePickerTarget(null);
      setLoading(false);
      setRefreshing(false);
      setError(null);
    }
  }, [isOpen]);

  useEffect(() => {
    const query = searchQuery.trim().toLowerCase();
    const repoFilter = selectedRepo.trim();

    const filtered = taskAttempts.filter((ta) => {
        const openLocation = workspaceTabGroupMap.get(ta.id);
        const matchesQuery = !query ||
          ta.name?.toLowerCase().includes(query) ||
          ta.branch?.toLowerCase().includes(query) ||
          ta.agent_working_dir?.toLowerCase().includes(query) ||
          openLocation?.spaceName.toLowerCase().includes(query) ||
          openLocation?.tabGroupLabel.toLowerCase().includes(query);

        const repoNames = getRepoNames(ta);
        const matchesRepo = repoFilter === 'all' || repoNames.includes(repoFilter);

        return matchesQuery && matchesRepo;
      });

    filtered.sort((a, b) => compareWorkspaceOptions(a, b, workspaceTabGroupMap));
    setFilteredAttempts(filtered);
  }, [searchQuery, selectedRepo, taskAttempts, workspaceTabGroupMap]);

  const repoOptions = useMemo(() => {
    const repos = new Set<string>();
    taskAttempts.forEach((ta) => {
      getRepoNames(ta).forEach((repoName) => repos.add(repoName));
    });
    return Array.from(repos).sort((a, b) => a.localeCompare(b));
  }, [taskAttempts]);

  const fetchTaskAttempts = async () => {
    const cachedResults = cachedWorkspaceOptions;
    const hasCachedResults = cachedResults != null;

    if (hasCachedResults) {
      setTaskAttempts(cachedResults);
      setLoading(false);
      setRefreshing(true);
    } else {
      setLoading(true);
      setRefreshing(false);
    }

    setError(null);

    try {
      const workspaces = await fetchWorkspaceOptions();
      setTaskAttempts(workspaces);
    } catch (err) {
      if (!hasCachedResults) {
        setError(err instanceof Error ? err.message : 'Failed to load workspaces');
      }
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  const resolveContainerRef = async (workspace: WorkspaceOption) => {
    return resolveWorkspaceContainerRef(workspace.id, workspace.container_ref);
  };

  const handleWorkspaceSelect = async (workspace: WorkspaceOption) => {
    const openLocation = workspaceTabGroupMap.get(workspace.id);
    if (openLocation && onNavigateToTabGroup) {
      onNavigateToTabGroup(openLocation.spaceId, openLocation.tabGroupId);
      onComplete?.();
      onClose();
      return;
    }

    if (onAddToSpace) {
      setSpacePickerTarget(workspace);
      return;
    }

    const containerRef = await resolveContainerRef(workspace);
    onAdd(workspace.id, workspace.name || 'Untitled Workspace', containerRef);
    onComplete?.();
    onClose();
  };

  const handleSelectSpace = async (spaceId: string) => {
    if (!spacePickerTarget) return;

    const containerRef = await resolveContainerRef(spacePickerTarget);

    if (onAddToSpace) {
      onAddToSpace(
        spacePickerTarget.id,
        spacePickerTarget.name || 'Untitled Workspace',
        containerRef,
        spaceId
      );
    } else {
      onAdd(
        spacePickerTarget.id,
        spacePickerTarget.name || 'Untitled Workspace',
        containerRef
      );
    }

    onComplete?.();
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
    onComplete?.();
    onClose();
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} size="2xl" backdrop="blur">
      <ModalContent className="bg-neutral-900 border border-neutral-800 text-neutral-100">
        <ModalHeader className="flex flex-col gap-1 border-b border-neutral-800">
          <h2 className="text-lg font-semibold text-white">
            {spacePickerTarget ? 'Choose Space' : 'Open VK Workspace'}
          </h2>
          <p className="text-sm text-neutral-400 font-normal">
            {spacePickerTarget
              ? `Select a space for ${spacePickerTarget.name || 'Untitled Workspace'}`
              : showPathInput
              ? 'Enter workspace path or directory'
              : 'Search workspaces to open, or jump to an already-open tab group'}
          </p>
        </ModalHeader>
        <ModalBody>
          {spacePickerTarget ? (
            <div className="space-y-2">
              {availableSpaces.length === 0 ? (
                <div className="text-neutral-500 text-center py-8">
                  No spaces available
                </div>
              ) : (
                availableSpaces.map((space) => {
                  const tabGroupCount =
                    workspaceState?.tabGroups.filter((tg) =>
                      space.tabGroupIds.includes(tg.id)
                    ).length ?? 0;

                  return (
                    <button
                      key={space.id}
                      onClick={() => {
                        void handleSelectSpace(space.id);
                      }}
                      className="w-full p-3 rounded-lg bg-neutral-800 hover:bg-neutral-700 border border-transparent transition-colors text-left"
                    >
                      <div className="flex items-center justify-between gap-3">
                        <span className="font-medium text-sm text-white">
                          {space.name}
                        </span>
                        <span className="text-xs text-neutral-500">
                          {tabGroupCount} tab group
                          {tabGroupCount === 1 ? '' : 's'}
                        </span>
                      </div>
                    </button>
                  );
                })
              )}
            </div>
          ) : showPathInput ? (
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
                    autoFocus
                    classNames={{
                      inputWrapper: 'bg-neutral-800 border-neutral-700 data-[hover=true]:bg-neutral-800 group-data-[focus=true]:bg-neutral-800',
                      input: 'text-white',
                    }}
                    className="flex-1"
                  />
                  {allowCustomPath && (
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

              {refreshing && (
                <div className="flex items-center gap-2 text-xs text-neutral-500">
                  <Spinner size="sm" />
                  <span>Refreshing results…</span>
                </div>
              )}

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
                    <button
                      key={ta.id}
                      onClick={() => {
                        void handleWorkspaceSelect(ta);
                      }}
                      className="p-3 rounded-lg cursor-pointer transition-colors bg-neutral-800 hover:bg-neutral-700 border border-transparent text-left"
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
                          {workspaceTabGroupMap.get(ta.id) ? (
                            <p className="text-xs text-primary-300 mt-1">
                              Open in {workspaceTabGroupMap.get(ta.id)?.spaceName} /{' '}
                              {workspaceTabGroupMap.get(ta.id)?.tabGroupLabel}
                            </p>
                          ) : onAddToSpace ? (
                            <p className="text-xs text-neutral-500 mt-1">
                              Choose a space for this tab group
                            </p>
                          ) : null}
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </>
          )}
        </ModalBody>
        <ModalFooter className="border-t border-neutral-800">
          {(showPathInput || spacePickerTarget) && (
            <Button
              size="sm"
              variant="flat"
              onPress={() => {
                if (spacePickerTarget) {
                  setSpacePickerTarget(null);
                } else {
                  setShowPathInput(false);
                }
              }}
              className="bg-neutral-800 text-neutral-200"
            >
              Back
            </Button>
          )}
          <Button color="default" variant="light" onPress={onClose} className="text-neutral-300">
            Cancel
          </Button>
          {showPathInput && (
            <Button
              color="primary"
              onPress={handleAddWithPath}
              isDisabled={!customPath.trim()}
            >
              Add
            </Button>
          )}
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
}

interface OpenWorkspaceLocation {
  spaceId: string;
  spaceName: string;
  tabGroupId: string;
  tabGroupLabel: string;
  lastVisitedAt?: string;
}

function getMostRecentTimestamp(workspace: Workspace): number {
  const fields = [
    workspace.updated_at,
    workspace.created_at,
  ];

  for (const field of fields) {
    const ts = parseTimestamp(field);
    if (ts > 0) return ts;
  }
  return 0;
}

function getWorkspaceTabGroupTimestamp(location?: OpenWorkspaceLocation): number {
  if (!location) return 0;
  return parseTimestamp(location.lastVisitedAt);
}

function compareWorkspaceOptions(
  a: WorkspaceOption,
  b: WorkspaceOption,
  workspaceTabGroupMap: Map<string, OpenWorkspaceLocation>
): number {
  const openDiff =
    getWorkspaceTabGroupTimestamp(workspaceTabGroupMap.get(b.id)) -
    getWorkspaceTabGroupTimestamp(workspaceTabGroupMap.get(a.id));
  if (openDiff !== 0) return openDiff;

  if (a.pinned && !b.pinned) return -1;
  if (!a.pinned && b.pinned) return 1;

  const recentDiff = getMostRecentTimestamp(b) - getMostRecentTimestamp(a);
  if (recentDiff !== 0) return recentDiff;

  return (a.name || '').localeCompare(b.name || '');
}

async function fetchWorkspaceOptions(): Promise<WorkspaceOption[]> {
  if (cachedWorkspaceOptionsPromise) {
    return cachedWorkspaceOptionsPromise;
  }

  cachedWorkspaceOptionsPromise = (async () => {
    const allWorkspaces = await vkClient.getWorkspaces();
    const activeWorkspaces = allWorkspaces.filter((workspace) => !workspace.archived);

    const repoResults = await Promise.allSettled(
      activeWorkspaces.map((workspace) =>
        vkClient
          .getWorkspaceRepos(workspace.id)
          .then((repos) => ({ workspaceId: workspace.id, repos }))
      )
    );

    const repoMap = new Map<string, RepoWithBranch[]>();
    for (const result of repoResults) {
      if (result.status === 'fulfilled') {
        repoMap.set(result.value.workspaceId, result.value.repos);
      }
    }

    const workspaces = activeWorkspaces.map((workspace) => ({
      ...workspace,
      repos: repoMap.get(workspace.id) ?? [],
    }));

    cachedWorkspaceOptions = workspaces;
    return workspaces;
  })();

  try {
    return await cachedWorkspaceOptionsPromise;
  } finally {
    cachedWorkspaceOptionsPromise = null;
  }
}

export function prefetchVKWorkspaceSearchResults(): Promise<void> {
  return fetchWorkspaceOptions().then(() => undefined).catch(() => undefined);
}

function buildWorkspaceTabGroupMap(
  workspaceState?: WorkspaceState
): Map<string, OpenWorkspaceLocation> {
  const map = new Map<string, OpenWorkspaceLocation>();
  if (!workspaceState) return map;

  for (const space of workspaceState.spaces) {
    for (const tabGroupId of space.tabGroupIds) {
      const tg = workspaceState.tabGroups.find((group) => group.id === tabGroupId);
      if (!tg) continue;

      for (const tab of tg.tabs) {
        const workspaceId = extractWorkspaceIdFromUrl(tab.url);
        if (!workspaceId) continue;

        const existing = map.get(workspaceId);
        if (
          existing &&
          getWorkspaceTabGroupTimestamp(existing) >= getWorkspaceTabGroupTimestamp({
            spaceId: space.id,
            spaceName: space.name,
            tabGroupId: tg.id,
            tabGroupLabel: tg.label,
            lastVisitedAt: tg.lastVisitedAt,
          })
        ) {
          continue;
        }

        map.set(workspaceId, {
          spaceId: space.id,
          spaceName: space.name,
          tabGroupId: tg.id,
          tabGroupLabel: tg.label,
          lastVisitedAt: tg.lastVisitedAt,
        });
      }
    }
  }

  return map;
}

function extractWorkspaceIdFromUrl(value: string): string | null {
  const match = value.match(/\/workspaces\/([^/?#]+)/);
  return match?.[1] ?? null;
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

function getRepoNames(workspace: WorkspaceOption): string[] {
  const repos = new Set<string>();

  workspace.repos.forEach((repo) => {
    repos.add(normalizeRepoName(repo.display_name || repo.name));
  });
  const workingDirRepo = extractRepoNameFromPath(workspace.agent_working_dir);
  if (workingDirRepo) {
    repos.add(workingDirRepo);
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
