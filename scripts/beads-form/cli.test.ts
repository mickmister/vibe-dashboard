import { execFile as execFileCallback } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { describe, expect, it, vi } from 'vitest';
import {
  appendQuestionsToBeadsForm,
  appendQuestionsToMetadata,
  attachBeadsForms,
  buildFormDefinitionHash,
  buildBeadsFormsSummary,
  attachFormsToMetadata,
  buildFillOutUrl,
  buildFillOutUrls,
  buildShowResult,
  parseBeadsFormCliArgs,
  parseFormsJsonForAttach,
  parseQuestionsJsonForAppend,
  resolveBeadsFormOrigin,
  scanPendingBeadsForms,
  selectFormForShow,
  showBeadsForm,
  type AttachOptions,
} from './cli';
import type { ExecFileLike } from '../../src/lib/beadsClient.node';

const execFileAsync = promisify(execFileCallback);

const standardForm = {
  format: 'standard',
  id: 'review',
  goal: 'Decide whether to approve the reviewed plan.',
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

const storedReviewForm = {
  ...standardForm,
};

describe('beads-form CLI helpers', () => {
  it('runs the CLI help entrypoint under Node strip-types', async () => {
    const { stdout } = await execFileAsync(process.execPath, [
      '--experimental-strip-types',
      'scripts/beads-form/cli.ts',
      '--help',
    ], {
      cwd: process.cwd(),
      timeout: 10_000,
    });
    expect(stdout).toContain('beads-form attach');
    expect(stdout).toContain('beads-form pending --parent-dir <all-repos-dir>');
  });

  it('parses attach and show subcommands', () => {
    expect(parseBeadsFormCliArgs(['attach', '--bead', 'bd-1', '--file', 'form.json', '--origin', 'https://example.test'])).toEqual({
      command: 'attach',
      options: expect.objectContaining({ beadId: 'bd-1', file: 'form.json', origin: 'https://example.test' }),
    });
    expect(parseBeadsFormCliArgs(['show', '--bead', 'bd-1', '--form', 'review'])).toEqual({
      command: 'show',
      options: expect.objectContaining({ beadId: 'bd-1', formId: 'review' }),
    });
    expect(() => parseBeadsFormCliArgs(['show', '--bead', 'bd-1', '--include-html'])).toThrow('no longer supports --include-html');
    expect(parseBeadsFormCliArgs(['pending', '--parent-dir', '/repos', '--limit', '12', '--origin', 'https://example.test/path'])).toEqual({
      command: 'pending',
      options: expect.objectContaining({
        parentDir: '/repos',
        limit: 12,
        origin: 'https://example.test',
      }),
    });
    expect(parseBeadsFormCliArgs([
      'append-questions',
      '--bead',
      'bd-1',
      '--form',
      'review',
      '--file',
      'questions.json',
      '--after-question',
      'decision',
      '--base-hash',
      'abc123',
    ])).toEqual({
      command: 'append-questions',
      options: expect.objectContaining({
        beadId: 'bd-1',
        formId: 'review',
        file: 'questions.json',
        afterQuestionId: 'decision',
        baseHash: 'abc123',
      }),
    });
  });

  it('parses workspace and session metadata from flags and environment', () => {
    expect(parseBeadsFormCliArgs([
      'attach',
      '--bead',
      'bd-1',
      '--file',
      'form.json',
      '--workspace',
      'workspace-flag',
      '--session',
      'session-flag',
    ])).toEqual({
      command: 'attach',
      options: expect.objectContaining({
        workspaceId: 'workspace-flag',
        sessionId: 'session-flag',
      }),
    });

    vi.stubEnv('VK_WORKSPACE_ID', 'workspace-env');
    vi.stubEnv('VK_SESSION_ID', 'session-env');
    try {
      expect(parseBeadsFormCliArgs(['attach', '--bead', 'bd-1', '--file', 'form.json'])).toEqual({
        command: 'attach',
        options: expect.objectContaining({
          workspaceId: 'workspace-env',
          sessionId: 'session-env',
        }),
      });
    } finally {
      vi.unstubAllEnvs();
    }
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

  it('preserves only standard semantic fields when normalizing attach input', () => {
    const [form] = parseFormsJsonForAttach(JSON.stringify(standardForm));
    expect(form).toMatchObject({
      format: 'standard',
      id: 'review',
      goal: standardForm.goal,
      questions: standardForm.questions,
      content: standardForm.content,
    });
    expect(form).not.toHaveProperty('html');
    expect(form).not.toHaveProperty('controls');

    const [stripped] = parseFormsJsonForAttach(JSON.stringify({
      ...standardForm,
      html: '<form>stale generated html</form>',
      controls: [{ id: 'stale', name: 'stale', type: 'textarea' }],
      sourceMessages: [{ text: 'do not persist' }],
    }));
    expect(stripped).not.toHaveProperty('html');
    expect(stripped).not.toHaveProperty('controls');
    expect(stripped).not.toHaveProperty('sourceMessages');
  });

  it('rejects duplicate input ids, duplicate bead ids, invalid JSON, and local bead-backed media refs without mutation', () => {
    expect(() => parseFormsJsonForAttach(JSON.stringify([standardForm, standardForm]))).toThrow('Duplicate form id');
    expect(() => parseFormsJsonForAttach('{bad')).toThrow('Invalid JSON');
    expect(() => parseFormsJsonForAttach(JSON.stringify({ ...standardForm, goal: '' }))).toThrow('No BeadsForm definitions found');
    expect(() => parseFormsJsonForAttach(JSON.stringify({
      ...standardForm,
      content: [{ ...standardForm.content[0], items: [{ id: 'local', type: 'image', src: 'attachments/local.png' }] }],
    }))).toThrow('uses local media');
    expect(() => parseFormsJsonForAttach(JSON.stringify({
      id: 'raw_img',
      title: 'Raw image',
      html: '<form><img src="attachments/x.png"></form>',
      controls: [],
    }))).toThrow('Raw HTML BeadsForms are no longer supported');
    expect(() => parseFormsJsonForAttach(JSON.stringify({
      id: 'raw_video',
      title: 'Raw video',
      html: '<form><video src="./x.webm"></video></form>',
      controls: [],
    }))).toThrow('Raw HTML BeadsForms are no longer supported');
    expect(() => parseFormsJsonForAttach(JSON.stringify({
      id: 'raw_poster',
      title: 'Raw poster',
      html: '<form><video poster="../x.png" src="https://example.test/x.webm"></video></form>',
      controls: [],
    }))).toThrow('Raw HTML BeadsForms are no longer supported');

    const metadata = { untouched: true, beadForms: { forms: [storedReviewForm] } };
    expect(() => attachFormsToMetadata(metadata, parseFormsJsonForAttach(JSON.stringify({ ...standardForm, id: 'other' })))).not.toThrow();
    expect(() => attachFormsToMetadata(metadata, parseFormsJsonForAttach(JSON.stringify(standardForm)))).toThrow('already exists');
    expect(metadata).toEqual({ untouched: true, beadForms: { forms: [storedReviewForm] } });
  });

  it('stamps workspace and session metadata while preserving unrelated metadata', () => {
    const form = parseFormsJsonForAttach(JSON.stringify(standardForm))[0]!;
    const metadata = attachFormsToMetadata({ untouched: true }, [form], {
      workspaceId: ' workspace-1 ',
      sessionId: ' session-1 ',
    });
    expect(metadata.untouched).toBe(true);
    expect(metadata.VK_WORKSPACE_ID).toBe('workspace-1');
    expect(metadata.VK_SESSION_ID).toBe('session-1');
    expect(metadata.beadFormsSummary).toEqual({
      hasForms: true,
      hasPendingAnswer: true,
      pendingResponseCount: 1,
      formIds: ['review'],
      pendingFormIds: ['review'],
    });
    expect((metadata.beadForms as { forms: Array<{ id: string }> }).forms.map((candidate) => candidate.id)).toEqual(['review']);
  });

  it('parses append-questions inputs and rejects full forms, empty arrays, and duplicate question ids', () => {
    const question = {
      type: 'textarea',
      id: 'review_risk',
      title: 'Review risk',
      description: 'Capture a focused reviewer concern.',
    };
    expect(parseQuestionsJsonForAppend(JSON.stringify([question]))).toEqual({
      operation: 'append_questions',
      questions: [question],
    });
    expect(parseQuestionsJsonForAppend(JSON.stringify({
      operation: 'append_questions',
      afterQuestionId: 'decision',
      questions: [question],
    }))).toEqual({
      operation: 'append_questions',
      afterQuestionId: 'decision',
      questions: [question],
    });
    expect(() => parseQuestionsJsonForAppend(JSON.stringify([]))).toThrow('at least one question');
    expect(() => parseQuestionsJsonForAppend(JSON.stringify([question, question]))).toThrow('Duplicate question id');
    expect(() => parseQuestionsJsonForAppend(JSON.stringify(standardForm))).toThrow('questions only');
    expect(() => parseQuestionsJsonForAppend(JSON.stringify({
      operation: 'replace_form',
      questions: [question],
    }))).toThrow('Unsupported append-questions operation');
    expect(() => parseQuestionsJsonForAppend(JSON.stringify({
      questions: [question],
      html: '<form></form>',
    }))).toThrow('generated html/controls');
    expect(() => parseQuestionsJsonForAppend(JSON.stringify([{
      ...question,
      html: '<form></form>',
      controls: [],
    }]))).toThrow('forbidden form/generated field "html"');
    expect(() => parseQuestionsJsonForAppend(JSON.stringify({
      questions: [{
        ...question,
        choices: [{
          id: 'nested',
          label: 'Nested',
          sourceMessages: [],
        }],
      }],
    }))).toThrow('forbidden form/generated field "sourceMessages"');
    expect(() => parseQuestionsJsonForAppend(JSON.stringify({
      questions: [{
        ...question,
        goal: 'Misplaced form goal',
      }],
    }))).toThrow('forbidden form/generated field "goal"');
  });

  it('appends questions to a canonical form while preserving responses and lean metadata', () => {
    const answered = {
      submittedBy: 'user',
      submittedAt: '2026-08-04T00:00:00Z',
      values: { decision: { approve: true } },
    };
    const metadata = {
      untouched: true,
      beadForms: {
        forms: [{
          ...storedReviewForm,
          responses: [answered],
          html: '<form>stale</form>',
          controls: [{ id: 'stale', name: 'stale', type: 'textarea' }],
        }],
      },
    };
    const appendedQuestion = {
      type: 'textarea',
      id: 'review_risk',
      title: 'Review risk',
      description: 'Capture a focused reviewer concern.',
    } as const;

    const result = appendQuestionsToMetadata(metadata, 'review', {
      operation: 'append_questions',
      questions: [appendedQuestion],
      afterQuestionId: 'decision',
    });
    const forms = (result.metadata.beadForms as { forms: Array<Record<string, unknown>> }).forms;

    expect(result.metadata.untouched).toBe(true);
    expect(forms[0]?.responses).toBeUndefined();
    expect((result.metadata.beadFormResponses as any).responsesByFormId.review).toEqual([answered]);
    expect(forms[0]).not.toHaveProperty('html');
    expect(forms[0]).not.toHaveProperty('controls');
    expect((forms[0]?.questions as Array<{ id: string }>).map((question) => question.id)).toEqual(['decision', 'review_risk']);
    expect(result.metadata.beadFormsSummary).toEqual({
      hasForms: true,
      hasPendingAnswer: false,
      pendingResponseCount: 0,
      formIds: ['review'],
      pendingFormIds: [],
    });
  });

  it('appends questions to legacy missing-goal standard forms while stripping stale generated fields', () => {
    const answered = {
      submittedBy: 'user',
      submittedAt: '2026-08-04T00:00:00Z',
      values: { decision: { approve: true } },
    };
    const legacyForm = {
      format: 'standard',
      id: 'review',
      title: 'Legacy review form',
      questions: storedReviewForm.questions,
      responses: [answered],
      html: '<form><input name="stale"></form>',
      controls: [{ id: 'stale', name: 'stale', type: 'textarea' }],
    };
    const metadata = {
      untouched: true,
      beadForms: { forms: [legacyForm] },
    };
    const appendedQuestion = {
      type: 'textarea',
      id: 'review_risk',
      title: 'Review risk',
      description: 'Capture a focused reviewer concern.',
    } as const;

    const result = appendQuestionsToMetadata(metadata, 'review', {
      operation: 'append_questions',
      questions: [appendedQuestion],
    });
    const forms = (result.metadata.beadForms as { forms: Array<Record<string, unknown>> }).forms;

    expect(forms[0]?.goal).toBe('Answer Legacy review form.');
    expect(forms[0]?.responses).toBeUndefined();
    expect((result.metadata.beadFormResponses as any).responsesByFormId.review).toEqual([answered]);
    expect(forms[0]).not.toHaveProperty('html');
    expect(forms[0]).not.toHaveProperty('controls');
    expect((forms[0]?.questions as Array<{ id: string }>).map((question) => question.id)).toEqual(['decision', 'review_risk']);
    expect(result.metadata.beadFormsSummary).toEqual({
      hasForms: true,
      hasPendingAnswer: false,
      pendingResponseCount: 0,
      formIds: ['review'],
      pendingFormIds: [],
    });
    expect(metadata).toEqual({
      untouched: true,
      beadForms: { forms: [legacyForm] },
    });
  });

  it('rejects append-questions duplicates and base hash mismatches without mutating metadata', () => {
    const metadata = { untouched: true, beadForms: { forms: [storedReviewForm] } };
    const existingQuestion = {
      type: 'textarea',
      id: 'decision',
      title: 'Duplicate',
      description: 'Duplicate id.',
    } as const;
    const newQuestion = {
      type: 'textarea',
      id: 'new_question',
      title: 'New question',
      description: 'New id.',
    } as const;

    expect(() => appendQuestionsToMetadata(metadata, 'review', {
      operation: 'append_questions',
      questions: [existingQuestion],
    })).toThrow('already exists');
    expect(() => appendQuestionsToMetadata(metadata, 'review', {
      operation: 'append_questions',
      questions: [newQuestion],
    }, {
      baseHash: 'not-the-current-hash',
    })).toThrow('changed since base hash');
    expect(metadata).toEqual({ untouched: true, beadForms: { forms: [storedReviewForm] } });
  });

  it('rejects nested generated append fields before metadata mutation', () => {
    const metadata = { untouched: true, beadForms: { forms: [storedReviewForm] } };
    expect(() => appendQuestionsToMetadata(metadata, 'review', {
      operation: 'append_questions',
      questions: [{
        type: 'textarea',
        id: 'new_question',
        title: 'New question',
        description: 'New id.',
        controls: [],
      } as never],
    })).toThrow('forbidden form/generated field "controls"');
    expect(() => appendQuestionsToMetadata(metadata, 'review', {
      operation: 'append_questions',
      questions: [{
        type: 'choices',
        id: 'choice_question',
        title: 'Choice question',
        description: 'Pick one.',
        choices: [{
          id: 'bad_choice',
          label: 'Bad choice',
          html: '<form></form>',
        }],
      } as never],
    })).toThrow('forbidden form/generated field "html"');
    expect(metadata).toEqual({ untouched: true, beadForms: { forms: [storedReviewForm] } });
  });

  it('updates bead metadata for append-questions and returns hashes plus fill-out URLs', async () => {
    const calls: string[][] = [];
    const exec = vi.fn<ExecFileLike>(async (_file, args) => {
      calls.push([...args]);
      if (args[0] === 'show') {
        return { stdout: JSON.stringify([{ id: 'bd-1', title: 'Bead', metadata: { beadForms: { forms: [storedReviewForm] } } }]), stderr: '' };
      }
      return { stdout: '', stderr: '' };
    });
    const patch = parseQuestionsJsonForAppend(JSON.stringify({
      questions: [{
        type: 'textarea',
        id: 'review_risk',
        title: 'Review risk',
        description: 'Capture a focused reviewer concern.',
      }],
    }));
    const result = await appendQuestionsToBeadsForm({
      execFile: exec,
      patch,
      options: {
        dir: '/repo',
        beadId: 'bd-1',
        formId: 'review',
        workspaceId: 'workspace-1',
      },
    });

    expect(result).toMatchObject({
      beadId: 'bd-1',
      formId: 'review',
      appendedQuestionIds: ['review_risk'],
      url: '/dashboard/forms?workspace=workspace-1&bead=bd-1&form=review',
      urls: {
        workspace: '/dashboard/forms?workspace=workspace-1&bead=bd-1&form=review',
        dir: '/dashboard/forms?dir=%2Frepo&bead=bd-1&form=review',
      },
    });
    expect(result.formHashBefore).toBe(buildFormDefinitionHash(parseFormsJsonForAttach(JSON.stringify(standardForm))[0]!));
    expect(result.formHashAfter).not.toBe(result.formHashBefore);
    expect(calls.map((args) => args[0])).toEqual(['show', 'update']);
  });

  it('builds pending-answer metadata summaries for attach indexing', () => {
    const form = parseFormsJsonForAttach(JSON.stringify(standardForm))[0]!;
    expect(buildBeadsFormsSummary([
      form,
      { ...form, id: 'answered', responses: [{ submittedBy: 'user', submittedAt: 'now', values: {} }] },
    ])).toEqual({
      hasForms: true,
      hasPendingAnswer: true,
      pendingResponseCount: 1,
      formIds: ['review', 'answered'],
      pendingFormIds: ['review'],
    });
  });

  it('does not overwrite existing workspace or session metadata with empty values', () => {
    const form = parseFormsJsonForAttach(JSON.stringify({ ...standardForm, id: 'followup' }))[0]!;
    const metadata = attachFormsToMetadata({
      VK_WORKSPACE_ID: 'existing-workspace',
      VK_SESSION_ID: 'existing-session',
      beadForms: { forms: [storedReviewForm] },
    }, [form], {
      workspaceId: '   ',
      sessionId: '',
    });
    expect(metadata.VK_WORKSPACE_ID).toBe('existing-workspace');
    expect(metadata.VK_SESSION_ID).toBe('existing-session');
    expect((metadata.beadForms as { forms: Array<{ id: string }> }).forms.map((candidate) => candidate.id)).toEqual(['review', 'followup']);
  });

  it('moves existing inline responses to split response storage when attaching another form', () => {
    const answered = {
      submittedBy: 'user',
      submittedAt: '2026-08-04T00:00:00Z',
      values: { decision: { approve: true } },
    };
    const form = parseFormsJsonForAttach(JSON.stringify({ ...standardForm, id: 'followup' }))[0]!;
    const metadata = attachFormsToMetadata({
      beadForms: { forms: [{ ...storedReviewForm, responses: [answered] }] },
    }, [form]);

    expect((metadata.beadForms as any).forms.map((candidate: any) => candidate.id)).toEqual(['review', 'followup']);
    expect((metadata.beadForms as any).forms[0].responses).toBeUndefined();
    expect((metadata.beadFormResponses as any).responsesByFormId.review).toEqual([answered]);
    expect(metadata.beadFormsSummary).toEqual({
      hasForms: true,
      hasPendingAnswer: true,
      pendingResponseCount: 1,
      formIds: ['review', 'followup'],
      pendingFormIds: ['followup'],
    });
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

  it('rejects raw html attach input instead of validating stored html media refs', () => {
    expect(() => parseFormsJsonForAttach(JSON.stringify({
      id: 'raw',
      title: 'Raw',
      html: '<form><textarea name="notes"></textarea></form>',
      controls: [{ id: 'notes', name: 'notes', type: 'textarea' }],
    }))).toThrow('Raw HTML BeadsForms are no longer supported');
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

  it('preflights metadata size before bd update without writing a recovery artifact', async () => {
    const calls: string[][] = [];
    const exec = vi.fn<ExecFileLike>(async (_file, args) => {
      calls.push([...args]);
      if (args[0] === 'show') {
        return {
          stdout: JSON.stringify([{ id: 'bd-1', title: 'Bead', metadata: { alreadyLarge: 'x'.repeat(66_000) } }]),
          stderr: '',
        };
      }
      return { stdout: '', stderr: '' };
    });
    const form = parseFormsJsonForAttach(JSON.stringify(standardForm))[0]!;

    await expect(attachBeadsForms({
      execFile: exec,
      forms: [form],
      options: { dir: '/repo', beadId: 'bd-1' } satisfies AttachOptions,
    })).rejects.toThrow('No bead metadata was changed');
    expect(calls.map((args) => args[0])).toEqual(['show']);
  });

  it('passes session metadata through attach updates', async () => {
    const exec = vi.fn<ExecFileLike>(async (_file, args) => {
      if (args[0] === 'show') {
        return { stdout: JSON.stringify([{ id: 'bd-1', title: 'Bead', metadata: {} }]), stderr: '' };
      }
      return { stdout: '', stderr: '' };
    });
    const form = parseFormsJsonForAttach(JSON.stringify(standardForm))[0]!;
    const result = await attachBeadsForms({
      execFile: exec,
      forms: [form],
      options: {
        dir: '/repo',
        beadId: 'bd-1',
        workspaceId: 'workspace-1',
        sessionId: 'session-1',
      } satisfies AttachOptions,
    });

    expect(result.metadata.VK_WORKSPACE_ID).toBe('workspace-1');
    expect(result.metadata.VK_SESSION_ID).toBe('session-1');
  });

  it('auto-selects exactly one form and lists forms when ambiguous', () => {
    const form = parseFormsJsonForAttach(JSON.stringify(standardForm))[0]!;
    expect(selectFormForShow([form]).id).toBe('review');
    expect(() => selectFormForShow([{ ...form, id: 'a' }, { ...form, id: 'b' }])).toThrow('Available forms: a, b');
  });

  it('builds JSON-first show output with all responses, semantic fields, and media refs', () => {
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
    expect(withoutHtml.form.goal).toBe(standardForm.goal);
    expect(withoutHtml.form.questions).toEqual(standardForm.questions);
    expect(withoutHtml.form).not.toHaveProperty('html');
    expect(withoutHtml.form).not.toHaveProperty('controls');
    expect(withoutHtml.mediaRefs).toEqual([{ galleryId: 'gallery', itemId: 'shot', type: 'image', src: 'https://example.test/shot.png', caption: 'Shot' }]);

    const second = buildShowResult({ bead: { id: 'bd-1' }, form });
    expect(second.form).not.toHaveProperty('html');
    expect(second.form).not.toHaveProperty('controls');
  });

  it('shows legacy missing-goal standard forms while stripping stale generated fields', async () => {
    const exec = vi.fn<ExecFileLike>(async () => ({
      stdout: JSON.stringify([{
        id: 'bd-1',
        title: 'Bead',
        metadata: {
          beadForms: {
            forms: [{
              format: 'standard',
              id: 'legacy_review',
              title: 'Legacy review form',
              questions: storedReviewForm.questions,
              responses: [{ submittedBy: 'user', submittedAt: '2026-08-10T00:00:00Z', values: { decision: { approve: true } } }],
              html: '<form><input name="stale"></form>',
              controls: [{ id: 'stale', name: 'stale', type: 'textarea' }],
            }],
          },
        },
      }]),
      stderr: '',
    }));

    const result = await showBeadsForm({
      execFile: exec,
      options: { dir: '/repo', beadId: 'bd-1', formId: 'legacy_review' },
    });

    expect(result.form).toMatchObject({
      id: 'legacy_review',
      goal: 'Answer Legacy review form.',
      title: 'Legacy review form',
      questions: storedReviewForm.questions,
    });
    expect(result.form).not.toHaveProperty('html');
    expect(result.form).not.toHaveProperty('controls');
    expect(result.responses).toHaveLength(1);
  });

  it('shows questions with no responses instead of erroring', () => {
    const form = parseFormsJsonForAttach(JSON.stringify(standardForm))[0]!;
    const result = buildShowResult({ bead: { id: 'bd-1' }, form });
    expect(result.responses).toEqual([]);
    expect(result.responseCount).toBe(0);
    expect(result.noResponses).toBe(true);
    expect(result.form.questions?.map((question) => question.id)).toEqual(['decision']);
  });

  it('scans pending forms from first-level repos with read-only list queries and fill-out URLs', async () => {
    const reposRoot = join(tmpdir(), `beads-form-pending-${process.pid}-${Date.now()}`);
    await mkdir(join(reposRoot, 'repo-a', '.beads'), { recursive: true });
    await mkdir(join(reposRoot, 'repo-b', '.beads'), { recursive: true });
    await mkdir(join(reposRoot, 'repo-c'), { recursive: true });

    const exec = vi.fn<ExecFileLike>(async (_file, args, options) => {
      expect(args[0]).toBe('--readonly');
      if (options.cwd.endsWith('repo-a') && args[1] === 'list') {
        expect(args).toEqual(['--readonly', 'list', '--json', '--all', '--limit', '0', '--has-metadata-key', 'beadFormsSummary']);
        return { stdout: JSON.stringify([
          {
            id: 'summary-pending',
            title: 'Summary pending',
            status: 'open',
            metadata: {
              beadFormsSummary: {
                hasForms: true,
                hasPendingAnswer: true,
                pendingResponseCount: 1,
                formIds: ['review'],
                pendingFormIds: ['review'],
              },
              beadForms: { forms: [{ ...standardForm, description: 'Needs human review.' }] },
            },
          },
        ]), stderr: '' };
      }
      if (options.cwd.endsWith('repo-b') && args[1] === 'list') {
        expect(args).toEqual(['--readonly', 'list', '--json', '--all', '--limit', '0', '--has-metadata-key', 'beadFormsSummary']);
        return { stdout: JSON.stringify([
          {
            id: 'summary-pending-b',
            title: 'Summary pending B',
            metadata: {
              beadFormsSummary: {
                hasForms: true,
                hasPendingAnswer: true,
                pendingResponseCount: 1,
                formIds: ['review_b'],
                pendingFormIds: ['review_b'],
              },
              beadForms: { forms: [{ ...standardForm, id: 'review_b', title: 'Review B' }] },
            },
          },
        ]), stderr: '' };
      }
      throw Object.assign(new Error('Command failed: bd list'), { stderr: 'Error: no beads database found' });
    });

    const result = await scanPendingBeadsForms({
      execFile: exec,
      options: {
        parentDir: reposRoot,
        limit: 3,
        origin: 'https://example.test',
      },
    });

    expect(result).toMatchObject({
      parentDir: reposRoot,
      repoLimit: 3,
      reposScanned: 2,
      pendingCount: 2,
      skipped: [],
      updateStrategy: { mode: 'explicit-refresh' },
    });
    expect(result.entries).toEqual([
      {
        repo: { name: 'repo-a', path: join(reposRoot, 'repo-a') },
        bead: { id: 'summary-pending', title: 'Summary pending' },
        form: { id: 'review', title: 'Review form', description: 'Needs human review.', responseCount: 0 },
        url: `https://example.test/dashboard/forms?dir=${encodeURIComponent(join(reposRoot, 'repo-a'))}&bead=summary-pending&form=review`,
      },
      {
        repo: { name: 'repo-b', path: join(reposRoot, 'repo-b') },
        bead: { id: 'summary-pending-b', title: 'Summary pending B' },
        form: { id: 'review_b', title: 'Review B', description: 'Review **decisions**.', responseCount: 0 },
        url: `https://example.test/dashboard/forms?dir=${encodeURIComponent(join(reposRoot, 'repo-b'))}&bead=summary-pending-b&form=review_b`,
      },
    ]);
    expect(exec.mock.calls.some(([, args]) => args.includes('show'))).toBe(false);
    expect(exec.mock.calls.some(([, args]) => args.includes('update'))).toBe(false);
    expect(exec.mock.calls.every(([, args]) => args.includes('--has-metadata-key'))).toBe(true);
  });
});
