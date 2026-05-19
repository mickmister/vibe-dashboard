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
}

type MenuEntry =
  | {
      kind: 'factory';
      key: string;
      title: string;
      description: string;
      launchMode: 'vk-workspace';
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
}: AddTabModalProps) {
  const [title, setTitle] = useState('');
  const [url, setUrl] = useState('');
  const [showCustom, setShowCustom] = useState(false);
  const [showVKWorkspace, setShowVKWorkspace] = useState(false);
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
    </>
  );
}
