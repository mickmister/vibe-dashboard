import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { FileDiff } from '@pierre/diffs/react';
import type {
  DiffLineAnnotation,
  FileDiffMetadata,
  OnDiffLineClickProps,
} from '@pierre/diffs';
import { Button, Input, Select, SelectItem, Textarea } from '@heroui/react';
import {
  vkClient,
  type ReviewDraftComment,
  type Session,
} from '../lib/vk-client';
import { hasRenderableDiff, parseRepoPatch } from '../lib/diffPatch';
import { selectDiffSessionId } from '../lib/diffSessionSelection';

type DiffRepo = {
  name: string;
  path: string;
  relativePath: string;
  branch: string | null;
  targetBranch: string | null;
  baseRef: string | null;
  headRef: string;
  commits: Array<{ sha: string; subject: string }>;
  files: Array<{ path: string; status: string }>;
  patch: string;
  error?: string;
};

type DiffResponse = {
  workspaceDir: string;
  repos: DiffRepo[];
};

type DraftComment = {
  repoName: string;
  filePath: string;
  lineNumber: string;
  body: string;
  codeLine?: string | null;
  side?: 'additions' | 'deletions';
};

interface DiffViewProps {
  workspaceId: string;
  workspaceDir: string;
}

export function DiffView({ workspaceId, workspaceDir }: DiffViewProps) {
  const [data, setData] = useState<DiffResponse | null>(null);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [selectedSessionId, setSelectedSessionId] = useState("");
  const [selectedRepoName, setSelectedRepoName] = useState("");
  const [selectedFilePath, setSelectedFilePath] = useState("");
  const [lineNumber, setLineNumber] = useState("1");
  const [selectedCodeLine, setSelectedCodeLine] = useState<string | null>(null);
  const [selectedLineSide, setSelectedLineSide] = useState<
    'additions' | 'deletions'
  >('additions');
  const [commentBody, setCommentBody] = useState("");
  const [queuedComments, setQueuedComments] = useState<DraftComment[]>([]);
  const [selectedHeadRefs, setSelectedHeadRefs] = useState<
    Record<string, string>
  >({});
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        workspaceId,
        workspaceDir,
      });
      if (Object.keys(selectedHeadRefs).length > 0) {
        params.set("headRefs", JSON.stringify(selectedHeadRefs));
      }
      const [diffResponse, sessionResponse] = await Promise.all([
        fetch(`/dashboard/api/diff?${params.toString()}`),
        vkClient.getSessions(workspaceId),
      ]);
      if (!diffResponse.ok) {
        throw new Error(`Diff request failed: ${diffResponse.statusText}`);
      }
      const diffData = (await diffResponse.json()) as DiffResponse;
      setData(diffData);
      // VK returns workspace sessions in most-recently-used order. Preserve that
      // ordering so Diff comments default to VK's selected recency policy.
      setSessions(sessionResponse);
      setSelectedSessionId(
        (current) => selectDiffSessionId(sessionResponse, current),
      );
      const firstRepoWithPatch = diffData.repos.find((repo) => repo.patch);
      setSelectedRepoName(
        (current) =>
          current || firstRepoWithPatch?.name || diffData.repos[0]?.name || "",
      );
      setSelectedFilePath(
        (current) => current || firstRepoWithPatch?.files[0]?.path || "",
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [selectedHeadRefs, workspaceDir, workspaceId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const selectedRepo = useMemo(
    () =>
      data?.repos.find((repo) => repo.name === selectedRepoName) ??
      data?.repos[0],
    [data?.repos, selectedRepoName],
  );

  const selectedRepoFiles = selectedRepo?.files ?? [];
  const selectedHeadRef =
    selectedRepo
      ? (selectedHeadRefs[selectedRepo.relativePath] ?? "HEAD")
      : "HEAD";
  const commitOptions = useMemo(
    () =>
      selectedRepo
        ? [
            { key: "HEAD", label: "Latest on branch" },
            ...selectedRepo.commits.map((commit) => ({
              key: commit.sha,
              label: `${commit.sha.slice(0, 8)} ${commit.subject}`,
            })),
          ]
        : [],
    [selectedRepo],
  );
  const parsedRepoPatch = useMemo(
    () =>
      selectedRepo?.patch
        ? parseRepoPatch(selectedRepo.patch, selectedRepo.relativePath)
        : { files: [], error: null },
    [selectedRepo?.patch, selectedRepo?.relativePath],
  );

  useEffect(() => {
    if (!selectedRepo) return;
    if (
      selectedFilePath &&
      selectedRepoFiles.some((file) => file.path === selectedFilePath)
    )
      return;
    setSelectedFilePath(selectedRepoFiles[0]?.path || "");
  }, [selectedFilePath, selectedRepo, selectedRepoFiles]);

  const addQueuedComment = (override?: Partial<DraftComment>) => {
    const filePath = selectedFilePath.trim();
    const body = (override?.body ?? commentBody).trim();
    const repoName = selectedRepo?.name || selectedRepoName;
    if (!repoName || !filePath || !body) return;
    setQueuedComments((current) => [
      ...current,
      {
        repoName,
        filePath: override?.filePath ?? filePath,
        lineNumber: (override?.lineNumber ?? lineNumber) || "1",
        body,
        codeLine: override?.codeLine ?? selectedCodeLine,
        side: override?.side ?? selectedLineSide,
      },
    ]);
    setCommentBody("");
    setSelectedCodeLine(null);
    setSuccess(null);
  };

  const stageLineComment = useCallback(
    (fileDiff: FileDiffMetadata, line: OnDiffLineClickProps) => {
      const nextLineNumber = String(line.lineNumber);
      const nextFilePath = fileDiff.name;
      setSelectedFilePath(nextFilePath);
      setLineNumber(nextLineNumber);
      setSelectedCodeLine(line.lineElement.textContent?.trim() || null);
      setSelectedLineSide(line.annotationSide);
      setCommentBody((current) => current || "");
      setSuccess(null);
    },
    [],
  );

  const submitComments = async () => {
    if (!selectedSessionId || queuedComments.length === 0) return;
    setSubmitting(true);
    setError(null);
    setSuccess(null);
    try {
      const comments: ReviewDraftComment[] = queuedComments.map((comment) => ({
        file_path:
          comment.repoName === "."
            ? comment.filePath
            : `${comment.repoName}/${comment.filePath}`,
        line_number: Number.parseInt(comment.lineNumber, 10) || 1,
        body: comment.body,
        code_line: comment.codeLine ?? null,
      }));
      const result = await vkClient.appendReviewComments(
        selectedSessionId,
        comments,
      );
      setQueuedComments([]);
      setSuccess(
        `${result.comments_appended} review comment${result.comments_appended === 1 ? "" : "s"} appended to the Agent draft.`,
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  };

  if (!workspaceId || !workspaceDir) {
    return (
      <DiffShell>
        <EmptyState title="Diff view is missing workspace metadata" />
      </DiffShell>
    );
  }

  return (
    <DiffShell>
      <div className="border-b border-neutral-800 bg-neutral-950/95 px-4 py-3">
        <div className="flex flex-wrap items-center gap-3">
          <div>
            <h1 className="text-sm font-semibold text-neutral-100">Diff</h1>
            <p className="text-xs text-neutral-500">{workspaceDir}</p>
          </div>
          <Button
            size="sm"
            variant="flat"
            onPress={refresh}
            isLoading={loading}
          >
            Refresh
          </Button>
          {sessions.length > 0 && (
            <Select
              aria-label="Agent session"
              size="sm"
              className="min-w-64 max-w-80"
              selectedKeys={selectedSessionId ? [selectedSessionId] : []}
              onSelectionChange={(keys) =>
                setSelectedSessionId((Array.from(keys)[0] as string) || "")
              }
            >
              {sessions.map((session) => (
                <SelectItem key={session.id}>
                  {session.name || session.executor || session.id.slice(0, 8)}
                </SelectItem>
              ))}
            </Select>
          )}
          {selectedRepo && selectedRepo.commits.length > 0 && (
            <Select
              aria-label="Compare at commit"
              size="sm"
              className="min-w-64 max-w-96"
              selectedKeys={[selectedHeadRef]}
              onSelectionChange={(keys) => {
                const next = (Array.from(keys)[0] as string) || "HEAD";
                setSelectedHeadRefs((current) => ({
                  ...current,
                  [selectedRepo.relativePath]: next,
                }));
              }}
            >
              {commitOptions.map((option) => (
                <SelectItem key={option.key}>{option.label}</SelectItem>
              ))}
            </Select>
          )}
        </div>
        {error && <p className="mt-2 text-xs text-red-400">{error}</p>}
        {success && <p className="mt-2 text-xs text-emerald-400">{success}</p>}
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-[280px_minmax(0,1fr)_320px]">
        <aside className="min-h-0 overflow-auto border-r border-neutral-800 bg-neutral-950 p-3">
          {data?.repos.map((repo) => (
            <button
              key={repo.path}
              className={`mb-2 block w-full rounded-lg border p-3 text-left text-xs transition ${
                selectedRepo?.path === repo.path
                  ? "border-primary-500 bg-primary-500/10 text-neutral-100"
                  : "border-neutral-800 bg-neutral-900 text-neutral-300 hover:border-neutral-700"
              }`}
              onClick={() => setSelectedRepoName(repo.name)}
            >
              <div className="font-medium">{repo.relativePath}</div>
              <div className="mt-1 text-neutral-500">
                {repo.branch || "unknown"} →{" "}
                {repo.targetBranch || repo.baseRef || "base"}
              </div>
              <div className="mt-1 truncate text-neutral-500">
                showing {repo.headRef === "HEAD"
                  ? "HEAD"
                  : repo.headRef.slice(0, 8)}
              </div>
              <div className="mt-1 text-neutral-500">
                {repo.files.length} file{repo.files.length === 1 ? "" : "s"},{" "}
                {repo.commits.length} commit
                {repo.commits.length === 1 ? "" : "s"}
              </div>
            </button>
          ))}
          {!loading && data?.repos.length === 0 && (
            <EmptyState title="No git repositories found" />
          )}
        </aside>

        <main className="min-h-0 overflow-auto bg-neutral-950 p-4">
          {loading ? (
            <EmptyState title="Loading diffs…" />
          ) : selectedRepo?.error ? (
            <EmptyState
              title="Could not load repo diff"
              detail={selectedRepo.error}
            />
          ) : selectedRepo?.patch ? (
            <RepoPatchDiff
              parsedPatch={parsedRepoPatch}
              queuedComments={queuedComments.filter(
                (comment) =>
                  selectedRepo &&
                  comment.repoName === selectedRepo.name,
              )}
              onLineNumberClick={stageLineComment}
            />
          ) : (
            <EmptyState title="No committed branch changes found" />
          )}
        </main>

        <aside className="min-h-0 overflow-auto border-l border-neutral-800 bg-neutral-950 p-3">
          <h2 className="text-sm font-semibold text-neutral-100">
            Queue comments
          </h2>
          <p className="mt-1 text-xs text-neutral-500">
            Comments append to the selected Agent session’s server-side draft.
          </p>
          <div className="mt-3 space-y-3">
            <Select
              aria-label="File"
              size="sm"
              selectedKeys={selectedFilePath ? [selectedFilePath] : []}
              onSelectionChange={(keys) =>
                setSelectedFilePath((Array.from(keys)[0] as string) || "")
              }
            >
              {selectedRepoFiles.map((file) => (
                <SelectItem key={file.path}>{file.path}</SelectItem>
              ))}
            </Select>
            <Input
              label="Line"
              size="sm"
              value={lineNumber}
              onChange={(event) => setLineNumber(event.target.value)}
            />
            <p className="text-xs text-neutral-500">
              Tip: click a diff line number to target that file and line.
            </p>
            {selectedCodeLine && (
              <p className="truncate font-mono text-xs text-neutral-500">
                {selectedCodeLine}
              </p>
            )}
            <Textarea
              label="Comment"
              minRows={4}
              value={commentBody}
              onChange={(event) => setCommentBody(event.target.value)}
            />
            <Button
              size="sm"
              color="primary"
              onPress={() => addQueuedComment()}
              isDisabled={!selectedFilePath || !commentBody.trim()}
            >
              Add comment
            </Button>
          </div>

          <div className="mt-5 space-y-2">
            {queuedComments.map((comment, index) => (
              <div
                key={`${comment.filePath}-${index}`}
                className="rounded-lg border border-neutral-800 bg-neutral-900 p-2 text-xs"
              >
                <div className="font-mono text-neutral-300">
                  {comment.repoName}/{comment.filePath}:{comment.lineNumber}
                </div>
                <div className="mt-1 text-neutral-400">{comment.body}</div>
                {comment.codeLine && (
                  <div className="mt-1 truncate font-mono text-neutral-500">
                    {comment.codeLine}
                  </div>
                )}
                <button
                  className="mt-2 text-red-300 hover:text-red-200"
                  onClick={() =>
                    setQueuedComments((current) =>
                      current.filter((_, i) => i !== index),
                    )
                  }
                >
                  Remove
                </button>
              </div>
            ))}
          </div>

          <Button
            className="mt-4 w-full"
            color="primary"
            onPress={submitComments}
            isLoading={submitting}
            isDisabled={!selectedSessionId || queuedComments.length === 0}
          >
            Append to Agent draft
          </Button>
          {!selectedSessionId && (
            <p className="mt-2 text-xs text-amber-300">
              No existing Agent session found for this workspace.
            </p>
          )}
        </aside>
      </div>
    </DiffShell>
  );
}

function DiffShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-full min-h-0 flex-col bg-neutral-950 text-neutral-100">
      {children}
    </div>
  );
}

function EmptyState({ title, detail }: { title: string; detail?: string }) {
  return (
    <div className="flex h-full min-h-40 items-center justify-center text-center">
      <div className="max-w-md px-6">
        <p className="text-sm font-medium text-neutral-300">{title}</p>
        {detail && <p className="mt-2 text-xs text-neutral-500">{detail}</p>}
      </div>
    </div>
  );
}

function RepoPatchDiff({
  parsedPatch,
  queuedComments,
  onLineNumberClick,
}: {
  parsedPatch: ReturnType<typeof parseRepoPatch>;
  queuedComments: DraftComment[];
  onLineNumberClick: (
    fileDiff: FileDiffMetadata,
    line: OnDiffLineClickProps,
  ) => void;
}) {
  if (parsedPatch.error) {
    return (
      <EmptyState title="Could not parse repo diff" detail={parsedPatch.error} />
    );
  }

  if (parsedPatch.files.length === 0) {
    return <EmptyState title="No file diffs found in patch" />;
  }

  return (
    <div className="space-y-4">
      {parsedPatch.files.map((fileDiff, index) =>
        hasRenderableDiff(fileDiff) ? (
          <FileDiff
            key={`${fileDiff.name}-${fileDiff.prevName || ''}-${index}`}
            fileDiff={fileDiff}
            lineAnnotations={lineAnnotationsForFile(fileDiff, queuedComments)}
            renderAnnotation={(annotation) => (
              <div className="rounded border border-primary-500/40 bg-primary-500/10 px-3 py-2 text-xs text-primary-100">
                {annotation.metadata?.body}
              </div>
            )}
            options={{
              diffStyle: 'unified',
              themeType: 'dark',
              theme: { dark: 'github-dark', light: 'github-light' },
              overflow: 'wrap',
              hunkSeparators: 'line-info',
              lineHoverHighlight: 'both',
              onLineNumberClick: (line) => {
                onLineNumberClick(fileDiff, line);
              },
            }}
          />
        ) : (
          <NonRenderableFileDiff
            key={`${fileDiff.name}-${fileDiff.prevName || ''}-${index}`}
            fileDiff={fileDiff}
          />
        ),
      )}
    </div>
  );
}

function lineAnnotationsForFile(
  fileDiff: FileDiffMetadata,
  queuedComments: DraftComment[],
): DiffLineAnnotation<{ body: string }>[] {
  return queuedComments
    .filter((comment) => comment.filePath === fileDiff.name)
    .map((comment) => ({
      side: comment.side ?? 'additions',
      lineNumber: Number.parseInt(comment.lineNumber, 10) || 1,
      metadata: { body: comment.body },
    }));
}

function NonRenderableFileDiff({
  fileDiff,
}: {
  fileDiff: { name: string; prevName?: string; type: string };
}) {
  return (
    <div className="rounded-lg border border-neutral-800 bg-neutral-900 p-3 text-xs text-neutral-300">
      <div className="font-mono text-neutral-100">
        {fileDiff.prevName && fileDiff.prevName !== fileDiff.name
          ? `${fileDiff.prevName} → ${fileDiff.name}`
          : fileDiff.name}
      </div>
      <div className="mt-1 text-neutral-500">
        {fileDiff.type === 'rename-pure'
          ? 'Renamed with no textual changes.'
          : 'No textual diff is available for this file.'}
      </div>
    </div>
  );
}
