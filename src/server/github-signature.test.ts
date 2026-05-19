import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { verifyGitHubWebhookSignature } from './github-signature';

describe('verifyGitHubWebhookSignature', () => {
  it('accepts a valid sha256 signature', () => {
    const body = JSON.stringify({ ok: true });
    const secret = 'super-secret';
    const signature = `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`;

    expect(verifyGitHubWebhookSignature({ body, secret, signature })).toEqual({ ok: true });
  });

  it('requires a configured secret', () => {
    expect(verifyGitHubWebhookSignature({ body: '{}', secret: '', signature: 'sha256=abc' })).toEqual({
      ok: false,
      status: 500,
      error: 'github_webhook_secret_not_configured',
    });
  });

  it('rejects missing, malformed, and invalid signatures', () => {
    expect(verifyGitHubWebhookSignature({ body: '{}', secret: 'secret', signature: '' })).toMatchObject({
      ok: false,
      status: 401,
      error: 'github_signature_missing',
    });
    expect(verifyGitHubWebhookSignature({ body: '{}', secret: 'secret', signature: 'sha1=abc' })).toMatchObject({
      ok: false,
      status: 401,
      error: 'github_signature_malformed',
    });
    expect(verifyGitHubWebhookSignature({ body: '{}', secret: 'secret', signature: 'sha256=deadbeef' })).toMatchObject({
      ok: false,
      status: 401,
      error: 'github_signature_invalid',
    });
  });
});
