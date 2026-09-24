import type { Hono } from 'hono';
import {
  dockviewM32HarnessPanelRoutePrefix,
  isDockviewM32HarnessStartupEnabled,
} from '../dockview/DockviewM32HarnessStartup';
import {
  dockviewM32HarnessCraftId,
} from '../dockview/DockviewM32HarnessWorkspace';
import {
  dockviewM32HarnessWorkspaceId,
} from '../dockview/DockviewM32HarnessFixture';

const surfaceLabels: Record<string, string> = {
  'craft-overview': 'Agent',
  code: 'Code',
  changes: 'Changes',
  beads: 'Beads',
  forms: 'Forms',
};

export function registerDockviewHarnessPanelRoutes(hono: Hono): void {
  if (!isDockviewM32HarnessStartupEnabled()) return;

  hono.get(`${dockviewM32HarnessPanelRoutePrefix}/:workspaceId/:surface`, (c) => {
    const workspaceId = c.req.param('workspaceId');
    const surface = c.req.param('surface');
    const label = surfaceLabels[surface];
    if (workspaceId !== dockviewM32HarnessWorkspaceId || !label) return c.notFound();

    return c.html(`<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>DockView QA Craft ${label}</title>
    <style>
      :root { color-scheme: dark; font-family: Inter, ui-sans-serif, system-ui, sans-serif; }
      body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: #020617; color: #e5e7eb; }
      main { width: min(32rem, calc(100vw - 2rem)); border: 1px solid #334155; border-radius: 1rem; padding: 1.25rem; background: linear-gradient(135deg, #0f172a, #111827); box-shadow: 0 1.5rem 4rem rgb(0 0 0 / 0.35); }
      p { color: #94a3b8; line-height: 1.5; }
      .eyebrow { color: #38bdf8; font-size: 0.75rem; font-weight: 700; letter-spacing: 0.16em; text-transform: uppercase; }
    </style>
  </head>
  <body>
    <main data-testid="dockview-qa-panel-surface" data-craft="${dockviewM32HarnessCraftId}" data-workspace="${dockviewM32HarnessWorkspaceId}" data-surface="${surface}">
      <div class="eyebrow">DockView QA live surface</div>
      <h1>DockView QA Craft ${label}</h1>
      <p>This isolated dev surface proves the mobile single-Panel screenshot path without requiring an external VK backend.</p>
    </main>
  </body>
</html>`);
  });
}
