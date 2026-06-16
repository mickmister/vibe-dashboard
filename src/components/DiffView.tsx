import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { FileDiff } from '@pierre/diffs/react';
import type {
  DiffLineAnnotation,
  FileDiffMetadata,
  OnDiffLineClickProps,
} from '@pierre/diffs';
import { Button, Select, SelectItem, Textarea } from '@heroui/react';
import { useModule } from '../hooks/useModule';
import { hasRenderableDiff, parseRepoPatch } from '../lib/diffPatch';
import {
  formatReviewCommentsMarkdown,
  workspaceCommentPath,
} from '../lib/diffComments';

type DiffRepo = {
  name: string;
  path: string;
  relativePath: string;
  branch: string | null;
  targetBranch: string | null;
  baseRef: string | null;
  headRef: string;
  commits: Array<{
    sha: string;
    subject: string;
    createdAt: string;
    linesAdded: number;
    linesRemoved: number;
  }>;
  files: Array<{ path: string; status: string }>;
  patch: string;
  error?: string;
};

type DiffResponse = {
  workspaceDir: string;
  repos: DiffRepo[];
};

type DraftComment = {
  repoRelativePath: string;
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
  const gitDiffModule = useModule('GitDiff');
  const [data, setData] = useState<DiffResponse | null>(null);
  const [selectedRepoRelativePath, setSelectedRepoRelativePath] = useState("");
  const [selectedFilePath, setSelectedFilePath] = useState("");
  const [draftComment, setDraftComment] = useState<DraftComment | null>(null);
  const [queuedComments, setQueuedComments] = useState<DraftComment[]>([]);
  const [selectedHeadRefs, setSelectedHeadRefs] = useState<
    Record<string, string>
  >({});
  const [loading, setLoading] = useState(true);
  const [copying, setCopying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [manualCopyMarkdown, setManualCopyMarkdown] = useState<string | null>(
    null,
  );

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const diffData = await gitDiffModule.actions.loadDiff({
        workspaceId,
        workspaceDir,
        headRefs: selectedHeadRefs,
      });
      setData(diffData);
      const firstRepoWithPatch = diffData.repos.find((repo) => repo.patch);
      setSelectedRepoRelativePath(
        (current) =>
          current ||
          firstRepoWithPatch?.relativePath ||
          diffData.repos[0]?.relativePath ||
          "",
      );
      setSelectedFilePath(
        (current) => current || firstRepoWithPatch?.files[0]?.path || "",
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [gitDiffModule.actions, selectedHeadRefs, workspaceDir, workspaceId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const selectedRepo = useMemo(
    () =>
      data?.repos.find(
        (repo) => repo.relativePath === selectedRepoRelativePath,
      ) ??
      data?.repos[0],
    [data?.repos, selectedRepoRelativePath],
  );

  const selectedRepoFiles = selectedRepo?.files ?? [];
  const repoCount = data?.repos.length ?? 0;
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

  const addQueuedComment = (comment: DraftComment) => {
    const body = comment.body.trim();
    if (!comment.repoRelativePath || !comment.filePath || !body) return;
    setQueuedComments((current) => [...current, { ...comment, body }]);
    setDraftComment(null);
    setSuccess(null);
    setManualCopyMarkdown(null);
  };

  const stageLineComment = useCallback(
    (fileDiff: FileDiffMetadata, line: OnDiffLineClickProps) => {
      const nextFilePath = fileDiff.name;
      setSelectedFilePath(nextFilePath);
      setDraftComment({
        repoRelativePath: selectedRepo?.relativePath || selectedRepoRelativePath,
        filePath: nextFilePath,
        lineNumber: String(line.lineNumber),
        body: '',
        codeLine: line.lineElement.textContent?.trim() || null,
        side: line.annotationSide,
      });
      setSuccess(null);
      setManualCopyMarkdown(null);
    },
    [selectedRepo?.relativePath, selectedRepoRelativePath],
  );

  const copyCommentsToClipboard = async () => {
    if (queuedComments.length === 0) return;
    setCopying(true);
    setError(null);
    setSuccess(null);
    setManualCopyMarkdown(null);
    const markdown = formatReviewCommentsMarkdown(
      queuedComments,
      repoCount || 1,
    );
    try {
      await navigator.clipboard.writeText(markdown);
      const copiedCount = queuedComments.length;
      setQueuedComments([]);
      setSuccess(
        `${copiedCount} review comment${copiedCount === 1 ? "" : "s"} copied to clipboard.`,
      );
    } catch (err) {
      setManualCopyMarkdown(markdown);
      setError(
        `Clipboard copy failed. Use the manual copy box below. ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    } finally {
      setCopying(false);
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
              onClick={() => setSelectedRepoRelativePath(repo.relativePath)}
            >
              <div className="font-medium">{repo.relativePath}</div>
              <div className="mt-1 text-neutral-500">
                {repo.branch || "unknown"} →{" "}
                {repo.targetBranch || repo.baseRef || "base"}
              </div>
              <div className="mt-1 truncate text-neutral-500">
                showing{' '}
                {repo.headRef === "HEAD" ? "HEAD" : repo.headRef.slice(0, 8)}
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
                  comment.repoRelativePath === selectedRepo.relativePath,
              )}
              draftComment={
                draftComment?.repoRelativePath === selectedRepo.relativePath
                  ? draftComment
                  : null
              }
              onDraftCommentChange={setDraftComment}
              onSubmitDraftComment={addQueuedComment}
              onCancelDraftComment={() => setDraftComment(null)}
              onRemoveQueuedComment={(comment) =>
                setQueuedComments((current) => current.filter((item) => item !== comment))
              }
              onLineNumberClick={stageLineComment}
            />
          ) : (
            <EmptyState title="No committed branch changes found" />
          )}
        </main>

        <aside className="min-h-0 overflow-auto border-l border-neutral-800 bg-neutral-950 p-3">
          <div className="flex items-center justify-between gap-2">
            <div>
              <h2 className="text-sm font-semibold text-neutral-100">
                Commit history
              </h2>
              <p className="text-xs text-neutral-500">
                {queuedComments.length} queued comment
                {queuedComments.length === 1 ? '' : 's'}
              </p>
            </div>
            <Button
              size="sm"
              color="primary"
              onPress={copyCommentsToClipboard}
              isLoading={copying}
              isDisabled={queuedComments.length === 0}
            >
              Copy
            </Button>
          </div>
          {manualCopyMarkdown && (
            <div className="mt-3 rounded-lg border border-amber-500/40 bg-amber-500/10 p-2">
              <p className="text-xs text-amber-100">
                Clipboard access failed. Select and copy this markdown manually.
              </p>
              <Textarea
                aria-label="Review comments markdown"
                className="mt-2"
                minRows={8}
                value={manualCopyMarkdown}
                readOnly
              />
            </div>
          )}
          <CommitTimeline commits={selectedRepo?.commits ?? []} />
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
  draftComment,
  onDraftCommentChange,
  onSubmitDraftComment,
  onCancelDraftComment,
  onRemoveQueuedComment,
  onLineNumberClick,
}: {
  parsedPatch: ReturnType<typeof parseRepoPatch>;
  queuedComments: DraftComment[];
  draftComment: DraftComment | null;
  onDraftCommentChange: (comment: DraftComment | null) => void;
  onSubmitDraftComment: (comment: DraftComment) => void;
  onCancelDraftComment: () => void;
  onRemoveQueuedComment: (comment: DraftComment) => void;
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
            lineAnnotations={lineAnnotationsForFile(
              fileDiff,
              queuedComments,
              draftComment,
            )}
            renderAnnotation={(annotation) => {
              const metadata = annotation.metadata;
              if (!metadata) return null;
              if (metadata.kind === 'draft') {
                return (
                  <InlineCommentEditor
                    comment={metadata.comment}
                    onChange={(body) =>
                      onDraftCommentChange({ ...metadata.comment, body })
                    }
                    onSubmit={() => onSubmitDraftComment(metadata.comment)}
                    onCancel={onCancelDraftComment}
                  />
                );
              }
              return (
                <InlineQueuedComment
                  comment={metadata.comment}
                  onRemove={() => onRemoveQueuedComment(metadata.comment)}
                />
              );
            }}
            options={{
              diffStyle: 'split',
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

type InlineAnnotationMetadata =
  | { kind: 'queued'; comment: DraftComment }
  | { kind: 'draft'; comment: DraftComment };

function lineAnnotationsForFile(
  fileDiff: FileDiffMetadata,
  queuedComments: DraftComment[],
  draftComment: DraftComment | null,
): DiffLineAnnotation<InlineAnnotationMetadata>[] {
  const annotations: DiffLineAnnotation<InlineAnnotationMetadata>[] = queuedComments
    .filter((comment) => comment.filePath === fileDiff.name)
    .map((comment) => ({
      side: comment.side ?? 'additions',
      lineNumber: Number.parseInt(comment.lineNumber, 10) || 1,
      metadata: { kind: 'queued' as const, comment },
    }));

  if (draftComment?.filePath === fileDiff.name) {
    annotations.push({
      side: draftComment.side ?? 'additions',
      lineNumber: Number.parseInt(draftComment.lineNumber, 10) || 1,
      metadata: { kind: 'draft', comment: draftComment },
    });
  }

  return annotations;
}

function InlineCommentEditor({
  comment,
  onChange,
  onSubmit,
  onCancel,
}: {
  comment: DraftComment;
  onChange: (body: string) => void;
  onSubmit: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="rounded border border-primary-500/40 bg-neutral-900 p-3 text-xs">
      <div className="mb-2 font-mono text-neutral-400">
        {comment.filePath}:{comment.lineNumber}
      </div>
      <Textarea
        aria-label="Inline review comment"
        minRows={3}
        value={comment.body}
        onChange={(event) => onChange(event.target.value)}
        autoFocus
      />
      <div className="mt-2 flex justify-end gap-2">
        <Button size="sm" variant="flat" onPress={onCancel}>
          Cancel
        </Button>
        <Button
          size="sm"
          color="primary"
          onPress={onSubmit}
          isDisabled={!comment.body.trim()}
        >
          Add comment
        </Button>
      </div>
    </div>
  );
}

function InlineQueuedComment({
  comment,
  onRemove,
}: {
  comment: DraftComment;
  onRemove: () => void;
}) {
  return (
    <div className="rounded border border-primary-500/40 bg-primary-500/10 px-3 py-2 text-xs text-primary-100">
      <div>{comment.body}</div>
      <button className="mt-2 text-red-200 hover:text-red-100" onClick={onRemove}>
        Remove
      </button>
    </div>
  );
}

function CommitTimeline({ commits }: { commits: DiffRepo['commits'] }) {
  if (commits.length === 0) {
    return (
      <div className="mt-4 rounded-lg border border-neutral-800 bg-neutral-900 p-3 text-xs text-neutral-500">
        No commits found for this comparison.
      </div>
    );
  }

  return (
    <ol className="mt-4 space-y-0">
      {commits.map((commit, index) => (
        <li key={commit.sha} className="relative grid grid-cols-[24px_minmax(0,1fr)] gap-3 pb-5 last:pb-0">
          <div className="relative flex justify-center">
            <span className="mt-1 h-3 w-3 rounded-full border border-primary-400 bg-primary-500" />
            {index < commits.length - 1 && (
              <span className="absolute top-5 bottom-0 w-px bg-neutral-800" />
            )}
          </div>
          <article className="min-w-0 rounded-lg border border-neutral-800 bg-neutral-900 p-3 text-xs">
            <div className="font-mono text-primary-300">
              {commit.sha.slice(0, 8)}
            </div>
            <h3 className="mt-1 truncate font-medium text-neutral-100">
              {commit.subject}
            </h3>
            <time className="mt-1 block text-neutral-500" dateTime={commit.createdAt}>
              {formatCommitTime(commit.createdAt)}
            </time>
            <div className="mt-2 flex gap-3 font-mono">
              <span className="text-emerald-300">+{commit.linesAdded}</span>
              <span className="text-red-300">-{commit.linesRemoved}</span>
            </div>
          </article>
        </li>
      ))}
    </ol>
  );
}

function formatCommitTime(value: string): string {
  if (!value) return 'Unknown time';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date);
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
