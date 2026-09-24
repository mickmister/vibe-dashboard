import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { EffectivePluginGrants, PluginManifest, SecretContribution } from './manifest';

const execFileAsync = promisify(execFile);

export interface SecretProviderAuditEvent {
  pluginId: string;
  pluginVersion: string;
  ref: string;
  action: 'read';
}

export interface SecretProvider {
  read(input: {
    pluginId: string;
    pluginVersion: string;
    ref: string;
  }): Promise<string | null>;
}

export interface ResolvedPluginSecret extends SecretContribution {
  value: string;
  redacted: string;
}

export interface VarlockSecretProviderExec {
  (command: string, args: string[]): Promise<{ stdout: string }>;
}

export class VarlockCommandSecretProvider implements SecretProvider {
  constructor(
    private readonly options: {
      varlockBinary?: string;
      exec?: VarlockSecretProviderExec;
    } = {},
  ) {}

  async read(input: {
    pluginId: string;
    pluginVersion: string;
    ref: string;
  }): Promise<string | null> {
    const command = this.options.varlockBinary ?? 'varlock';
    const run = this.options.exec ?? ((cmd, args) => execFileAsync(cmd, args));
    try {
      const { stdout } = await run(command, [
        'read',
        input.ref,
        '--caller',
        `${input.pluginId}@${input.pluginVersion}`,
      ]);
      const value = stdout.replace(/\r?\n$/, '');
      return value.length > 0 ? value : null;
    } catch {
      return null;
    }
  }
}

export class InMemorySecretProvider implements SecretProvider {
  readonly auditLog: SecretProviderAuditEvent[] = [];
  private readonly values = new Map<string, string>();
  private readonly revoked = new Set<string>();

  constructor(values: Record<string, string>) {
    for (const [ref, value] of Object.entries(values)) this.values.set(ref, value);
  }

  revoke(ref: string): void {
    this.revoked.add(ref);
  }

  async read(input: {
    pluginId: string;
    pluginVersion: string;
    ref: string;
  }): Promise<string | null> {
    this.auditLog.push({
      pluginId: input.pluginId,
      pluginVersion: input.pluginVersion,
      ref: input.ref,
      action: 'read',
    });
    if (this.revoked.has(input.ref)) return null;
    return this.values.get(input.ref) ?? null;
  }
}

export async function resolveApprovedPluginSecret(input: {
  manifest: PluginManifest;
  grants: EffectivePluginGrants;
  provider: SecretProvider;
  secretId: string;
}): Promise<ResolvedPluginSecret> {
  const secret = input.manifest.components.secrets?.find((candidate) => candidate.id === input.secretId);
  if (!secret) {
    throw new Error(`Plugin ${input.manifest.id} does not declare secret ${input.secretId}`);
  }
  if (input.grants.pluginId !== input.manifest.id || input.grants.pluginVersion !== input.manifest.version) {
    throw new Error('Effective grants plugin identity does not match manifest');
  }
  if (!input.grants.approved.secrets.includes(secret.id)) {
    throw new Error(`Secret ${secret.id} is not approved for plugin ${input.manifest.id}`);
  }

  const value = await input.provider.read({
    pluginId: input.manifest.id,
    pluginVersion: input.manifest.version,
    ref: secret.ref,
  });
  if (value == null) {
    throw new Error(`Secret ref ${secret.ref} is revoked or unavailable`);
  }

  return {
    ...secret,
    value,
    redacted: redactSecret(value),
  };
}

export function redactSecret(value: string): string {
  if (value.length <= 4) return '*'.repeat(value.length);
  return `${'*'.repeat(Math.max(value.length - 4, 8))}${value.slice(-4)}`;
}
