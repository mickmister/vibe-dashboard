import { describe, expect, it } from 'vitest';
import {
  BEADS_FORM_DISABLE_HMR_ENV,
  buildBeadsFormPreviewDevEnv,
  buildViteDevServerOptions,
  shouldDisableBeadsFormHmr,
} from './beadsFormDevServer';

describe('BeadsForm dev server config helpers', () => {
  it('disables Vite browser HMR/full-reload pushes when BEADS_FORM_DISABLE_HMR is truthy', () => {
    expect(shouldDisableBeadsFormHmr({ [BEADS_FORM_DISABLE_HMR_ENV]: '1' })).toBe(true);
    expect(buildViteDevServerOptions({ PORT: '55123', [BEADS_FORM_DISABLE_HMR_ENV]: 'true' })).toEqual({
      port: 55123,
      host: true,
      hmr: false,
    });
  });

  it('leaves HMR enabled by default for normal development', () => {
    expect(buildViteDevServerOptions({ PORT: '55123' })).toEqual({
      port: 55123,
      host: true,
    });
  });

  it('makes the folder preview command opt out of browser auto-reload by default', () => {
    expect(buildBeadsFormPreviewDevEnv({ PORT: '1234' })[BEADS_FORM_DISABLE_HMR_ENV]).toBe('1');
    expect(buildBeadsFormPreviewDevEnv({ [BEADS_FORM_DISABLE_HMR_ENV]: '0' })[BEADS_FORM_DISABLE_HMR_ENV]).toBe('0');
  });
});
