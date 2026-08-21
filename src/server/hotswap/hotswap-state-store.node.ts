import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { HotswapState, HotswapStateStore } from './vk-agent-hotswap';

export class FileHotswapStateStore implements HotswapStateStore {
  constructor(private readonly stateDir: string) {}

  async read(id: string): Promise<HotswapState | null> {
    try {
      return parseHotswapState(JSON.parse(await readFile(this.pathFor(id), 'utf8')));
    } catch (error) {
      if (isNodeErrorWithCode(error, 'ENOENT')) return null;
      throw error;
    }
  }

  async write(state: HotswapState): Promise<void> {
    const statePath = this.pathFor(state.id);
    await mkdir(dirname(statePath), { recursive: true });
    const tempPath = `${statePath}.tmp.${process.pid}.${Date.now()}`;
    await writeFile(tempPath, `${JSON.stringify(state, null, 2)}\n`);
    await rename(tempPath, statePath);
  }

  private pathFor(id: string): string {
    return join(this.stateDir, `${safeStateId(id)}.json`);
  }
}

export function parseHotswapState(value: unknown): HotswapState {
  if (!value || typeof value !== 'object') throw new Error('Invalid hotswap state: expected object');
  const state = value as Partial<HotswapState>;
  if (state.version !== 1) throw new Error('Invalid hotswap state: unsupported version');
  if (typeof state.id !== 'string' || !state.id) throw new Error('Invalid hotswap state: missing id');
  if (!Array.isArray(state.targetPrograms)) throw new Error('Invalid hotswap state: missing targetPrograms');
  if (!state.sessions || typeof state.sessions !== 'object') throw new Error('Invalid hotswap state: missing sessions');
  return state as HotswapState;
}

function safeStateId(id: string): string {
  return id.replace(/[^a-zA-Z0-9_.-]/g, '_');
}

function isNodeErrorWithCode(error: unknown, code: string): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error && error.code === code;
}
