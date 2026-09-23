import { expect, test, type Locator, type Page } from 'playwright/test';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { VibeClient } from '../../../../scripts/vibe-agent/core/client.js';
import type { ExecutionProcess, SendMessageBody, Session } from '../../../../scripts/vibe-agent/types.js';

type SeedManifest = {
  voyageName: string;
  craftTitle: string;
  followUpPrompt: string;
  model: string;
};

const sandboxUrl = process.env.VK_MOCKED_SANDBOX_URL ?? 'http://localhost:50005';
const client = new VibeClient(sandboxUrl);
const manifestPath = path.join(
  process.cwd(),
  'tests/e2e/fixtures/vk-mocked-sandbox/basic-seeded/manifest.json',
);

test.describe('VK mocked-provider basic-seeded fixture', () => {
  test('opens the seeded VD craft and sends another qa-mode follow-up', async ({
    page,
  }) => {
    test.setTimeout(120_000);

    const manifest = JSON.parse(
      await readFile(manifestPath, 'utf8'),
    ) as SeedManifest;
    const proofFollowUp = `${manifest.followUpPrompt} Proof-of-concept reuse ${Date.now()}.`;

    await page.goto(sandboxUrl);
    await expect(page.getByText(manifest.voyageName).first()).toBeVisible();

    await openSidebarIfNeeded(page);
    await clickLocatorInViewport(
      page,
      page.getByRole('button', { name: 'Open Craft' }),
    );
    await expect(
      page.getByRole('heading', { name: 'Open VK Workspace' }),
    ).toBeVisible();
    await page
      .getByRole('textbox', { name: 'Search workspaces...' })
      .fill(manifest.craftTitle);
    await page
      .getByRole('button', { name: new RegExp(escapeRegex(manifest.craftTitle)) })
      .click();
    await clickLocatorInViewport(
      page,
      page.getByRole('button', {
        name: new RegExp(`Open ${escapeRegex(manifest.craftTitle)} in Home`),
      }),
    );

    await expect(
      page.getByRole('button', {
        name: new RegExp(`Open ${escapeRegex(manifest.craftTitle)} in Home`),
      }),
    ).toBeVisible();
    const workspace = (await client.getAllWorkspaces()).find(item => item.name === manifest.craftTitle);
    if (!workspace) throw new Error(`Could not find seeded VK workspace ${manifest.craftTitle}`);
    const session = (await client.getSessions(workspace.id))
      .sort((left, right) => String(left.created_at).localeCompare(String(right.created_at)))[0];
    if (!session) throw new Error(`Seeded VK workspace ${manifest.craftTitle} has no sessions`);

    const process = await client.sendMessage(session.id, followUpBody(proofFollowUp, session));
    const terminalProcess = await terminal(process.id);
    expect(terminalProcess.status).toBe('completed');
    await expect.poll(async () => (await client.getExecutionProcessFinalResponse(process.id)).final_response ?? '', {
      timeout: 20_000,
    }).toContain(proofFollowUp);
  });
});

async function openSidebarIfNeeded(page: Page) {
  const openCraftButton = page
    .getByRole('button', { name: 'Open Craft' })
    .first();
  if (await openCraftButton.isVisible()) {
    const box = await openCraftButton.boundingBox();
    if (box && box.x >= 0) return;
  }

  await page.getByRole('button', { name: 'Open sidebar' }).first().click();
  await expect(openCraftButton).toBeVisible();
}

async function clickLocatorInViewport(page: Page, locator: Locator) {
  const viewport = page.viewportSize();
  const count = await locator.count();
  for (let index = 0; index < count; index += 1) {
    const box = await locator.nth(index).boundingBox().catch(() => null);
    if (
      box &&
      box.x >= 0 &&
      box.y >= 0 &&
      (!viewport || box.x + box.width <= viewport.width) &&
      (!viewport || box.y + box.height <= viewport.height)
    ) {
      await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
      return;
    }
  }

  await locator
    .first()
    .evaluate((element) => (element as HTMLButtonElement).click());
}

function followUpBody(prompt: string, session: Session): SendMessageBody {
  return { prompt, executor_config: { executor: session.executor }, retry_process_id: null, force_when_dirty: null, perform_git_reset: null };
}

async function terminal(processId: string): Promise<ExecutionProcess> {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    const process = await client.getExecutionProcess(processId);
    if (process.status !== 'running') return process;
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  throw new Error(`QA process ${processId} did not become terminal`);
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
