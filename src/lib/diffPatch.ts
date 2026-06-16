import { parsePatchFiles, type FileDiffMetadata } from '@pierre/diffs';

export type ParsedRepoPatch = {
  files: FileDiffMetadata[];
  error: string | null;
};

export function parseRepoPatch(
  patch: string,
  cacheKeyPrefix?: string,
): ParsedRepoPatch {
  if (!patch.trim()) {
    return { files: [], error: null };
  }

  try {
    const parsedPatches = parsePatchFiles(patch, cacheKeyPrefix, true);
    return {
      files: parsedPatches.flatMap((parsedPatch) => parsedPatch.files),
      error: null,
    };
  } catch (error) {
    return {
      files: [],
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export function hasRenderableDiff(file: FileDiffMetadata): boolean {
  return file.hunks.length > 0;
}
