import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('./MainUIShellModule.tsx', import.meta.url), 'utf8');

describe('MainUIShellModule Vardash entry points', () => {
  it('does not register the old direct Vardash dashboard route', () => {
    expect(source).not.toContain('/dashboard/vardash');
    expect(source).not.toContain('const VardashRoute');
    expect(source).not.toContain('../components/vardash/VardashRepoEnvManager');
    expect(source).not.toContain('../components/vardash/VardashImportPanel');
    expect(source).not.toContain('../components/vardash/VardashProcessDefinitionsPanel');
    expect(source).not.toContain('../components/vardash/VardashLaunchPanel');
  });
});
