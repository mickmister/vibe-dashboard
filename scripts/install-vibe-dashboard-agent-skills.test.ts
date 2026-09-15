import { execFileSync } from 'node:child_process';
import { chmodSync, mkdtempSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const repoRoot = new URL('..', import.meta.url).pathname.replace(/\/scripts\/$/, '');
const installer = join(repoRoot, 'scripts/install-vibe-dashboard-agent-skills.sh');
const skillRoot = join(repoRoot, 'skills/vibe-dashboard-preview-urls');

describe('Preview URL agent skill', () => {
  it('has narrowly triggered metadata and verified workflow commands', () => {
    const skill = readFileSync(join(skillRoot, 'SKILL.md'), 'utf8');

    expect(skill).toContain('name: vibe-dashboard-preview-urls');
    expect(skill).toMatch(/Vite|Storybook/);
    expect(skill).toMatch(/static HTML/);
    expect(skill).toMatch(/show|open|review/);
    expect(skill).toMatch(/Do not use.*backend/i);
    expect(skill).toContain('vk workspace-repos <workspace-id> --json');
    expect(skill).toContain('vk preview-url list <workspace-id> --json');
    expect(skill).toContain('vk preview-url upsert-run-config');
    expect(skill).toContain('--description');
    expect(skill).toContain('vk preview-url upsert-slot');
    expect(skill).toContain('vk preview-url url');
    expect(skill).toContain('vk preview-url local-caddy start');
    expect(skill).toContain('vk preview-url logs <process-id>');
    expect(skill).toContain('vk preview-url stop <process-id>');
    expect(skill).toMatch(/slotSlug.*repoSlug.*workspaceToken.*customerSlug/);

    const entrypoint = readFileSync(join(repoRoot, 'docker-entrypoint.sh'), 'utf8');
    const dockerfile = readFileSync(join(repoRoot, 'Dockerfile.vkvd'), 'utf8');
    expect(entrypoint).toContain('/usr/local/bin/install-vibe-dashboard-agent-skills.sh');
    expect(dockerfile).toContain('COPY scripts/install-vibe-dashboard-agent-skills.sh /usr/local/bin/install-vibe-dashboard-agent-skills.sh');
  });

  it('installs, repeats, and upgrades owned skills in both homes without touching collisions', () => {
    const root = mkdtempSync(join(tmpdir(), 'vd-agent-skills-'));
    const source = join(root, 'source');
    const home = join(root, 'home');
    const owned = join(source, 'vibe-dashboard-preview-urls');
    mkdirSync(owned, { recursive: true });
    writeFileSync(join(owned, 'SKILL.md'), 'version one\n');
    writeFileSync(join(owned, 'helper.sh'), '#!/bin/sh\n');
    chmodSync(join(owned, 'helper.sh'), 0o755);
    for (const destination of ['.agents/skills', '.claude/skills']) {
      const thirdParty = join(home, destination, 'third-party-skill');
      const collision = join(home, destination, 'vibe-dashboard-user-owned');
      mkdirSync(thirdParty, { recursive: true });
      mkdirSync(collision, { recursive: true });
      writeFileSync(join(thirdParty, 'keep'), 'third party');
      writeFileSync(join(collision, 'keep'), 'user owned');
    }

    install(source, home);
    install(source, home);
    writeFileSync(join(owned, 'SKILL.md'), 'version two\n');
    install(source, home);

    for (const destination of ['.agents/skills', '.claude/skills']) {
      expect(readFileSync(join(home, destination, 'vibe-dashboard-preview-urls/SKILL.md'), 'utf8')).toBe('version two\n');
      expect(statSync(join(home, destination, 'vibe-dashboard-preview-urls/helper.sh')).mode & 0o111).not.toBe(0);
      expect(readFileSync(join(home, destination, 'third-party-skill/keep'), 'utf8')).toBe('third party');
      expect(readFileSync(join(home, destination, 'vibe-dashboard-user-owned/keep'), 'utf8')).toBe('user owned');
    }
  });
});

function install(source: string, home: string): void {
  execFileSync('bash', [installer, source, home], { stdio: 'pipe' });
}
