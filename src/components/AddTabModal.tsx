import React, { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
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

interface AddTabModalProps {
  isOpen: boolean;
  onClose: () => void;
  onAdd: (title: string, url: string) => void;
  onAddVKWorkspace?: (
    taskAttemptId: string,
    name: string,
    containerRef: string,
  ) => void | Promise<void>;
  onAddVKWorkspaceToSpace?: (
    taskAttemptId: string,
    name: string,
    containerRef: string,
    spaceId: string
  ) => void | Promise<void>;
  onNavigateToTabGroup?: (
    spaceId: string,
    tabGroupId: string,
    workspace?: { id: string; name: string },
  ) => void | Promise<void>;
  onAddTabGroup?: (label: string) => void;
  workspace?: WorkspaceState;
}

const PRESETS = [
  {
    key: 'vk-workspace',
    title: 'Open Existing Craft',
    url: '',
    description: 'Add craft with Agent + Code split view',
  },
  {
    key: 'tab-group',
    title: 'New Craft',
    url: '',
    description: 'Create an empty craft in this space',
  },
  {
    key: 'code',
    title: 'Code Server',
    url: '', // Will be provided by user via custom input
    description: 'VS Code editor with custom folder path',
  },
  {
    key: 'kanban',
    title: 'Kanban',
    url: '/',
    description: 'Vibe Kanban board view',
  },
  {
    key: 'custom',
    title: 'Custom URL',
    url: '',
    description: 'Enter a custom URL',
  },
];

export function AddTabModal({
  isOpen,
  onClose,
  onAdd,
  onAddVKWorkspace,
  onAddVKWorkspaceToSpace,
  onNavigateToTabGroup,
  onAddTabGroup,
  workspace,
}: AddTabModalProps) {
  const [title, setTitle] = useState('');
  const [url, setUrl] = useState('');
  const [showCustom, setShowCustom] = useState(false);
  const [showVKWorkspace, setShowVKWorkspace] = useState(false);
  const [showTabGroupInput, setShowTabGroupInput] = useState(false);
  const [tabGroupLabel, setTabGroupLabel] = useState('');
  const openCraftMutation = useMutation<
    void,
    Error,
    | {
        kind: 'add';
        workspaceId: string;
        name: string;
        containerRef: string;
      }
    | {
        kind: 'add-to-space';
        workspaceId: string;
        name: string;
        containerRef: string;
        spaceId: string;
      }
    | {
        kind: 'navigate';
        workspaceId: string;
        name: string;
        spaceId: string;
        tabGroupId: string;
      }
  >({
    mutationFn: async (request) => {
      if (request.kind === 'navigate') {
        if (!onNavigateToTabGroup) {
          throw new Error('Open Craft navigation is unavailable.');
        }
        await onNavigateToTabGroup(request.spaceId, request.tabGroupId, {
          id: request.workspaceId,
          name: request.name,
        });
        return;
      }

      if (request.kind === 'add-to-space') {
        if (!onAddVKWorkspaceToSpace) {
          throw new Error('Open Craft in space is unavailable.');
        }
        await onAddVKWorkspaceToSpace(
          request.workspaceId,
          request.name,
          request.containerRef,
          request.spaceId,
        );
        return;
      }

      if (!onAddVKWorkspace) {
        throw new Error('Open Craft is unavailable.');
      }
      await onAddVKWorkspace(
        request.workspaceId,
        request.name,
        request.containerRef,
      );
    },
  });
  const pendingWorkspaceId =
    openCraftMutation.isPending && openCraftMutation.variables
      ? openCraftMutation.variables.workspaceId
      : null;

  const handlePresetSelect = (key: string) => {
    const preset = PRESETS.find((p) => p.key === key);
    if (!preset) return;

    if (key === 'custom' || key === 'code') {
      setShowCustom(true);
      if (key === 'code') {
        setTitle('Code Server');
        setUrl('/?folder=');
      }
      return;
    }

    if (key === 'vk-workspace') {
      setShowVKWorkspace(true);
      return;
    }

    if (key === 'tab-group') {
      setShowTabGroupInput(true);
      return;
    }

    onAdd(preset.title, preset.url);
    handleClose();
  };

  const handleCustomSubmit = () => {
    if (title.trim() && url.trim()) {
      onAdd(title.trim(), url.trim());
      handleClose();
    }
  };

  const handleVKWorkspaceAdd = (
    taskAttemptId: string,
    name: string,
    containerRef: string
  ) => {
    return openCraftMutation.mutateAsync({
      kind: 'add',
      workspaceId: taskAttemptId,
      name,
      containerRef,
    });
  };

  const handleVKWorkspaceAddToSpace = (
    taskAttemptId: string,
    name: string,
    containerRef: string,
    spaceId: string,
  ) => {
    return openCraftMutation.mutateAsync({
      kind: 'add-to-space',
      workspaceId: taskAttemptId,
      name,
      containerRef,
      spaceId,
    });
  };

  const handleVKWorkspaceNavigate = (
    spaceId: string,
    tabGroupId: string,
    workspaceOption?: { id: string; name: string },
  ) => {
    return openCraftMutation.mutateAsync({
      kind: 'navigate',
      workspaceId: workspaceOption?.id || tabGroupId,
      name: workspaceOption?.name || 'craft',
      spaceId,
      tabGroupId,
    });
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
    setShowTabGroupInput(false);
    openCraftMutation.reset();
    onClose();
  };

  const visiblePresets = PRESETS.filter(
    (preset) => preset.key !== 'tab-group' || Boolean(onAddTabGroup),
  );

  return (
    <>
      <Modal isOpen={isOpen} onClose={handleClose} size="sm" backdrop="blur">
        <ModalContent className="bg-neutral-900 border border-neutral-800 text-neutral-100">
          <ModalHeader className="text-sm border-b border-neutral-800 text-white">
            {showTabGroupInput ? 'New Craft' : 'Add View'}
          </ModalHeader>
          <ModalBody>
            {!showCustom && !showTabGroupInput ? (
              <Listbox
                aria-label="View presets"
                onAction={(key) => handlePresetSelect(key as string)}
              >
                {visiblePresets.map((preset) => (
                  <ListboxItem
                    key={preset.key}
                    description={preset.description}
                    className="text-neutral-100"
                    classNames={{
                      description: 'text-neutral-400',
                    }}
                  >
                    {preset.title}
                  </ListboxItem>
                ))}
              </Listbox>
            ) : showTabGroupInput ? (
              <div className="space-y-3">
                <Input
                  label="Craft Name"
                  size="sm"
                  value={tabGroupLabel}
                  onChange={(e) => setTabGroupLabel(e.target.value)}
                  placeholder="Development"
                  autoFocus
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleTabGroupSubmit();
                  }}
                  classNames={{
                    inputWrapper: 'bg-neutral-800 border-neutral-700 data-[hover=true]:bg-neutral-800 group-data-[focus=true]:bg-neutral-800',
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
                  placeholder="My View"
                  autoFocus
                  classNames={{
                    inputWrapper: 'bg-neutral-800 border-neutral-700 data-[hover=true]:bg-neutral-800 group-data-[focus=true]:bg-neutral-800',
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
                    inputWrapper: 'bg-neutral-800 border-neutral-700 data-[hover=true]:bg-neutral-800 group-data-[focus=true]:bg-neutral-800',
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
        onClose={() => {
          if (openCraftMutation.isPending) return;
          setShowVKWorkspace(false);
          openCraftMutation.reset();
        }}
        onComplete={handleClose}
        onAdd={handleVKWorkspaceAdd}
        onAddToSpace={
          onAddVKWorkspaceToSpace ? handleVKWorkspaceAddToSpace : undefined
        }
        onNavigateToTabGroup={handleVKWorkspaceNavigate}
        workspaceState={workspace}
        pendingWorkspaceId={pendingWorkspaceId}
        isActionPending={openCraftMutation.isPending}
        actionError={
          openCraftMutation.isError
            ? getAddTabErrorMessage(openCraftMutation.error)
            : null
        }
      />
    </>
  );
}

function getAddTabErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim()) return error.message;
  if (typeof error === 'string' && error.trim()) return error;
  return 'Open Craft failed. Please retry or cancel.';
}
