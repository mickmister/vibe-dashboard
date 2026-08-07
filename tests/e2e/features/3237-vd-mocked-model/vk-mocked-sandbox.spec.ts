import {
  expect,
  test,
  type FrameLocator,
  type Locator,
  type Page,
} from 'playwright/test';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';

/**
 * Covers:
 * - test-plans/branches/3237-vd-mocked-model/test-plan-1.md
 * - TEST_CASE_1B
 * - TEST_CASE_2A
 * - TEST_CASE_3A
 * - TEST_CASE_4A
 * - TEST_CASE_5A
 * - TEST_CASE_6A
 * - TEST_CASE_6B
 * - TEST_CASE_7A
 * - TEST_CASE_8A
 *
 * This feature spec targets an already-running mocked VK sandbox. It should fail
 * if the sandbox is not reachable. Start it with `npm run dev:vk-mocked-sandbox`,
 * then run:
 *
 * pnpm exec playwright test tests/e2e/features/3237-vd-mocked-model
 */

const sandboxUrl = process.env.VK_MOCKED_SANDBOX_URL ?? 'http://localhost:50005';
const repoRoot = process.cwd();
const sandboxRepoDir =
  process.env.VK_MOCKED_SANDBOX_REPO_DIR ??
  path.join(repoRoot, '.vk-mocked-sandbox', 'repos');

test.describe('VK mocked-provider sandbox through VD UI', () => {
  test.beforeEach(async () => {
    await mkdir(sandboxRepoDir, { recursive: true });
  });

  test('creates and reopens a qa-mode VK craft from VD, including mobile navigation and follow-up', async ({
    page,
  }) => {
    test.setTimeout(240_000);

    const runId = Date.now().toString();
    const voyageName = `Mocked Sandbox E2E ${runId}`;
    const repoName = `mocked-provider-e2e-${runId}`;
    const promptTitle = `VD Acceptance Craft E2E ${runId}`;
    const promptBody =
      'Use the qa-mode mocked provider to add a short acceptance note file proving this craft was created from VD UI.';
    const followUp =
      'Follow-up acceptance from VD UI: confirm the mocked qa-mode follow-up path runs without real model tokens.';

    await page.goto(sandboxUrl);
    const createdVoyageWithCraft = await createVoyage(page, voyageName);

    await expect(page.getByText(voyageName).first()).toBeVisible();
    await openSidebarIfNeeded(page);
    await expect(
      page.getByRole('button', { name: 'New Craft' }).first(),
    ).toBeVisible();
    await expect(
      page.getByRole('button', { name: 'Open Craft' }).first(),
    ).toBeVisible();
    await expect(
      page.getByRole('button', { name: '+ Craft' }).first(),
    ).toBeVisible();
    await expect(
      page.getByRole('button', { name: '+ View' }).first(),
    ).toBeVisible();
    await expect(
      page.getByRole('button', { name: '+ Pair' }).first(),
    ).toBeVisible();

    if (!createdVoyageWithCraft) {
      await page.getByRole('button', { name: 'New Craft' }).first().click();
    }
    const createWorkspaceFrame = page
      .frameLocator('iframe[title="Create Workspace"]')
      .last();
    await closeSidebarOverlayIfPresent(page);
    await ensureRepositorySelectionStep(page, createWorkspaceFrame);
    await expect(createWorkspaceFrame.locator('body')).toContainText(
      'Which repositories would you like to work on?',
    );
    await expectCreateWorkspaceFrameUrl(page);
    await clearSelectedRepositories(createWorkspaceFrame);
    await expect(
      createWorkspaceFrame.getByRole('button', { name: 'Recent' }),
    ).toBeVisible();
    await expect(
      createWorkspaceFrame.getByRole('button', { name: 'Browse' }),
    ).toBeVisible();
    await expect(
      createWorkspaceFrame.getByRole('button', { name: 'Create' }),
    ).toBeVisible();

    await dismissVkWelcomeIfPresent(createWorkspaceFrame);
    await createWorkspaceFrame
      .getByRole('button', { name: 'Create' })
      .click();
    await expect(
      createWorkspaceFrame.getByRole('heading', {
        name: 'Create New Repository',
      }),
    ).toBeVisible();
    await createWorkspaceFrame
      .getByRole('textbox', { name: 'my-project' })
      .fill(repoName);
    await createWorkspaceFrame
      .getByRole('textbox', { name: 'Current directory' })
      .fill(sandboxRepoDir);
    await createWorkspaceFrame
      .getByRole('button', { name: 'Create Repository' })
      .click();
    await createWorkspaceFrame
      .getByRole('option', { name: /main/ })
      .click();

    await expect(createWorkspaceFrame.getByText(repoName)).toBeVisible();
    await createWorkspaceFrame
      .getByRole('button', { name: 'Continue' })
      .click();

    await expect(
      createWorkspaceFrame.getByRole('heading', {
        name: 'What would you like to work on?',
      }),
    ).toBeVisible();
    await expect(
      createWorkspaceFrame.getByRole('button', { name: 'Codex' }),
    ).toBeVisible();
    await expect(
      createWorkspaceFrame.getByRole('button', {
        name: new RegExp(
          `^(${escapeRegex(repoName)} · main|\\d+ repositories selected)$`,
        ),
      }),
    ).toBeVisible();
    await createWorkspaceFrame
      .getByRole('textbox', { name: 'Markdown editor' })
      .fill(`${promptTitle}\n\n${promptBody}`);
    await createWorkspaceFrame
      .getByRole('button', { name: 'Create' })
      .click();

    await expect(createWorkspaceFrame.locator('body')).toContainText(
      'System initialized with model: qa-mock',
      { timeout: 60_000 },
    );
    await expect(createWorkspaceFrame.locator('body')).toContainText(
      'QA mode execution completed successfully',
    );
    await expect(createWorkspaceFrame.locator('body')).toContainText(
      '1 file changed',
    );

    await openCreatedCraftFromVd(page, promptTitle);
    const agentFrame = page.frameLocator('iframe[title="Agent"]');
    await expect(agentFrame.first().locator('body')).toContainText(promptTitle);
    await expect(
      page.getByRole('button', { name: 'Agent', exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole('button', { name: 'Code', exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole('button', { name: 'Beads', exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole('button', { name: 'Forms', exact: true }),
    ).toBeVisible();

    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByRole('button', { name: 'Voyage actions' }).last().click();
    await expect(
      page.getByRole('menuitem', { name: 'New Craft' }),
    ).toBeVisible();
    await expect(
      page.getByRole('menuitem', { name: 'Open Craft' }),
    ).toBeVisible();
    await expect(
      page.getByRole('menuitem', { name: 'Switch Voyage' }),
    ).toBeVisible();

    await clickMenuItem(page, 'New Craft');
    await expectCreateWorkspaceFrameUrl(page);
    await page.getByRole('button', { name: 'Voyage actions' }).last().click();
    await clickMenuItem(page, 'Open Craft');
    await page
      .getByRole('textbox', { name: 'Search workspaces...' })
      .fill(promptTitle);
    await page
      .getByRole('button', { name: new RegExp(escapeRegex(promptTitle)) })
      .click();
    await expect(
      page.frameLocator('iframe[title="Agent"]').first().locator('body'),
    ).toContainText(promptTitle);

    await page.setViewportSize({ width: 1280, height: 720 });
    const reopenedAgentFrame = page.frameLocator('iframe[title="Agent"]').first();
    await reopenedAgentFrame
      .getByRole('textbox', { name: 'Markdown editor' })
      .last()
      .fill(followUp);
    await reopenedAgentFrame.getByRole('button', { name: 'Send' }).click();
    await expect(reopenedAgentFrame.locator('body')).toContainText(followUp);
    await expect(reopenedAgentFrame.locator('body')).toContainText(
      'Ran a test command',
      { timeout: 60_000 },
    );

    await page.screenshot({
      fullPage: true,
      path: test.info().outputPath('final-vd-agent-followup.png'),
    });
  });
});

async function createVoyage(
  page: Page,
  voyageName: string,
): Promise<boolean> {
  const onboardingHeading = page.getByRole('heading', {
    name: 'Name the Voyage for this workspace.',
  });

  if (
    !(await onboardingHeading.isVisible({ timeout: 3_000 }).catch(() => false))
  ) {
    await openSidebarIfNeeded(page);
    await clickLocatorInViewport(
      page,
      page.getByRole('button', { name: '+ New Voyage' }),
    );
    await page
      .getByRole('textbox', { name: 'Required voyage name' })
      .fill(voyageName);
    await page.getByRole('button', { name: 'Create New Craft' }).click();
    return true;
  }

  await expect(onboardingHeading).toBeVisible();
  await page.getByRole('textbox', { name: 'Voyage name' }).fill(voyageName);
  await page.getByRole('button', { name: 'Create Voyage' }).click();
  return false;
}

async function ensureRepositorySelectionStep(
  page: Page,
  createWorkspaceFrame: FrameLocator,
) {
  const frameBody = createWorkspaceFrame.locator('body');
  if (
    await frameBody
      .textContent()
      .then((text) =>
        Boolean(text?.includes('Which repositories would you like to work on?')),
      )
      .catch(() => false)
  ) {
    return;
  }

  const selectedRepoButton = createWorkspaceFrame
    .locator('button[title$="(main)"]')
    .first();
  if (await selectedRepoButton.isVisible({ timeout: 5_000 }).catch(() => false)) {
    await selectedRepoButton.evaluate((button) =>
      (button as HTMLButtonElement).click(),
    );
  }
}

async function clearSelectedRepositories(createWorkspaceFrame: FrameLocator) {
  const removeButtons = createWorkspaceFrame.locator(
    'button[aria-label^="Remove "]',
  );
  while ((await removeButtons.count()) > 0) {
    await removeButtons
      .first()
      .evaluate((button) => (button as HTMLButtonElement).click());
  }
}

async function openSidebarIfNeeded(page: Page) {
  const newCraftButton = page.getByRole('button', { name: 'New Craft' }).first();
  if (await newCraftButton.isVisible()) {
    const box = await newCraftButton.boundingBox();
    if (box && box.x >= 0) return;
  }
  await page.getByRole('button', { name: 'Open sidebar' }).first().click();
  await expect(newCraftButton).toBeVisible();
}

async function closeSidebarOverlayIfPresent(page: Page) {
  const overlay = page.getByRole('button', { name: 'Close sidebar overlay' });
  if (await overlay.isVisible().catch(() => false)) {
    await overlay.click();
  }
}

async function clickMenuItem(page: Page, name: string) {
  const menuItem = page.getByRole('menuitem', { name });
  await expect(menuItem).toBeVisible();
  await menuItem.evaluate((element) => (element as HTMLButtonElement).click());
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

  await locator.first().click();
}

async function expectCreateWorkspaceFrameUrl(page: Page) {
  await expect
    .poll(async () => {
      return await page
        .locator('iframe[title="Create Workspace"]')
        .last()
        .evaluate((iframe) => (iframe as HTMLIFrameElement).src);
    })
    .toMatch(/\/workspaces$/);
}

async function dismissVkWelcomeIfPresent(frame: FrameLocator) {
  const closeButton = frame.getByRole('button', { name: 'Close' });
  if (await closeButton.isVisible().catch(() => false)) {
    await closeButton.click();
  }
}

async function openCreatedCraftFromVd(page: Page, promptTitle: string) {
  await openSidebarIfNeeded(page);
  await page.getByRole('button', { name: 'Open Craft' }).first().click();
  await expect(
    page.getByRole('heading', { name: 'Open VK Workspace' }),
  ).toBeVisible();
  await page
    .getByRole('textbox', { name: 'Search workspaces...' })
    .fill(promptTitle);
  await page
    .getByRole('button', { name: new RegExp(escapeRegex(promptTitle)) })
    .click();
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
