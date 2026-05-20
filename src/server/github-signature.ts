import { createHmac, timingSafeEqual } from 'node:crypto';

export type GitHubWebhookSignatureResult =
  | { ok: true }
  | {
      ok: false;
      status: 401 | 500;
      error:
        | 'github_webhook_secret_not_configured'
        | 'github_signature_missing'
        | 'github_signature_malformed'
        | 'github_signature_invalid';
    };

export interface VerifyGitHubWebhookSignatureArgs {
  body: string;
  secret: string | undefined;
  signature: string | undefined;
}

export function verifyGitHubWebhookSignature(
  args: VerifyGitHubWebhookSignatureArgs,
): GitHubWebhookSignatureResult {
  if (!args.secret) {
    return {
      ok: false,
      status: 500,
      error: 'github_webhook_secret_not_configured',
    };
  }

  if (!args.signature) {
    return { ok: false, status: 401, error: 'github_signature_missing' };
  }

  const prefix = 'sha256=';
  if (!args.signature.startsWith(prefix)) {
    return { ok: false, status: 401, error: 'github_signature_malformed' };
  }

  const receivedHex = args.signature.slice(prefix.length);
  if (!/^[0-9a-fA-F]+$/.test(receivedHex)) {
    return { ok: false, status: 401, error: 'github_signature_malformed' };
  }

  const expectedHex = createHmac('sha256', args.secret)
    .update(args.body)
    .digest('hex');

  const received = Buffer.from(receivedHex, 'hex');
  const expected = Buffer.from(expectedHex, 'hex');
  if (received.length !== expected.length) {
    return { ok: false, status: 401, error: 'github_signature_invalid' };
  }

  if (!timingSafeEqual(received, expected)) {
    return { ok: false, status: 401, error: 'github_signature_invalid' };
  }

  return { ok: true };
}
