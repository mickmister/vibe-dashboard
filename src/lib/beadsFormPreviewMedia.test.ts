// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import {
  buildPreviewMediaUrl,
  buildBeadAttachmentUrl,
  isFolderPreviewMediaRef,
  rewriteBeadBackedAttachmentRefs,
  rewriteFolderPreviewMediaRefs,
} from './beadsFormPreviewMedia';

describe('BeadsForm preview media refs', () => {
  it('identifies local and attachment-style refs only', () => {
    expect(isFolderPreviewMediaRef('screenshots/a.png')).toBe(true);
    expect(isFolderPreviewMediaRef('./screenshots/a.png')).toBe(true);
    expect(isFolderPreviewMediaRef('attachment://a.webm')).toBe(true);
    expect(isFolderPreviewMediaRef('/already/served.png')).toBe(false);
    expect(isFolderPreviewMediaRef('https://example.com/a.png')).toBe(false);
    expect(isFolderPreviewMediaRef('data:image/png;base64,bad')).toBe(false);
  });

  it('rewrites local image/video src and poster refs to the preview media route', () => {
    const html = rewriteFolderPreviewMediaRefs(
      '<section><a href="attachment://docs/decision.md">doc</a><img src="shots/a.png"><video src="attachment://b.webm" poster="shots/b.png"></video><img src="https://example.com/x.png"></section>',
      '/tmp/forms',
    );

    expect(html).toContain(buildPreviewMediaUrl('/tmp/forms', 'attachment://docs/decision.md').replace(/&/g, '&amp;'));
    expect(html).toContain(buildPreviewMediaUrl('/tmp/forms', 'shots/a.png').replace(/&/g, '&amp;'));
    expect(html).toContain(buildPreviewMediaUrl('/tmp/forms', 'attachment://b.webm').replace(/&/g, '&amp;'));
    expect(html).toContain(buildPreviewMediaUrl('/tmp/forms', 'shots/b.png').replace(/&/g, '&amp;'));
    expect(html).toContain('https://example.com/x.png');
  });

  it('rewrites bead-backed attachment refs through the controlled attachment route', () => {
    const html = rewriteBeadBackedAttachmentRefs(
      '<section><a href="attachment://docs/decision.md">doc</a><img src="attachment://shots/a.png"><video src="attachment://b.webm" poster="attachment://shots/b.png"></video><a href="https://example.com/x">external</a></section>',
      '/repo',
    );

    expect(html).toContain(buildBeadAttachmentUrl('/repo', 'attachment://docs/decision.md').replace(/&/g, '&amp;'));
    expect(html).toContain(buildBeadAttachmentUrl('/repo', 'attachment://shots/a.png').replace(/&/g, '&amp;'));
    expect(html).toContain(buildBeadAttachmentUrl('/repo', 'attachment://b.webm').replace(/&/g, '&amp;'));
    expect(html).toContain(buildBeadAttachmentUrl('/repo', 'attachment://shots/b.png').replace(/&/g, '&amp;'));
    expect(html).toContain('https://example.com/x');
  });
});
