import React, { useEffect, useMemo, useState } from 'react';
import { Button, Input, Textarea } from '@heroui/react';
import { getBaseOrigin } from '../../../utils/origin';
import type { GasCityDashboardState, GasCityPluginModule, GasCitySessionInfo } from './types';

interface GasCityPanelProps {
  state: GasCityDashboardState;
  actions: GasCityPluginModule['actions'];
  onOpenWorkDir?: (workDir: string, title: string) => void;
}

function sessionLabel(session: GasCitySessionInfo): string {
  return session.Title || session.Alias || session.SessionName || session.Template || session.ID;
}

function sessionSecondary(session: GasCitySessionInfo): string {
  return session.Alias || session.SessionName || session.ID;
}

function timeAgoLabel(isoString: string): string {
  if (!isoString) return '-';
  const timestamp = Date.parse(isoString);
  if (Number.isNaN(timestamp)) return isoString;
  const diffMs = Date.now() - timestamp;
  const diffMinutes = Math.floor(diffMs / 60000);
  if (diffMinutes < 1) return 'just now';
  if (diffMinutes < 60) return `${diffMinutes}m ago`;
  const diffHours = Math.floor(diffMinutes / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  return `${diffDays}d ago`;
}

export function GasCityPanel({ state, actions, onOpenWorkDir }: GasCityPanelProps) {
  const [gcBinary, setGcBinary] = useState(state.gcBinary);
  const [cityPath, setCityPath] = useState(state.cityPath);
  const [template, setTemplate] = useState('');
  const [alias, setAlias] = useState('');
  const [title, setTitle] = useState('');
  const [message, setMessage] = useState('');
  const [selectedSessionId, setSelectedSessionId] = useState('');

  useEffect(() => {
    setGcBinary(state.gcBinary);
  }, [state.gcBinary]);

  useEffect(() => {
    setCityPath(state.cityPath);
  }, [state.cityPath]);

  useEffect(() => {
    if (!state.loaded && state.cityPath.trim() && !state.loading) {
      void actions.refreshSessions().catch(() => {});
    }
  }, [actions, state.cityPath, state.loaded, state.loading]);

  useEffect(() => {
    if (!selectedSessionId && state.sessions[0]?.ID) {
      setSelectedSessionId(state.sessions[0].ID);
      return;
    }
    if (
      selectedSessionId &&
      !state.sessions.some((session) => session.ID === selectedSessionId)
    ) {
      setSelectedSessionId(state.sessions[0]?.ID ?? '');
    }
  }, [selectedSessionId, state.sessions]);

  const selectedSession = useMemo(
    () => state.sessions.find((session) => session.ID === selectedSessionId) ?? null,
    [selectedSessionId, state.sessions],
  );

  const handleSaveConfig = async () => {
    await actions.setConfig({ gcBinary, cityPath });
  };

  const handleRefresh = async () => {
    await actions.refreshSessions();
  };

  const handleCreateSession = async () => {
    if (!template.trim()) return;
    await actions.setConfig({ gcBinary, cityPath });
    await actions.createSession({
      template,
      alias,
      title,
    });
    setTemplate('');
    setAlias('');
    setTitle('');
  };

  const handleSend = async (intent: 'follow_up' | 'interrupt_now') => {
    if (!selectedSession || !message.trim()) return;
    await actions.submitToSession({
      sessionId: selectedSession.ID,
      message: message.trim(),
      intent,
    });
    setMessage('');
    await actions.peekSession({ sessionId: selectedSession.ID, lines: 120 });
  };

  const handleOpenWorkDir = () => {
    if (!selectedSession?.WorkDir || !onOpenWorkDir) return;
    onOpenWorkDir(selectedSession.WorkDir, sessionLabel(selectedSession));
  };

  const currentPeek = selectedSession
    ? state.peekBySessionId[selectedSession.ID] ?? ''
    : '';

  const codeUrlPreview = selectedSession?.WorkDir
    ? `${getBaseOrigin()}/?folder=${encodeURIComponent(selectedSession.WorkDir)}`
    : '';

  return (
    <div className="h-full overflow-auto bg-neutral-950 text-neutral-100">
      <div className="mx-auto flex max-w-7xl flex-col gap-4 p-4">
        <div className="rounded-xl border border-neutral-800 bg-neutral-900 p-4">
          <div className="mb-3 flex items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold text-white">Gas City</h2>
              <p className="text-sm text-neutral-400">
                Manage sessions from a configured Gas City checkout or installed
                binary.
              </p>
            </div>
            <div className="flex gap-2">
              <Button size="sm" variant="flat" onPress={() => actions.refreshStatus()}>
                Status
              </Button>
              <Button size="sm" color="primary" onPress={handleRefresh} isLoading={state.loading}>
                Refresh Sessions
              </Button>
            </div>
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            <Input
              label="Gas City Binary"
              size="sm"
              value={gcBinary}
              onChange={(event) => setGcBinary(event.target.value)}
              placeholder="gc"
              classNames={{
                inputWrapper:
                  'bg-neutral-800 border-neutral-700 data-[hover=true]:bg-neutral-800 group-data-[focus=true]:bg-neutral-800',
                input: 'text-white',
                label: 'text-neutral-300',
              }}
            />
            <Input
              label="City Path"
              size="sm"
              value={cityPath}
              onChange={(event) => setCityPath(event.target.value)}
              placeholder="/absolute/path/to/city"
              classNames={{
                inputWrapper:
                  'bg-neutral-800 border-neutral-700 data-[hover=true]:bg-neutral-800 group-data-[focus=true]:bg-neutral-800',
                input: 'text-white',
                label: 'text-neutral-300',
              }}
            />
          </div>
          <div className="mt-3 flex gap-2">
            <Button size="sm" variant="flat" onPress={handleSaveConfig}>
              Save Config
            </Button>
            {state.error ? (
              <Button size="sm" variant="light" color="danger" onPress={() => actions.clearError()}>
                Clear Error
              </Button>
            ) : null}
          </div>
          {state.error ? (
            <div className="mt-3 rounded-lg border border-danger-500/40 bg-danger-500/10 p-3 text-sm text-danger-200">
              {state.error}
            </div>
          ) : null}
          {state.statusOutput ? (
            <pre className="mt-3 overflow-x-auto rounded-lg border border-neutral-800 bg-neutral-950 p-3 text-xs text-neutral-300">
              {state.statusOutput}
            </pre>
          ) : null}
        </div>

        <div className="rounded-xl border border-neutral-800 bg-neutral-900 p-4">
          <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-neutral-300">
            Create Session
          </h3>
          <div className="grid gap-3 md:grid-cols-3">
            <Input
              label="Template"
              size="sm"
              value={template}
              onChange={(event) => setTemplate(event.target.value)}
              placeholder="helper"
              classNames={{
                inputWrapper:
                  'bg-neutral-800 border-neutral-700 data-[hover=true]:bg-neutral-800 group-data-[focus=true]:bg-neutral-800',
                input: 'text-white',
                label: 'text-neutral-300',
              }}
            />
            <Input
              label="Alias"
              size="sm"
              value={alias}
              onChange={(event) => setAlias(event.target.value)}
              placeholder="mayor"
              classNames={{
                inputWrapper:
                  'bg-neutral-800 border-neutral-700 data-[hover=true]:bg-neutral-800 group-data-[focus=true]:bg-neutral-800',
                input: 'text-white',
                label: 'text-neutral-300',
              }}
            />
            <Input
              label="Title"
              size="sm"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="Investigate integration"
              classNames={{
                inputWrapper:
                  'bg-neutral-800 border-neutral-700 data-[hover=true]:bg-neutral-800 group-data-[focus=true]:bg-neutral-800',
                input: 'text-white',
                label: 'text-neutral-300',
              }}
            />
          </div>
          <div className="mt-3">
            <Button
              size="sm"
              color="primary"
              onPress={handleCreateSession}
              isDisabled={!template.trim()}
              isLoading={state.loading}
            >
              Create Session
            </Button>
          </div>
        </div>

        <div className="grid min-h-[420px] gap-4 lg:grid-cols-[minmax(320px,420px)_1fr]">
          <div className="rounded-xl border border-neutral-800 bg-neutral-900 p-4">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-sm font-semibold uppercase tracking-wide text-neutral-300">
                Sessions
              </h3>
              <span className="text-xs text-neutral-500">
                {state.sessions.length} total
              </span>
            </div>

            {state.sessions.length === 0 ? (
              <div className="rounded-lg border border-dashed border-neutral-800 bg-neutral-950 p-4 text-sm text-neutral-500">
                {state.loaded
                  ? 'No sessions found. Create one above or refresh after configuring a city.'
                  : 'Configure a city path, then refresh to load sessions.'}
              </div>
            ) : (
              <div className="flex max-h-[560px] flex-col gap-2 overflow-auto">
                {state.sessions.map((session) => {
                  const selected = session.ID === selectedSessionId;
                  return (
                    <button
                      key={session.ID}
                      type="button"
                      onClick={() => setSelectedSessionId(session.ID)}
                      className={`rounded-lg border p-3 text-left transition-colors ${
                        selected
                          ? 'border-primary-500 bg-primary-500/10'
                          : 'border-neutral-800 bg-neutral-950 hover:bg-neutral-800/70'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-3">
                        <div className="min-w-0">
                          <div className="truncate text-sm font-medium text-white">
                            {sessionLabel(session)}
                          </div>
                          <div className="truncate text-xs text-neutral-400">
                            {sessionSecondary(session)}
                          </div>
                        </div>
                        <span className="rounded bg-neutral-800 px-2 py-0.5 text-[10px] uppercase tracking-wide text-neutral-300">
                          {session.State || 'closed'}
                        </span>
                      </div>
                      <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-neutral-500">
                        <span>Template: {session.Template || '-'}</span>
                        <span>Provider: {session.Provider || '-'}</span>
                        <span>Last active: {timeAgoLabel(session.LastActive)}</span>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          <div className="rounded-xl border border-neutral-800 bg-neutral-900 p-4">
            {selectedSession ? (
              <div className="flex h-full flex-col gap-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h3 className="text-lg font-semibold text-white">
                      {sessionLabel(selectedSession)}
                    </h3>
                    <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-sm text-neutral-400">
                      <span>ID: {selectedSession.ID}</span>
                      <span>Alias: {selectedSession.Alias || '-'}</span>
                      <span>Template: {selectedSession.Template || '-'}</span>
                      <span>State: {selectedSession.State || 'closed'}</span>
                    </div>
                  </div>
                  <div className="flex flex-wrap justify-end gap-2">
                    <Button size="sm" variant="flat" onPress={() => actions.peekSession({ sessionId: selectedSession.ID, lines: 120 })}>
                      Peek
                    </Button>
                    <Button size="sm" variant="flat" onPress={() => actions.wakeSession({ sessionId: selectedSession.ID })}>
                      Wake
                    </Button>
                    <Button size="sm" variant="flat" onPress={() => actions.suspendSession({ sessionId: selectedSession.ID })}>
                      Suspend
                    </Button>
                    <Button size="sm" color="danger" variant="flat" onPress={() => actions.killSession({ sessionId: selectedSession.ID })}>
                      Kill
                    </Button>
                  </div>
                </div>

                <div className="grid gap-3 md:grid-cols-2">
                  <div className="rounded-lg border border-neutral-800 bg-neutral-950 p-3">
                    <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-neutral-400">
                      Workdir
                    </div>
                    <div className="break-all text-sm text-neutral-300">
                      {selectedSession.WorkDir || '-'}
                    </div>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <Button
                        size="sm"
                        variant="flat"
                        onPress={handleOpenWorkDir}
                        isDisabled={!selectedSession.WorkDir || !onOpenWorkDir}
                      >
                        Open in Code
                      </Button>
                    </div>
                    {codeUrlPreview ? (
                      <div className="mt-2 text-xs text-neutral-500">
                        {codeUrlPreview}
                      </div>
                    ) : null}
                  </div>
                  <div className="rounded-lg border border-neutral-800 bg-neutral-950 p-3">
                    <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-neutral-400">
                      Runtime
                    </div>
                    <div className="space-y-1 text-sm text-neutral-300">
                      <div>Provider: {selectedSession.Provider || '-'}</div>
                      <div>Transport: {selectedSession.Transport || '-'}</div>
                      <div>Created: {selectedSession.CreatedAt || '-'}</div>
                      <div>Last active: {selectedSession.LastActive || '-'}</div>
                    </div>
                  </div>
                </div>

                <div className="rounded-lg border border-neutral-800 bg-neutral-950 p-3">
                  <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-neutral-400">
                    Submit Message
                  </div>
                  <Textarea
                    minRows={4}
                    value={message}
                    onValueChange={setMessage}
                    placeholder="Ask the session to continue, summarize, or change direction..."
                    classNames={{
                      inputWrapper:
                        'bg-neutral-900 border-neutral-800 data-[hover=true]:bg-neutral-900 group-data-[focus=true]:bg-neutral-900',
                      input: 'text-white',
                    }}
                  />
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Button
                      size="sm"
                      color="primary"
                      onPress={() => handleSend('follow_up')}
                      isDisabled={!message.trim()}
                    >
                      Send Follow-up
                    </Button>
                    <Button
                      size="sm"
                      variant="flat"
                      color="warning"
                      onPress={() => handleSend('interrupt_now')}
                      isDisabled={!message.trim()}
                    >
                      Interrupt + Send
                    </Button>
                  </div>
                </div>

                <div className="grid flex-1 gap-4 xl:grid-cols-[1fr_340px]">
                  <div className="rounded-lg border border-neutral-800 bg-neutral-950 p-3">
                    <div className="mb-2 flex items-center justify-between gap-2">
                      <div className="text-xs font-semibold uppercase tracking-wide text-neutral-400">
                        Peek Output
                      </div>
                      <Button
                        size="sm"
                        variant="light"
                        onPress={() => actions.peekSession({ sessionId: selectedSession.ID, lines: 200 })}
                      >
                        Refresh Peek
                      </Button>
                    </div>
                    <pre className="max-h-[360px] overflow-auto whitespace-pre-wrap break-words text-xs text-neutral-300">
                      {currentPeek || 'No peek output loaded yet.'}
                    </pre>
                  </div>
                  <div className="rounded-lg border border-neutral-800 bg-neutral-950 p-3">
                    <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-neutral-400">
                      Last Command Output
                    </div>
                    <pre className="max-h-[360px] overflow-auto whitespace-pre-wrap break-words text-xs text-neutral-300">
                      {state.lastCommandOutput || 'No command output yet.'}
                    </pre>
                  </div>
                </div>
              </div>
            ) : (
              <div className="flex h-full items-center justify-center rounded-lg border border-dashed border-neutral-800 bg-neutral-950 p-6 text-sm text-neutral-500">
                Select a session to inspect and control it.
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
