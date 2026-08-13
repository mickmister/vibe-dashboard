#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const DEFAULT_STORIES = [
  'workflows-graph--git-hub-ci-wait-action',
  'workflows-run-presentation--waiting-on-git-hub-ci',
  'workflows-home--workspace-overview',
];

const baseUrl = (process.env.STORYBOOK_URL || process.env.STORYBOOK_BASE_URL || 'http://localhost:6006').replace(/\/$/u, '');
const outDir = process.env.WORKFLOW_STORYBOOK_ARTIFACT_DIR || '/tmp/vd-workflow-m112-storybook-artifacts';
const storyIds = process.argv.slice(2).filter(Boolean).length ? process.argv.slice(2).filter(Boolean) : DEFAULT_STORIES;
const pauseMs = Number(process.env.WORKFLOW_STORYBOOK_PAUSE_MS || 1400);
const scrollStep = Number(process.env.WORKFLOW_STORYBOOK_SCROLL_STEP || 420);
const viewport = {
  width: Number(process.env.WORKFLOW_STORYBOOK_WIDTH || 1280),
  height: Number(process.env.WORKFLOW_STORYBOOK_HEIGHT || 900),
};

async function main() {
  fs.mkdirSync(outDir, { recursive: true });
  const screenshotDir = path.join(outDir, 'screenshots');
  const videoDir = path.join(outDir, 'video');
  fs.mkdirSync(screenshotDir, { recursive: true });
  fs.mkdirSync(videoDir, { recursive: true });

  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport, recordVideo: { dir: videoDir, size: viewport } });
  const page = await context.newPage();
  const visited = [];
  try {
    for (const storyId of storyIds) {
      await openStory(page, storyId);
      await pause(page, pauseMs);
      const before = path.join(screenshotDir, `${safeName(storyId)}-top.png`);
      await page.screenshot({ path: before, fullPage: false });
      await scrollStoryToBottom(page, storyId);
      await pause(page, pauseMs);
      const after = path.join(screenshotDir, `${safeName(storyId)}-bottom.png`);
      await page.screenshot({ path: after, fullPage: true });
      visited.push({ storyId, before, after });
    }
  } finally {
    await context.close();
    await browser.close();
  }

  const summary = {
    baseUrl,
    outDir,
    viewport,
    pauseMs,
    scrollStep,
    visited,
    videos: fs.readdirSync(videoDir).filter((name) => name.endsWith('.webm')).map((name) => path.join(videoDir, name)),
  };
  fs.writeFileSync(path.join(outDir, 'summary.json'), JSON.stringify(summary, null, 2));
  console.log(JSON.stringify(summary, null, 2));
}

async function openStory(page, storyId) {
  const url = `${baseUrl}/iframe?id=${encodeURIComponent(storyId)}&viewMode=story`;
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await waitForStoryContent(page, storyId);
}

async function waitForStoryContent(page, storyId) {
  await page.waitForFunction(
    ({ storyId }) => {
      const bodyText = document.body.innerText || '';
      if (bodyText.includes('No Preview')) return false;
      if (bodyText.includes('Loading workflow')) return false;
      if (bodyText.includes('Loading workflow graph')) return false;
      const root = document.querySelector('#storybook-root') || document.body;
      const text = root.textContent || '';
      if (!text.trim()) return false;
      if (storyId.includes('graph')) return Boolean(document.querySelector('[data-testid="workflow-react-flow-canvas"]')) && text.includes('Graph');
      if (storyId.includes('run-presentation')) return text.includes('Timeline') || text.includes('Workflow not found');
      if (storyId.includes('home')) return text.includes('Your workflows') || text.includes('No workflows yet');
      return true;
    },
    { storyId },
    { timeout: 20_000 },
  );
}

async function scrollStoryToBottom(page, storyId) {
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
  await pause(page, 400);
  let lastY = -1;
  for (let i = 0; i < 40; i += 1) {
    const metrics = await page.evaluate(() => ({ y: window.scrollY, max: Math.max(0, document.documentElement.scrollHeight - window.innerHeight) }));
    if (metrics.y >= metrics.max || metrics.y === lastY) break;
    lastY = metrics.y;
    await page.evaluate((step) => window.scrollBy({ top: step, behavior: 'smooth' }), scrollStep);
    await pause(page, Math.max(700, Math.floor(pauseMs / 2)));
  }
  // Keep graph labels/details visible even when graph stories are shorter than the viewport.
  if (storyId.includes('graph')) await pause(page, pauseMs);
}

async function pause(page, ms) {
  await page.waitForTimeout(ms);
}

function safeName(value) {
  return value.replace(/[^a-z0-9_-]+/giu, '-').replace(/^-|-$/gu, '');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
