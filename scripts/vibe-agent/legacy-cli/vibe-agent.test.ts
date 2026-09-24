import { Readable } from 'node:stream';
import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { parseSendArgs, readSendMessageContent } from './vibe-agent.js';

describe('vibe-agent send argument parsing', () => {
  it('preserves existing quoted message behavior', async () => {
    const parsed = parseSendArgs(['tester', 'quoted `markdown` | pipe']);

    expect(parsed).toMatchObject({
      targetRoleArg: 'tester',
      message: 'quoted `markdown` | pipe',
      stdin: false,
      respond: false,
    });
    await expect(readSendMessageContent({ ...parsed, stream: Readable.from(['ignored']) })).resolves.toBe('quoted `markdown` | pipe');
  });

  it('reads multiline stdin exactly for send messages with --respond compatibility', async () => {
    const message = [
      'Please test this.',
      '',
      '```sh',
      'echo "`quoted`" | tee output.txt',
      '```',
      '',
    ].join('\n');
    const parsed = parseSendArgs(['--respond', 'tester', '--stdin']);

    expect(parsed).toMatchObject({
      targetRoleArg: 'tester',
      message: '',
      stdin: true,
      respond: true,
    });
    await expect(readSendMessageContent({ ...parsed, stream: Readable.from([message]) })).resolves.toBe(message);
  });

  it('rejects empty stdin messages', async () => {
    const parsed = parseSendArgs(['tester', '--stdin']);

    await expect(readSendMessageContent({ ...parsed, stream: Readable.from(['']) })).rejects.toThrow('stdin message is empty');
  });

  it('rejects both argv message and --stdin', () => {
    expect(() => parseSendArgs(['--respond', 'tester', 'message arg', '--stdin'])).toThrow('cannot combine --stdin with a positional message');
  });

  it('rejects omitted message without --stdin', () => {
    const parsed = parseSendArgs(['--respond', 'tester']);
    expect(parsed.stdin).toBe(false);
    expect(parsed.message).toBe('');
  });

  it('documents the stdin send shape in CLI help', async () => {
    const source = await readFile(new URL('./vibe-agent.ts', import.meta.url), 'utf8');
    expect(source).toContain('send <role> --stdin');
    expect(source).toContain('cat .vk-mocked-sandbox/message.md | vibe-agent send --respond tester --stdin');
  });
});
