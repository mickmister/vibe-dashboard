import type { BeadsFormDraft, BeadsFormWizardPosition, JsonObject } from './beadsFormCore';

export type BeadsFormDraftSavePayload = {
  values: JsonObject;
  position?: BeadsFormWizardPosition;
};

export type BeadsFormDraftSaveQueueOptions = {
  debounceMs?: number;
  initialBaseUpdatedAt?: string;
  save: (
    payload: BeadsFormDraftSavePayload,
    baseUpdatedAt: string | undefined,
  ) => Promise<{ draft: Pick<BeadsFormDraft, 'updatedAt'> }>;
  onError?: (error: unknown) => void;
  onSaved?: (draft: Pick<BeadsFormDraft, 'updatedAt'>) => void;
};

export class BeadsFormDraftSaveQueue {
  private readonly debounceMs: number;
  private readonly save: BeadsFormDraftSaveQueueOptions['save'];
  private readonly onError?: (error: unknown) => void;
  private readonly onSaved?: (draft: Pick<BeadsFormDraft, 'updatedAt'>) => void;
  private timeout: ReturnType<typeof setTimeout> | undefined;
  private pending: BeadsFormDraftSavePayload | undefined;
  private inFlight = false;
  private generation = 0;
  private baseUpdatedAt: string | undefined;

  constructor(options: BeadsFormDraftSaveQueueOptions) {
    this.debounceMs = options.debounceMs ?? 300;
    this.save = options.save;
    this.onError = options.onError;
    this.onSaved = options.onSaved;
    this.baseUpdatedAt = options.initialBaseUpdatedAt;
  }

  setBaseUpdatedAt(value: string | undefined): void {
    this.baseUpdatedAt = value;
  }

  schedule(payload: BeadsFormDraftSavePayload): void {
    this.pending = payload;
    if (this.timeout) clearTimeout(this.timeout);
    const generation = this.generation;
    this.timeout = setTimeout(() => {
      this.timeout = undefined;
      if (generation !== this.generation) return;
      this.flush(generation);
    }, this.debounceMs);
  }

  cancel(): void {
    this.generation += 1;
    this.pending = undefined;
    if (this.timeout) clearTimeout(this.timeout);
    this.timeout = undefined;
  }

  dispose(): void {
    this.cancel();
  }

  private flush(generation: number): void {
    if (this.inFlight || generation !== this.generation) return;
    const payload = this.pending;
    if (!payload) return;
    this.pending = undefined;
    this.inFlight = true;
    void this.save(payload, this.baseUpdatedAt)
      .then((result) => {
        if (generation !== this.generation) return;
        this.baseUpdatedAt = result.draft.updatedAt;
        this.onSaved?.(result.draft);
      })
      .catch((error) => {
        if (generation === this.generation) this.onError?.(error);
      })
      .finally(() => {
        this.inFlight = false;
        if (generation !== this.generation) {
          if (this.pending) this.flush(this.generation);
          return;
        }
        if (this.pending) this.flush(generation);
      });
  }
}
