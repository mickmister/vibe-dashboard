import { mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  attachBeadsForms,
  attachFormsToMetadata,
  buildFillOutUrl,
  buildFillOutUrls,
  buildShowResult,
  collectHtmlMediaRefs,
  parseBeadsFormCliArgs,
  parseFormsJsonForAttach,
  resolveBeadsFormOrigin,
  selectFormForShow,
  type AttachOptions,
} from './cli';
import type { ExecFileLike } from '../../src/lib/beadsClient.node';

const standardForm = {
  format: 'standard',
  id: 'review',
  title: 'Review form',
  description: 'Review **decisions**.',
  content: [{
    type: 'media-gallery',
    id: 'gallery',
    title: 'Gallery',
    description: 'Media refs only.',
    items: [{ id: 'shot', type: 'image', src: 'https://example.test/shot.png', caption: 'Shot' }],
  }],
  questions: [{
    type: 'choices',
    id: 'decision',
    title: 'Decision',
    description: 'Choose one.',
    choices: [{ id: 'approve', label: 'Approve', is_recommended_reason: 'Lowest-risk path.' }],
  }],
} as const;

describe('beads-form CLI helpers', () => {
  it('parses attach and show subcommands', () => {
    expect(parseBeadsFormCliArgs(['attach', '--bead', 'bd-1', '--file', 'form.json', '--origin', 'https://example.test'])).toEqual({
      command: 'attach',
      options: expect.objectContaining({ beadId: 'bd-1', file: 'form.json', origin: 'https://example.test' }),
    });
    expect(parseBeadsFormCliArgs(['show', '--bead', 'bd-1', '--form', 'review', '--include-html'])).toEqual({
      command: 'show',
      options: expect.objectContaining({ beadId: 'bd-1', formId: 'review', includeHtml: true }),
    });
  });

  it('resolves attach origin from explicit flag, env, then config without hardcoded defaults', async () => {
    const configDir = join(tmpdir(), `beads-form-config-${process.pid}-${Date.now()}`);
    const configPath = join(configDir, 'beads-form.json');
    await mkdir(configDir, { recursive: true });
    await writeFile(configPath, JSON.stringify({ origin: 'https://config.example.test/some/path' }), 'utf8');

    expect(resolveBeadsFormOrigin({
      explicitOrigin: 'https://flag.example.test/path',
      env: { BEADS_FORM_ORIGIN: 'https://env.example.test' },
      configPath,
    })).toBe('https://flag.example.test');
    expect(resolveBeadsFormOrigin({
      env: { BEADS_FORM_ORIGIN: 'https://env.example.test/path' },
      configPath,
    })).toBe('https://env.example.test');
    expect(resolveBeadsFormOrigin({ env: {}, configPath })).toBe('https://config.example.test');
    expect(resolveBeadsFormOrigin({ env: {}, configPath: join(configDir, 'missing.json') })).toBeUndefined();
    expect(() => resolveBeadsFormOrigin({ explicitOrigin: 'file:///tmp/forms' })).toThrow('Invalid BeadsForm origin protocol');
  });

  it('accepts direct, array, forms wrapper, and metadata wrapper JSON input shapes', () => {
    expect(parseFormsJsonForAttach(JSON.stringify(standardForm)).map((form) => form.id)).toEqual(['review']);
    expect(parseFormsJsonForAttach(JSON.stringify([standardForm])).map((form) => form.id)).toEqual(['review']);
    expect(parseFormsJsonForAttach(JSON.stringify({ forms: [standardForm] })).map((form) => form.id)).toEqual(['review']);
    expect(parseFormsJsonForAttach(JSON.stringify({ beadForms: { forms: [standardForm] } })).map((form) => form.id)).toEqual(['review']);
  });

  it('preserves standard semantic fields when compiling attach input', () => {
    const [form] = parseFormsJsonForAttach(JSON.stringify(standardForm));
    expect(form).toMatchObject({
      format: 'standard',
      id: 'review',
      questions: standardForm.questions,
      content: standardForm.content,
    });
    expect(form?.html).toContain('<form>');
    expect(form?.controls?.map((control) => control.name)).toContain('decision');
  });

  it('rejects duplicate input ids, duplicate bead ids, invalid JSON, and local bead-backed media refs without mutation', () => {
    expect(() => parseFormsJsonForAttach(JSON.stringify([standardForm, standardForm]))).toThrow('Duplicate form id');
    expect(() => parseFormsJsonForAttach('{bad')).toThrow('Invalid JSON');
    expect(() => parseFormsJsonForAttach(JSON.stringify({
      ...standardForm,
      content: [{ ...standardForm.content[0], items: [{ id: 'local', type: 'image', src: 'attachments/local.png' }] }],
    }))).toThrow('uses local media');
    expect(() => parseFormsJsonForAttach(JSON.stringify({
      id: 'raw_img',
      title: 'Raw image',
      html: '<form><img src="attachments/x.png"></form>',
      controls: [],
    }))).toThrow('uses local media src "attachments/x.png" in stored HTML');
    expect(() => parseFormsJsonForAttach(JSON.stringify({
      id: 'raw_video',
      title: 'Raw video',
      html: '<form><video src="./x.webm"></video></form>',
      controls: [],
    }))).toThrow('uses local media src "./x.webm" in stored HTML');
    expect(() => parseFormsJsonForAttach(JSON.stringify({
      id: 'raw_poster',
      title: 'Raw poster',
      html: '<form><video poster="../x.png" src="https://example.test/x.webm"></video></form>',
      controls: [],
    }))).toThrow('uses local media poster "../x.png" in stored HTML');

    const metadata = { untouched: true, beadForms: { forms: [{ id: 'review', title: 'Existing', html: '<form></form>' }] } };
    expect(() => attachFormsToMetadata(metadata, parseFormsJsonForAttach(JSON.stringify({ ...standardForm, id: 'other' })))).not.toThrow();
    expect(() => attachFormsToMetadata(metadata, parseFormsJsonForAttach(JSON.stringify(standardForm)))).toThrow('already exists');
    expect(metadata).toEqual({ untouched: true, beadForms: { forms: [{ id: 'review', title: 'Existing', html: '<form></form>' }] } });
  });

  it('builds workspace URLs when known and dir URLs otherwise', () => {
    expect(buildFillOutUrl({
      dir: '/repo',
      beadId: 'bd-1',
      formId: 'review',
      workspaceId: 'workspace-1',
      origin: 'https://example.test/',
    })).toBe('https://example.test/dashboard/forms?workspace=workspace-1&bead=bd-1&form=review');
    expect(buildFillOutUrl({ dir: '/repo', beadId: 'bd-1', formId: 'review' })).toBe('/dashboard/forms?dir=%2Frepo&bead=bd-1&form=review');
    expect(buildFillOutUrls({
      dir: '/repo',
      beadId: 'bd-1',
      formId: 'review',
      workspaceId: 'workspace-1',
    })).toEqual({
      workspace: '/dashboard/forms?workspace=workspace-1&bead=bd-1&form=review',
      dir: '/dashboard/forms?dir=%2Frepo&bead=bd-1&form=review',
    });
    expect(buildFillOutUrls({ dir: '/repo', beadId: 'bd-1', formId: 'review' })).toEqual({
      dir: '/dashboard/forms?dir=%2Frepo&bead=bd-1&form=review',
    });
  });

  it('collects raw html media src and poster refs for bead-backed attach validation', () => {
    expect(collectHtmlMediaRefs(`
      <form>
        <img src=attachments/x.png>
        <video src="./x.webm" poster='../x.png'></video>
        <input src="not-media.png">
      </form>
    `)).toEqual([
      { tag: 'img', attr: 'src', value: 'attachments/x.png' },
      { tag: 'video', attr: 'src', value: './x.webm' },
      { tag: 'video', attr: 'poster', value: '../x.png' },
    ]);
  });

  it('updates bead metadata only after duplicate-safe attach validation and prints URLs', async () => {
    const calls: string[][] = [];
    const exec = vi.fn<ExecFileLike>(async (_file, args) => {
      calls.push([...args]);
      if (args[0] === 'show') {
        return { stdout: JSON.stringify([{ id: 'bd-1', title: 'Bead', metadata: { untouched: true } }]), stderr: '' };
      }
      return { stdout: '', stderr: '' };
    });
    const [form] = parseFormsJsonForAttach(JSON.stringify(standardForm));
    const result = await attachBeadsForms({
      execFile: exec,
      forms: [form!],
      options: { dir: '/repo', beadId: 'bd-1', workspaceId: 'workspace-1' } satisfies AttachOptions,
    });

    expect(result.forms[0]).toMatchObject({
      id: 'review',
      url: '/dashboard/forms?workspace=workspace-1&bead=bd-1&form=review',
      urls: {
        workspace: '/dashboard/forms?workspace=workspace-1&bead=bd-1&form=review',
        dir: '/dashboard/forms?dir=%2Frepo&bead=bd-1&form=review',
      },
    });
    expect(result.metadata.untouched).toBe(true);
    expect(result.metadata.VK_WORKSPACE_ID).toBe('workspace-1');
    expect(calls.map((args) => args[0])).toEqual(['show', 'update']);
  });

  it('auto-selects exactly one form and lists forms when ambiguous', () => {
    const form = parseFormsJsonForAttach(JSON.stringify(standardForm))[0]!;
    expect(selectFormForShow([form]).id).toBe('review');
    expect(() => selectFormForShow([{ ...form, id: 'a' }, { ...form, id: 'b' }])).toThrow('Available forms: a, b');
  });

  it('builds JSON-first show output with all responses, semantic fields, media refs, and optional html controls', () => {
    const form = {
      ...parseFormsJsonForAttach(JSON.stringify(standardForm))[0]!,
      responses: [
        { submittedBy: 'user', submittedAt: '2026-07-14T00:00:00Z', values: { decision: { approve: true } } },
        { submittedBy: 'user', submittedAt: '2026-07-14T00:01:00Z', values: { decision: { approve: false } } },
      ],
    };

    const withoutHtml = buildShowResult({ bead: { id: 'bd-1', title: 'Bead' }, form });
    expect(withoutHtml.responseCount).toBe(2);
    expect(withoutHtml.noResponses).toBe(false);
    expect(withoutHtml.form.questions).toEqual(standardForm.questions);
    expect(withoutHtml.form.html).toBeUndefined();
    expect(withoutHtml.form.controls).toBeUndefined();
    expect(withoutHtml.mediaRefs).toEqual([{ galleryId: 'gallery', itemId: 'shot', type: 'image', src: 'https://example.test/shot.png', caption: 'Shot' }]);

    const withHtml = buildShowResult({ bead: { id: 'bd-1' }, form, includeHtml: true });
    expect(withHtml.form.html).toContain('<form>');
    expect(withHtml.form.controls?.map((control) => control.name)).toContain('decision');
  });

  it('shows questions with no responses instead of erroring', () => {
    const form = parseFormsJsonForAttach(JSON.stringify(standardForm))[0]!;
    const result = buildShowResult({ bead: { id: 'bd-1' }, form });
    expect(result.responses).toEqual([]);
    expect(result.responseCount).toBe(0);
    expect(result.noResponses).toBe(true);
    expect(result.form.questions?.map((question) => question.id)).toEqual(['decision']);
  });
});
