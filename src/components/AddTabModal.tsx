import React, { useMemo, useState } from 'react';
import {
  Modal,
  ModalContent,
  ModalHeader,
  ModalBody,
  ModalFooter,
  Button,
  Input,
  Listbox,
  ListboxItem,
} from '@heroui/react';
import { AddVKWorkspaceModal } from './dialogs/AddVKWorkspaceModal';
import type { WorkspaceState } from '../types';
import { vkClient, type Repo } from '../lib/vk-client';
import type {
  GasCityDashboardState,
  GasCityPluginModule,
} from '../modules/plugins/gas-city/types';
import type {
  TabGroupFactoryContribution,
  TabPresetContribution,
} from '../modules/plugins/vibe-dashboard/types';
import { applyUrlTemplate, getBaseOrigin } from '../utils/origin';

interface AddTabModalProps {
  isOpen: boolean;
  onClose: () => void;
  tabPresets: TabPresetContribution[];
  tabGroupFactories: TabGroupFactoryContribution[];
  onAdd: (title: string, url: string) => void;
  onAddVKWorkspace?: (
    workspaceId: string,
    name: string,
    containerRef: string,
  ) => void;
  onAddVKWorkspaceToSpace?: (
    workspaceId: string,
    name: string,
    containerRef: string,
    spaceId: string,
  ) => void;
  onNavigateToTabGroup?: (spaceId: string, tabGroupId: string) => void;
  onAddTabGroup?: (label: string) => void;
  workspace?: WorkspaceState;
  gasCity?: {
    state: GasCityDashboardState;
    actions: GasCityPluginModule['actions'];
  };
}

type NewWorkspaceWorkflowMode = 'plain_vk' | 'gc_worker' | 'gc_worker_review';

type MenuEntry =
  | {
      kind: 'factory';
      key: string;
      title: string;
      description: string;
      launchMode: 'vk-workspace' | 'new-workspace';
      order: number;
    }
  | {
      kind: 'preset';
      key: string;
      title: string;
      description: string;
      mode: 'immediate' | 'urlPrompt';
      urlTemplate: string;
      defaultTitle?: string;
      order: number;
    }
  | {
      kind: 'custom';
      key: 'custom-url';
      title: string;
      description: string;
      order: number;
    }
  | {
      kind: 'new-tab-group';
      key: 'new-tab-group';
      title: string;
      description: string;
      order: number;
    };

export function AddTabModal({
  isOpen,
  onClose,
  tabPresets,
  tabGroupFactories,
  onAdd,
  onAddVKWorkspace,
  onAddVKWorkspaceToSpace,
  onNavigateToTabGroup,
  onAddTabGroup,
  workspace,
  gasCity,
}: AddTabModalProps) {
  const [title, setTitle] = useState('');
  const [url, setUrl] = useState('');
  const [showCustom, setShowCustom] = useState(false);
  const [showVKWorkspace, setShowVKWorkspace] = useState(false);
  const [showNewWorkspace, setShowNewWorkspace] = useState(false);
  const [showTabGroupInput, setShowTabGroupInput] = useState(false);
  const [tabGroupLabel, setTabGroupLabel] = useState('');

  const entries = useMemo<MenuEntry[]>(() => {
    const pluginFactories: MenuEntry[] = tabGroupFactories.map((factory) => ({
      kind: 'factory',
      key: factory.key,
      title: factory.title,
      description: factory.description,
      launchMode: factory.launchMode,
      order: factory.order ?? 0,
    }));

    const pluginPresets: MenuEntry[] = tabPresets.map((preset) => {
      const entry: MenuEntry = {
        kind: 'preset',
        key: preset.key,
        title: preset.title,
        description: preset.description,
        mode: preset.mode,
        urlTemplate: preset.urlTemplate,
        order: preset.order ?? 0,
      };

      if (preset.defaultTitle) {
        entry.defaultTitle = preset.defaultTitle;
      }

      return entry;
    });

    const builtIns: MenuEntry[] = [
      {
        kind: 'custom',
        key: 'custom-url',
        title: 'Custom URL',
        description: 'Enter a custom URL',
        order: 900,
      },
      {
        kind: 'new-tab-group',
        key: 'new-tab-group',
        title: 'New Tab Group',
        description: 'Create another tab group in this space',
        order: 910,
      },
    ];

    return [...pluginFactories, ...pluginPresets, ...builtIns]
      .filter((entry) => entry.kind !== 'new-tab-group' || Boolean(onAddTabGroup))
      .sort((a, b) => a.order - b.order);
  }, [onAddTabGroup, tabGroupFactories, tabPresets]);

  const handleEntrySelect = (selectedKey: string) => {
    const entry = entries.find((value) => value.key === selectedKey);
    if (!entry) {
      return;
    }

    if (entry.kind === 'custom') {
      setTitle('');
      setUrl('');
      setShowCustom(true);
      return;
    }

    if (entry.kind === 'new-tab-group') {
      setShowTabGroupInput(true);
      return;
    }

    if (entry.kind === 'factory') {
      if (entry.launchMode === 'vk-workspace') {
        setShowVKWorkspace(true);
      }
      if (entry.launchMode === 'new-workspace') {
        setShowNewWorkspace(true);
      }
      return;
    }

    if (entry.mode === 'urlPrompt') {
      const resolvedDefaultUrl = applyUrlTemplate(entry.urlTemplate, {
        origin: getBaseOrigin(),
      });
      setTitle(entry.defaultTitle ?? entry.title);
      setUrl(resolvedDefaultUrl);
      setShowCustom(true);
      return;
    }

    const resolvedUrl = applyUrlTemplate(entry.urlTemplate, {
      origin: getBaseOrigin(),
    });

    onAdd(entry.title, resolvedUrl);
    handleClose();
  };

  const handleCustomSubmit = () => {
    if (title.trim() && url.trim()) {
      onAdd(title.trim(), url.trim());
      handleClose();
    }
  };

  const handleVKWorkspaceAdd = (
    workspaceId: string,
    name: string,
    containerRef: string,
  ) => {
    if (onAddVKWorkspace) {
      onAddVKWorkspace(workspaceId, name, containerRef);
    }
    handleClose();
  };

  const handleTabGroupSubmit = () => {
    const label = tabGroupLabel.trim();
    if (label && onAddTabGroup) {
      onAddTabGroup(label);
      handleClose();
    }
  };

  const handleClose = () => {
    setTitle('');
    setUrl('');
    setTabGroupLabel('');
    setShowCustom(false);
    setShowVKWorkspace(false);
    setShowNewWorkspace(false);
    setShowTabGroupInput(false);
    onClose();
  };

  return (
    <>
      <Modal isOpen={isOpen} onClose={handleClose} size="sm" backdrop="blur">
        <ModalContent className="bg-neutral-900 border border-neutral-800 text-neutral-100">
          <ModalHeader className="text-sm border-b border-neutral-800 text-white">
            {showTabGroupInput ? 'New Tab Group' : 'Add Tab'}
          </ModalHeader>
          <ModalBody>
            {!showCustom && !showTabGroupInput ? (
              <Listbox
                aria-label="Tab presets"
                onAction={(key) => handleEntrySelect(key as string)}
              >
                {entries.map((entry) => (
                  <ListboxItem
                    key={entry.key}
                    description={entry.description}
                    className="text-neutral-100"
                    classNames={{
                      description: 'text-neutral-400',
                    }}
                  >
                    {entry.title}
                  </ListboxItem>
                ))}
              </Listbox>
            ) : showTabGroupInput ? (
              <div className="space-y-3">
                <Input
                  label="Tab Group Name"
                  size="sm"
                  value={tabGroupLabel}
                  onChange={(e) => setTabGroupLabel(e.target.value)}
                  placeholder="Development"
                  autoFocus
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleTabGroupSubmit();
                  }}
                  classNames={{
                    inputWrapper:
                      'bg-neutral-800 border-neutral-700 data-[hover=true]:bg-neutral-800 group-data-[focus=true]:bg-neutral-800',
                    input: 'text-white',
                    label: 'text-neutral-300',
                  }}
                />
              </div>
            ) : (
              <div className="space-y-3">
                <Input
                  label="Title"
                  size="sm"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="My Tab"
                  autoFocus
                  classNames={{
                    inputWrapper:
                      'bg-neutral-800 border-neutral-700 data-[hover=true]:bg-neutral-800 group-data-[focus=true]:bg-neutral-800',
                    input: 'text-white',
                    label: 'text-neutral-300',
                  }}
                />
                <Input
                  label="URL"
                  size="sm"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  placeholder="/path or full URL"
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleCustomSubmit();
                  }}
                  classNames={{
                    inputWrapper:
                      'bg-neutral-800 border-neutral-700 data-[hover=true]:bg-neutral-800 group-data-[focus=true]:bg-neutral-800',
                    input: 'text-white',
                    label: 'text-neutral-300',
                  }}
                />
              </div>
            )}
          </ModalBody>
          {showCustom && (
            <ModalFooter className="border-t border-neutral-800">
              <Button
                size="sm"
                variant="flat"
                onPress={() => setShowCustom(false)}
                className="bg-neutral-800 text-neutral-200"
              >
                Back
              </Button>
              <Button size="sm" color="primary" onPress={handleCustomSubmit}>
                Add
              </Button>
            </ModalFooter>
          )}
          {showTabGroupInput && (
            <ModalFooter className="border-t border-neutral-800">
              <Button
                size="sm"
                variant="flat"
                onPress={() => setShowTabGroupInput(false)}
                className="bg-neutral-800 text-neutral-200"
              >
                Back
              </Button>
              <Button size="sm" color="primary" onPress={handleTabGroupSubmit}>
                Create
              </Button>
            </ModalFooter>
          )}
        </ModalContent>
      </Modal>

      <AddVKWorkspaceModal
        isOpen={showVKWorkspace}
        onClose={() => setShowVKWorkspace(false)}
        onComplete={handleClose}
        onAdd={handleVKWorkspaceAdd}
        onAddToSpace={onAddVKWorkspaceToSpace}
        onNavigateToTabGroup={onNavigateToTabGroup}
        workspaceState={workspace}
      />

      <NewWorkspaceModal
        isOpen={showNewWorkspace}
        onClose={() => setShowNewWorkspace(false)}
        onComplete={handleClose}
        onAdd={handleVKWorkspaceAdd}
        gasCity={gasCity}
      />
    </>
  );
}

interface NewWorkspaceModalProps {
  isOpen: boolean;
  onClose: () => void;
  onComplete: () => void;
  onAdd: (workspaceId: string, name: string, containerRef: string) => void;
  gasCity?: {
    state: GasCityDashboardState;
    actions: GasCityPluginModule['actions'];
  };
}

function NewWorkspaceModal({
  isOpen,
  onClose,
  onComplete,
  onAdd,
  gasCity,
}: NewWorkspaceModalProps) {
  const [repos, setRepos] = useState<Repo[]>([]);
  const [reposLoading, setReposLoading] = useState(false);
  const [repoId, setRepoId] = useState('');
  const [workspaceName, setWorkspaceName] = useState('');
  const [branch, setBranch] = useState('main');
  const [executor, setExecutor] = useState('CODEX');
  const [prompt, setPrompt] = useState('');
  const [workflowMode, setWorkflowMode] =
    useState<NewWorkspaceWorkflowMode>('plain_vk');
  const [workerTemplate, setWorkerTemplate] = useState('worker');
  const [workerAlias, setWorkerAlias] = useState('');
  const [reviewerTemplate, setReviewerTemplate] = useState('reviewer');
  const [workflowPreset, setWorkflowPreset] = useState('worker-review');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  React.useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    const loadRepos = async () => {
      setReposLoading(true);
      setError(null);
      try {
        const nextRepos = await vkClient.getRepos();
        if (cancelled) return;
        setRepos(nextRepos);
        setRepoId((current) => current || nextRepos[0]?.id || '');
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : 'Failed to load repositories');
      } finally {
        if (!cancelled) setReposLoading(false);
      }
    };
    void loadRepos();
    return () => {
      cancelled = true;
    };
  }, [isOpen]);

  const selectedRepo = repos.find((repo) => repo.id === repoId);
  const requiresGasCity = workflowMode !== 'plain_vk';
  const canSubmit =
    Boolean(selectedRepo) &&
    Boolean(prompt.trim()) &&
    (!requiresGasCity ||
      (Boolean(gasCity) &&
        Boolean(gasCity?.state.cityPath.trim()) &&
        Boolean(workerTemplate.trim())));

  const refreshWorkspaceContainerAndRefetch = async (workspaceId: string) => {
    let workspace = await vkClient.getWorkspace(workspaceId);
    for (let attempt = 0; attempt < 3 && !workspace.container_ref; attempt += 1) {
      await vkClient.getWorkspaceBranchStatus(workspaceId);
      await new Promise((resolve) => setTimeout(resolve, 500));
      workspace = await vkClient.getWorkspace(workspaceId);
    }
    return workspace;
  };

  const handleSubmit = async () => {
    if (!selectedRepo || !prompt.trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      const name =
        workspaceName.trim() || selectedRepo.display_name || selectedRepo.name;
      const created = await vkClient.createAndStartWorkspace({
        name,
        repos: [
          {
            repo_id: selectedRepo.id,
            target_branch: branch.trim() || 'main',
          },
        ],
        linked_issue: null,
        executor_config: { executor: executor.trim() || 'CODEX' },
        prompt: prompt.trim(),
        attachment_ids: null,
      });
      const workspace = await refreshWorkspaceContainerAndRefetch(
        created.workspace.id,
      );
      const containerRef = workspace.container_ref || created.workspace.container_ref;
      if (!containerRef) {
        throw new Error(
          'Workspace was created, but VK has not reported a container path yet. Retry opening the workspace from the workspace search.',
        );
      }
      onAdd(created.workspace.id, workspace.name || name, containerRef);

      if (requiresGasCity) {
        if (!gasCity) {
          throw new Error('Gas City plugin is unavailable for this workflow.');
        }
        await gasCity.actions.bootstrapSessionFromWorkspace({
          workspaceId: created.workspace.id,
          workspaceName: workspace.name || name,
          sessionId: created.execution_process.session_id,
          template: workerTemplate.trim(),
          alias: workerAlias.trim() || undefined,
          title: `${workflowMode === 'gc_worker_review' ? 'Worker + review' : 'Worker'} • ${
            workspace.name || name
          }${
            workflowMode === 'gc_worker_review'
              ? ` • ${workflowPreset.trim() || 'review'}`
              : ''
          }`,
          executor: executor.trim() || 'CODEX',
          workingDir: selectedRepo.name,
        });
      }

      onComplete();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Failed to start workspace workflow',
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} size="2xl" backdrop="blur">
      <ModalContent className="bg-neutral-900 border border-neutral-800 text-neutral-100">
        <ModalHeader className="text-sm border-b border-neutral-800 text-white">
          New Workspace
        </ModalHeader>
        <ModalBody>
          <div className="space-y-4">
            <div className="grid gap-3 md:grid-cols-2">
              <Input
                label="Workspace Name"
                size="sm"
                value={workspaceName}
                onChange={(event) => setWorkspaceName(event.target.value)}
                placeholder="Auth Refactor"
                classNames={darkInputClassNames}
              />
              <div className="flex flex-col gap-1">
                <label className="text-sm text-neutral-300">Repository</label>
                <select
                  value={repoId}
                  onChange={(event) => setRepoId(event.target.value)}
                  disabled={reposLoading}
                  className="h-10 rounded-md border border-neutral-700 bg-neutral-800 px-3 text-sm text-neutral-100"
                >
                  {!repos.length ? <option value="">No repositories found</option> : null}
                  {repos.map((repo) => (
                    <option key={repo.id} value={repo.id}>
                      {repo.display_name || repo.name}
                    </option>
                  ))}
                </select>
              </div>
              <Input
                label="Target Branch"
                size="sm"
                value={branch}
                onChange={(event) => setBranch(event.target.value)}
                placeholder="main"
                classNames={darkInputClassNames}
              />
              <Input
                label="VK Executor"
                size="sm"
                value={executor}
                onChange={(event) => setExecutor(event.target.value)}
                placeholder="CODEX"
                classNames={darkInputClassNames}
              />
            </div>

            <div className="flex flex-col gap-1">
              <label className="text-sm text-neutral-300">Workflow</label>
              <select
                value={workflowMode}
                onChange={(event) =>
                  setWorkflowMode(event.target.value as NewWorkspaceWorkflowMode)
                }
                className="h-10 rounded-md border border-neutral-700 bg-neutral-800 px-3 text-sm text-neutral-100"
              >
                <option value="plain_vk">Start workspace</option>
                <option value="gc_worker">Worker workflow</option>
                <option value="gc_worker_review">Worker + review</option>
              </select>
              <p className="text-xs text-neutral-500">
                GC-backed workflows create a normal VK workspace first, then ask
                Gas City to adopt or extend it.
              </p>
            </div>

            {requiresGasCity ? (
              <div className="rounded-lg border border-neutral-800 bg-neutral-950 p-3">
                <div className="mb-3 flex items-center justify-between gap-2">
                  <h4 className="text-sm font-semibold text-neutral-200">
                    Workflow orchestration
                  </h4>
                  <span className="rounded-full border border-neutral-700 px-2 py-0.5 text-xs text-neutral-300">
                    {gasCity?.state.cityPath.trim() ? 'configured' : 'needs Gas City config'}
                  </span>
                </div>
                <div className="grid gap-3 md:grid-cols-2">
                  <Input
                    label="Worker Role"
                    size="sm"
                    value={workerTemplate}
                    onChange={(event) => setWorkerTemplate(event.target.value)}
                    placeholder="worker"
                    classNames={darkInputClassNames}
                  />
                  <Input
                    label="Worker Alias"
                    size="sm"
                    value={workerAlias}
                    onChange={(event) => setWorkerAlias(event.target.value)}
                    placeholder="auth-worker"
                    classNames={darkInputClassNames}
                  />
                  {workflowMode === 'gc_worker_review' ? (
                    <>
                      <Input
                        label="Reviewer Role (kickoff)"
                        size="sm"
                        value={reviewerTemplate}
                        onChange={(event) =>
                          setReviewerTemplate(event.target.value)
                        }
                        placeholder="reviewer"
                        classNames={darkInputClassNames}
                      />
                      <Input
                        label="Workflow Preset (kickoff)"
                        size="sm"
                        value={workflowPreset}
                        onChange={(event) => setWorkflowPreset(event.target.value)}
                        placeholder="worker-review"
                        classNames={darkInputClassNames}
                      />
                    </>
                  ) : null}
                </div>
              </div>
            ) : null}

            <textarea
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
              placeholder="Describe the task for the workspace session."
              className="min-h-28 w-full rounded-lg border border-neutral-700 bg-neutral-800 p-3 text-sm text-neutral-100 outline-none placeholder:text-neutral-500"
            />

            {error ? (
              <div className="rounded-lg border border-danger-500/40 bg-danger-500/10 p-3 text-sm text-danger-200">
                {error}
              </div>
            ) : null}
          </div>
        </ModalBody>
        <ModalFooter className="border-t border-neutral-800">
          <Button
            size="sm"
            variant="flat"
            onPress={onClose}
            className="bg-neutral-800 text-neutral-200"
          >
            Back
          </Button>
          <Button
            size="sm"
            color="primary"
            onPress={handleSubmit}
            isDisabled={!canSubmit}
            isLoading={submitting || reposLoading}
          >
            Start Workspace
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
}

const darkInputClassNames = {
  inputWrapper:
    'bg-neutral-800 border-neutral-700 data-[hover=true]:bg-neutral-800 group-data-[focus=true]:bg-neutral-800',
  input: 'text-white',
  label: 'text-neutral-300',
};
