import React, { type ReactNode, useMemo, useState } from "react";
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
} from "@heroui/react";
import { AddVKWorkspaceModal } from "./dialogs/AddVKWorkspaceModal";
import type { WorkspaceState } from "../types";
import type {
  TabGroupFactoryContribution,
  WorkspaceCompositionContribution,
  TabPresetContribution,
} from "../modules/plugins/vibe-dashboard/types";
import { applyUrlTemplate, getBaseOrigin } from "../utils/origin";

export type AddTabModalInitialView = 'presets' | 'custom' | 'tab-group' | 'vk-workspace';

interface VKWorkspaceModalRenderProps {
  isOpen: boolean;
  onClose: () => void;
  onComplete: () => void;
  onAdd: (
    taskAttemptId: string,
    name: string,
    containerRef: string,
  ) => void | Promise<void>;
  onAddToSpace?: (
    taskAttemptId: string,
    name: string,
    containerRef: string,
    spaceId: string,
  ) => void | Promise<void>;
  onNavigateToTabGroup?: (
    spaceId: string,
    tabGroupId: string,
    workspace?: { id: string; name: string },
  ) => void | Promise<void>;
  workspaceState?: WorkspaceState;
  pendingWorkspaceId: string | null;
  isActionPending: boolean;
  actionError: string | null;
}

export interface AddTabModalProps {
  isOpen: boolean;
  onClose: () => void;
  tabPresets: TabPresetContribution[];
  tabGroupFactories: TabGroupFactoryContribution[];
  onAdd: (title: string, url: string) => void;
  onAddVKWorkspace?: (
    taskAttemptId: string,
    name: string,
    containerRef: string,
    factoryKey: string,
  ) => void | Promise<void>;
  onAddVKWorkspaceToSpace?: (
    taskAttemptId: string,
    name: string,
    containerRef: string,
    spaceId: string,
    factoryKey: string,
  ) => void | Promise<void>;
  onNavigateToTabGroup?: (
    spaceId: string,
    tabGroupId: string,
    workspace?: { id: string; name: string },
  ) => void | Promise<void>;
  onAddTabGroup?: (label: string) => void;
  workspace?: WorkspaceState;
  pendingWorkspaceId?: string | null;
  isActionPending?: boolean;
  actionError?: string | null;
  onResetAction?: () => void;
  initialView?: AddTabModalInitialView;
  initialTitle?: string;
  initialUrl?: string;
  initialTabGroupLabel?: string;
  renderVKWorkspaceModal?: (props: VKWorkspaceModalRenderProps) => ReactNode;
}

type MenuEntry =
  | {
      kind: "factory";
      key: string;
      title: string;
      description: string;
      launchMode: "vk-workspace";
      order: number;
      workspaceComposition?: WorkspaceCompositionContribution;
    }
  | {
      kind: "preset";
      key: string;
      title: string;
      description: string;
      mode: "immediate" | "urlPrompt";
      urlTemplate: string;
      defaultTitle?: string;
      order: number;
      workspaceComposition?: WorkspaceCompositionContribution;
    }
  | {
      kind: "custom";
      key: "custom-url";
      title: string;
      description: string;
      order: number;
      workspaceComposition?: WorkspaceCompositionContribution;
    }
  | {
      kind: "new-tab-group";
      key: "new-tab-group";
      title: string;
      description: string;
      order: number;
      workspaceComposition?: WorkspaceCompositionContribution;
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
  pendingWorkspaceId = null,
  isActionPending = false,
  actionError = null,
  onResetAction,
  initialView = 'presets',
  initialTitle = '',
  initialUrl = '',
  initialTabGroupLabel = '',
  renderVKWorkspaceModal,
}: AddTabModalProps) {
  const initialVKWorkspaceFactoryKey =
    initialView === "vk-workspace"
      ? (tabGroupFactories.find((factory) => factory.launchMode === "vk-workspace")
          ?.key ?? null)
      : null;

  const [title, setTitle] = useState(initialTitle);
  const [url, setUrl] = useState(initialUrl);
  const [showCustom, setShowCustom] = useState(initialView === "custom");
  const [selectedVKWorkspaceFactoryKey, setSelectedVKWorkspaceFactoryKey] =
    useState<string | null>(initialVKWorkspaceFactoryKey);
  const [showTabGroupInput, setShowTabGroupInput] = useState(
    initialView === "tab-group",
  );
  const [tabGroupLabel, setTabGroupLabel] = useState(initialTabGroupLabel);

  const entries = useMemo<MenuEntry[]>(() => {
    const pluginFactories: MenuEntry[] = tabGroupFactories.map((factory) => ({
      kind: "factory",
      key: factory.key,
      title: factory.title,
      description: factory.description,
      launchMode: factory.launchMode,
      order: factory.order ?? 0,
      workspaceComposition: factory.workspaceComposition,
    }));

    const pluginPresets: MenuEntry[] = tabPresets.map((preset) => {
      const entry: MenuEntry = {
        kind: "preset",
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
        kind: "custom",
        key: "custom-url",
        title: "Custom URL",
        description: "Enter a custom URL",
        order: 900,
      },
      {
        kind: "new-tab-group",
        key: "new-tab-group",
        title: "New Tab Group",
        description: "Create another tab group in this space",
        order: 910,
      },
    ];

    return [...pluginFactories, ...pluginPresets, ...builtIns]
      .filter(
        (entry) => entry.kind !== "new-tab-group" || Boolean(onAddTabGroup),
      )
      .sort((a, b) => a.order - b.order);
  }, [onAddTabGroup, tabGroupFactories, tabPresets]);

  const handleEntrySelect = (selectedKey: string) => {
    const entry = entries.find((value) => value.key === selectedKey);
    if (!entry) return;

    if (entry.kind === "custom") {
      setTitle("");
      setUrl("");
      setShowCustom(true);
      return;
    }

    if (entry.kind === "new-tab-group") {
      setShowTabGroupInput(true);
      return;
    }

    if (entry.kind === "factory") {
      if (entry.launchMode === "vk-workspace") {
        setSelectedVKWorkspaceFactoryKey(entry.key);
      }
      return;
    }

    if (entry.mode === "urlPrompt") {
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
    taskAttemptId: string,
    name: string,
    containerRef: string,
  ) => {
    if (!onAddVKWorkspace) throw new Error("Open Craft is unavailable.");
    return onAddVKWorkspace(
      taskAttemptId,
      name,
      containerRef,
      selectedVKWorkspaceFactoryKey ?? "",
    );
  };

  const handleVKWorkspaceAddToSpace = (
    taskAttemptId: string,
    name: string,
    containerRef: string,
    spaceId: string,
  ) => {
    if (!onAddVKWorkspaceToSpace) {
      throw new Error("Open Craft in space is unavailable.");
    }
    return onAddVKWorkspaceToSpace(
      taskAttemptId,
      name,
      containerRef,
      spaceId,
      selectedVKWorkspaceFactoryKey ?? "",
    );
  };

  const handleVKWorkspaceNavigate = (
    spaceId: string,
    tabGroupId: string,
    workspaceOption?: { id: string; name: string },
  ) => {
    if (!onNavigateToTabGroup) {
      throw new Error("Open Craft navigation is unavailable.");
    }
    return onNavigateToTabGroup(spaceId, tabGroupId, workspaceOption);
  };

  const handleTabGroupSubmit = () => {
    const label = tabGroupLabel.trim();
    if (label && onAddTabGroup) {
      onAddTabGroup(label);
      handleClose();
    }
  };

  const handleClose = () => {
    setTitle(initialTitle);
    setUrl(initialUrl);
    setTabGroupLabel(initialTabGroupLabel);
    setShowCustom(initialView === "custom");
    setSelectedVKWorkspaceFactoryKey(initialVKWorkspaceFactoryKey);
    setShowTabGroupInput(initialView === "tab-group");
    onResetAction?.();
    onClose();
  };

  return (
    <>
      <Modal isOpen={isOpen} onClose={handleClose} size="sm" backdrop="blur">
        <ModalContent className="bg-neutral-900 border border-neutral-800 text-neutral-100">
          <ModalHeader className="text-sm border-b border-neutral-800 text-white">
            {showTabGroupInput ? "New Craft" : "Add View"}
          </ModalHeader>
          <ModalBody>
            {!showCustom && !showTabGroupInput ? (
              <Listbox
                aria-label="View presets"
                onAction={(key) => handleEntrySelect(key as string)}
              >
                {entries.map((entry) => (
                  <ListboxItem
                    key={entry.key}
                    description={entry.description}
                    className="text-neutral-100"
                    classNames={{
                      description: "text-neutral-400",
                    }}
                  >
                    {entry.title}
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
                    if (e.key === "Enter") handleTabGroupSubmit();
                  }}
                  classNames={{
                    inputWrapper:
                      "bg-neutral-800 border-neutral-700 data-[hover=true]:bg-neutral-800 group-data-[focus=true]:bg-neutral-800",
                    input: "text-white",
                    label: "text-neutral-300",
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
                    inputWrapper:
                      "bg-neutral-800 border-neutral-700 data-[hover=true]:bg-neutral-800 group-data-[focus=true]:bg-neutral-800",
                    input: "text-white",
                    label: "text-neutral-300",
                  }}
                />
                <Input
                  label="URL"
                  size="sm"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  placeholder="/path or full URL"
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleCustomSubmit();
                  }}
                  classNames={{
                    inputWrapper:
                      "bg-neutral-800 border-neutral-700 data-[hover=true]:bg-neutral-800 group-data-[focus=true]:bg-neutral-800",
                    input: "text-white",
                    label: "text-neutral-300",
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

      {renderVKWorkspaceModal ? (
        renderVKWorkspaceModal({
          isOpen: selectedVKWorkspaceFactoryKey != null,
          onClose: () => {
            if (isActionPending) return;
            setSelectedVKWorkspaceFactoryKey(null);
            onResetAction?.();
          },
          onComplete: handleClose,
          onAdd: handleVKWorkspaceAdd,
          onAddToSpace: onAddVKWorkspaceToSpace
            ? handleVKWorkspaceAddToSpace
            : undefined,
          onNavigateToTabGroup: handleVKWorkspaceNavigate,
          workspaceState: workspace,
          pendingWorkspaceId,
          isActionPending,
          actionError,
        })
      ) : (
        <AddVKWorkspaceModal
          isOpen={selectedVKWorkspaceFactoryKey != null}
          onClose={() => {
            if (isActionPending) return;
            setSelectedVKWorkspaceFactoryKey(null);
            onResetAction?.();
          }}
          onComplete={handleClose}
          onAdd={handleVKWorkspaceAdd}
          onAddToSpace={
            onAddVKWorkspaceToSpace ? handleVKWorkspaceAddToSpace : undefined
          }
          onNavigateToTabGroup={handleVKWorkspaceNavigate}
          workspaceState={workspace}
          pendingWorkspaceId={pendingWorkspaceId}
          isActionPending={isActionPending}
          actionError={actionError}
        />
      )}
    </>
  );
}
