import { expect, test, type Locator, type Page } from 'playwright/test';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

type SeedManifest = {
  voyageName: string;
  craftTitle: string;
  followUpPrompt: string;
  model: string;
};

const sandboxUrl = process.env.VK_MOCKED_SANDBOX_URL ?? 'http://localhost:50005';
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

    const agentFrame = page.frameLocator('iframe[title="Agent"]').first();
    await expect(agentFrame.locator('body')).toContainText(manifest.craftTitle);
    await expect(agentFrame.locator('body')).toContainText(
      'QA mode execution completed successfully',
      { timeout: 60_000 },
    );

    await agentFrame
      .getByRole('textbox', { name: 'Markdown editor' })
      .last()
      .fill(proofFollowUp);
    await sendFollowUpThroughVkApi(page, proofFollowUp);

    await expect(agentFrame.locator('body')).toContainText(proofFollowUp);
    await expect(agentFrame.locator('body')).toContainText('Ran a test command', {
      timeout: 60_000,
    });
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

async function sendFollowUpThroughVkApi(page: Page, followUp: string) {
  const agentFrameSrc = await page
    .locator('iframe[title="Agent"]')
    .first()
    .evaluate((iframe) => (iframe as HTMLIFrameElement).src);
  const sessionId = agentFrameSrc.match(
    /\/sessions\/([0-9a-fA-F-]{36})(?:[/?#]|$)/,
  )?.[1];
  const workspaceId = agentFrameSrc.match(
    /\/workspaces\/([0-9a-fA-F-]{36})(?:[/?#]|$)/,
  )?.[1];
  const resolvedSessionId =
    sessionId ??
    (workspaceId ? await latestSessionIdForWorkspace(page, workspaceId) : null);
  if (!resolvedSessionId) {
    throw new Error(`Could not resolve VK session id from ${agentFrameSrc}`);
  }

  const response = await page.request.post(
    new URL(
      `/api/sessions/${resolvedSessionId}/follow-up`,
      sandboxUrl,
    ).toString(),
    {
      data: {
        prompt: followUp,
        executor_config: {
          executor: 'QA_MOCK',
          permission_policy: 'AUTO',
        },
        retry_process_id: null,
        force_when_dirty: null,
        perform_git_reset: null,
      },
    },
  );

  if (!response.ok()) {
    throw new Error(
      `VK follow-up API failed with ${response.status()}: ${await response.text()}`,
    );
  }
}

async function latestSessionIdForWorkspace(page: Page, workspaceId: string) {
  const response = await page.request.get(
    new URL(`/api/sessions?workspace_id=${workspaceId}`, sandboxUrl).toString(),
  );
  if (!response.ok()) {
    throw new Error(
      `VK sessions API failed with ${response.status()}: ${await response.text()}`,
    );
  }

  const body = (await response.json()) as {
    data?: Array<{ id?: string; created_at?: string }>;
  };
  return body.data
    ?.slice()
    .sort((left, right) =>
      String(right.created_at ?? '').localeCompare(String(left.created_at ?? '')),
    )[0]?.id;
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
