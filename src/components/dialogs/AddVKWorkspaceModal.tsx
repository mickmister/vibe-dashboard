import React, { useState, useEffect } from 'react';
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
      setSelectedId(null);
      setShowPathInput(false);
      setCustomPath('');
      setCustomName('');
    }
  }, [isOpen]);

  useEffect(() => {
    // Filter task attempts based on search query
    if (!searchQuery.trim()) {
      setFilteredAttempts(taskAttempts);
    } else {
      const query = searchQuery.toLowerCase();
      setFilteredAttempts(
        taskAttempts.filter(
          (ta) =>
            ta.name?.toLowerCase().includes(query) ||
            ta.branch?.toLowerCase().includes(query) ||
            ta.agent_working_dir?.toLowerCase().includes(query)
        )
      );
    }
  }, [searchQuery, taskAttempts]);

  const refreshTaskAttemptContainerAndRefetchTaskAttempt = async (taskAttemptId: string) => {
    const response = await fetch(`/api/task-attempts/${taskAttemptId}/branch-status`);
    if (!response.ok) {
      throw new Error(`Failed to fetch workspaces: ${response.statusText}`);
    }

    const data = await response.json();
    console.log(data);

    const attempt = await fetch(`/api/task-attempts/${taskAttemptId}`).then(r => r.json());
    console.log(attempt);
    return attempt.data;
  };

  const fetchTaskAttempts = async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch('/api/task-attempts');
      if (!response.ok) {
        throw new Error(`Failed to fetch workspaces: ${response.statusText}`);
      }
      const data = await response.json();
      if (data.success && Array.isArray(data.data)) {
        // Filter out archived by default, sort by pinned then name
        const workspaces = data.data
          .filter((ta: TaskAttempt) => !ta.archived)
          .sort((a: TaskAttempt, b: TaskAttempt) => {
            if (a.pinned && !b.pinned) return -1;
            if (!a.pinned && b.pinned) return 1;
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
    <Modal isOpen={isOpen} onClose={onClose} size="2xl">
      <ModalContent>
        <ModalHeader className="flex flex-col gap-1">
          <h2 className="text-lg font-semibold">Add VK Workspace</h2>
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
                  inputWrapper: 'bg-neutral-800',
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
                  inputWrapper: 'bg-neutral-800',
                }}
                description="Provide an absolute directory path or VK workspace ID/URL"
              />
            </div>
          ) : (
            <>
              <div className="flex gap-2">
                <Input
                  placeholder="Search workspaces..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  size="sm"
                  classNames={{
                    inputWrapper: 'bg-neutral-800',
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
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </ModalBody>
        <ModalFooter>
          {showPathInput && (
            <Button
              size="sm"
              variant="flat"
              onPress={() => setShowPathInput(false)}
            >
              Back
            </Button>
          )}
          <Button color="default" variant="light" onPress={onClose}>
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
