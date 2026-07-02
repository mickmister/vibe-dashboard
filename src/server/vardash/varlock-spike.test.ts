import { describe, expect, it } from 'vitest';

import { buildVarlockRunCommand, generateVardashVarlockSchema } from './varlock-spike';

describe('vardash Varlock spike helpers', () => {
  it('generates schema metadata without secret or plain values', () => {
    const schema = generateVardashVarlockSchema([
      {
        key: 'API_TOKEN',
        kind: 'secret',
        required: true,
        description: 'Token used by the local API client.',
      },
      {
        key: 'PORT',
        kind: 'plain',
        required: true,
      },
    ]);

    expect(schema).toContain('# @required @sensitive @type=string\nAPI_TOKEN=');
    expect(schema).toContain('# @required @type=string\nPORT=');
    expect(schema).not.toContain('secret-token');
    expect(schema).not.toContain('3000');
    expect(schema).not.toContain('Token used by the local API client.');
  });

  it('builds shell-safe argv using --inject vars and no serialized blob mode', () => {
    const command = buildVarlockRunCommand({
      schemaPath: '/private/vardash/ws/repo/.env.schema',
      command: ['npm', 'run', 'dev', '--', '--host=0.0.0.0; rm -rf /'],
    });

    expect(command).toEqual({
      command: 'varlock',
      args: [
        'run',
        '--path',
        '/private/vardash/ws/repo/.env.schema',
        '--inject',
        'vars',
        '--',
        'npm',
        'run',
        'dev',
        '--',
        '--host=0.0.0.0; rm -rf /',
      ],
    });
  });

  it('rejects invalid env keys before writing a schema', () => {
    expect(() => generateVardashVarlockSchema([
      { key: 'NOT-A-KEY', kind: 'secret', required: true },
    ])).toThrow('Invalid vardash env key');
  });
});
