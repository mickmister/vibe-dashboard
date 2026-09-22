import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export interface FindBranchesContainingCommitOptions {
  execFile?: ExecFileLike;
}

type ExecFileLike = (
  file: string,
  args: readonly string[],
) => Promise<{ stdout: string; stderr: string }>;

export class GitBranchLookupError extends Error {
  readonly status: number;

  constructor(message: string, status = 500) {
    super(message);
    this.name = 'GitBranchLookupError';
    this.status = status;
  }
}

export async function findBranchesContainingCommit(
  repoPath: string,
  commit: string,
  options: FindBranchesContainingCommitOptions = {},
): Promise<string[]> {
  if (!/^[0-9a-f]{7,40}$/i.test(commit)) {
    throw new GitBranchLookupError('A 7-40 character commit SHA is required.', 400);
  }

  const exec = options.execFile ?? defaultExecFile;
  try {
    const { stdout } = await exec('git', [
      '-C',
      repoPath,
      'for-each-ref',
      '--contains',
      commit,
      '--format=%(refname)',
      'refs/heads',
      'refs/remotes',
    ]);
    return Array.from(
      new Set(
        stdout
          .split(/\r?\n/)
          .map((line) => normalizeRefName(line.trim()))
          .filter((branch): branch is string => Boolean(branch)),
      ),
    );
  } catch (error) {
    throw new GitBranchLookupError(
      `Could not find branches containing commit ${commit}. Fetch the repository and verify the commit exists, then try again. ${formatExecError(error)}`,
    );
  }
}

function normalizeRefName(refName: string): string | null {
  if (refName.startsWith('refs/heads/')) {
    return refName.slice('refs/heads/'.length);
  }
  if (refName.startsWith('refs/remotes/')) {
    const branch = refName.slice('refs/remotes/'.length);
    return branch.endsWith('/HEAD') ? null : branch;
  }
  return null;
}

async function defaultExecFile(
  file: string,
  args: readonly string[],
): Promise<{ stdout: string; stderr: string }> {
  return execFileAsync(file, [...args]);
}

function formatExecError(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}
