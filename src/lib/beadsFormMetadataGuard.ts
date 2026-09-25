export const BEAD_ISSUE_METADATA_JSON_MAX_BYTES = 16 * 1024 * 1024;

export function metadataJsonByteLength(metadata: unknown): number {
  return new TextEncoder().encode(JSON.stringify(metadata)).byteLength;
}

export function assertMetadataWithinIssueJsonGuard(
  metadata: unknown,
  maxBytes = BEAD_ISSUE_METADATA_JSON_MAX_BYTES,
): void {
  const bytes = metadataJsonByteLength(metadata);
  if (bytes > maxBytes) {
    throw new Error(
      `Bead JSON metadata is too large for the configured BeadsForm performance guard (${bytes} bytes > ${maxBytes} bytes). `
      + 'No bead metadata was changed. Bead issue metadata is stored in the Dolt issues.metadata JSON column, not the global metadata.value TEXT table; reduce form/response payload size or raise the app guard before retrying.',
    );
  }
}
