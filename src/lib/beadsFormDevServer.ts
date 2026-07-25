export const BEADS_FORM_DISABLE_HMR_ENV = 'BEADS_FORM_DISABLE_HMR';

export type DevServerEnv = Record<string, string | undefined>;

export function isTruthyEnvValue(value: string | undefined): boolean {
  return /^(1|true|yes|on)$/i.test(value ?? '');
}

export function shouldDisableBeadsFormHmr(env: DevServerEnv = process.env): boolean {
  return isTruthyEnvValue(env[BEADS_FORM_DISABLE_HMR_ENV]);
}

export function resolveDevPort(env: DevServerEnv = process.env): number {
  const rawPort = env.PORT ?? '';
  const parsed = Number.parseInt(rawPort, 10);
  return Number.isNaN(parsed) ? 3000 : parsed;
}

export function buildViteDevServerOptions(env: DevServerEnv = process.env): {
  port: number;
  host: true;
  hmr?: false;
} {
  return {
    port: resolveDevPort(env),
    host: true,
    ...(shouldDisableBeadsFormHmr(env) ? { hmr: false as const } : {}),
  };
}

export function buildBeadsFormPreviewDevEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return {
    ...env,
    [BEADS_FORM_DISABLE_HMR_ENV]: env[BEADS_FORM_DISABLE_HMR_ENV] ?? '1',
  };
}
