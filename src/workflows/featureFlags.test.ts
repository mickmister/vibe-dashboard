import { describe, expect, it } from 'vitest';
import { areWorkflowE2eFixturesEnabled, areWorkflowFeaturesEnabled, isTruthy } from './featureFlags';

describe('workflow feature flags', () => {
  it('keeps workflow features off by default', () => {
    expect(areWorkflowFeaturesEnabled({})).toBe(false);
    expect(areWorkflowE2eFixturesEnabled({})).toBe(false);
  });

  it('enables workflows with server or browser env flags', () => {
    expect(areWorkflowFeaturesEnabled({ VD_WORKFLOWS_ENABLED: '1' })).toBe(true);
    expect(areWorkflowFeaturesEnabled({ VITE_VD_WORKFLOWS_ENABLED: 'true' })).toBe(true);
    expect(areWorkflowFeaturesEnabled({ VD_WORKFLOWS_ENABLED: '0' })).toBe(false);
  });

  it('requires the global workflow flag before e2e fixture routes can be enabled', () => {
    expect(areWorkflowE2eFixturesEnabled({ VD_WORKFLOW_E2E_FIXTURES_ENABLED: '1' })).toBe(false);
    expect(areWorkflowE2eFixturesEnabled({ VD_WORKFLOWS_ENABLED: '1', VD_WORKFLOW_E2E_FIXTURES_ENABLED: '1' })).toBe(true);
  });

  it('normalizes common truthy spellings', () => {
    for (const value of ['1', 'true', 'TRUE', 'yes', 'on']) expect(isTruthy(value)).toBe(true);
    for (const value of [undefined, null, '', '0', 'false', 'off']) expect(isTruthy(value)).toBe(false);
  });
});
