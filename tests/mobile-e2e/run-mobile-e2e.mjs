import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { remote } from 'webdriverio';

const APPIUM_PORT = Number(process.env.APPIUM_PORT || 4723);
const APPIUM_HOST = process.env.APPIUM_HOST || '127.0.0.1';
const REPO_ROOT = path.resolve(import.meta.dirname, '../..');
const ARTIFACTS_DIR = path.resolve(REPO_ROOT, 'artifacts/mobile-e2e');
const SCREENSHOTS_DIR = path.resolve(ARTIFACTS_DIR, 'screenshots');
const APPIUM_LOG = path.resolve(ARTIFACTS_DIR, 'appium.log');
const MOBILE_APK_PATH = process.env.MOBILE_APK_PATH || findFirstApk(ARTIFACTS_DIR);

fs.mkdirSync(SCREENSHOTS_DIR, { recursive: true });

if (!MOBILE_APK_PATH) {
  throw new Error(`MOBILE_APK_PATH is not set and no APK was found in ${ARTIFACTS_DIR}`);
}

if (!fs.existsSync(MOBILE_APK_PATH)) {
  throw new Error(`APK does not exist: ${MOBILE_APK_PATH}`);
}

console.log(`Using APK: ${MOBILE_APK_PATH}`);

const appium = startAppium();
let driver;

try {
  await waitForAppiumStatus();

  driver = await remote({
    hostname: APPIUM_HOST,
    port: APPIUM_PORT,
    path: '/',
    logLevel: 'info',
    capabilities: {
      platformName: 'Android',
      'appium:automationName': 'UiAutomator2',
      'appium:app': MOBILE_APK_PATH,
      'appium:autoWebview': false,
      'appium:newCommandTimeout': 240,
      'appium:adbExecTimeout': 120000,
      'appium:androidInstallTimeout': 180000,
      'appium:chromedriverAutodownload': true,
      'appium:ensureWebviewsHavePages': true,
    },
  });

  const webviewContext = await waitForWebViewContext(driver);
  console.log(`Switching to ${webviewContext}`);
  await driver.switchContext(webviewContext);

  const mainPage = await driver.$('[data-testid="vkvw-main-page"]');
  await mainPage.waitForDisplayed({ timeout: 120000 });

  const heading = await driver.$('[data-testid="vkvw-dashboard-heading"]');
  await heading.waitForDisplayed({ timeout: 30000 });
  const headingText = await heading.getText();

  if (!/Dashboard/i.test(headingText)) {
    throw new Error(`Expected Dashboard heading, got: ${headingText}`);
  }

  console.log('Android mobile WebView rendered the main Dashboard page.');
} catch (error) {
  console.error(error);
  if (driver) {
    await saveScreenshot(driver, path.resolve(SCREENSHOTS_DIR, 'failure.png'));
  }
  process.exitCode = 1;
} finally {
  if (driver) {
    await driver.deleteSession().catch((error) => {
      console.warn('Failed to delete Appium session:', error);
    });
  }

  appium.kill('SIGTERM');
}

function startAppium() {
  const out = fs.openSync(APPIUM_LOG, 'a');
  const child = spawn(
    process.platform === 'win32' ? 'npx.cmd' : 'npx',
    [
      'appium',
      '--address',
      APPIUM_HOST,
      '--port',
      String(APPIUM_PORT),
      '--base-path',
      '/',
      '--allow-insecure',
      'uiautomator2:chromedriver_autodownload',
    ],
    {
      cwd: import.meta.dirname,
      stdio: ['ignore', out, out],
      detached: process.platform !== 'win32',
    },
  );

  child.on('exit', (code, signal) => {
    if (code !== null && code !== 0) {
      console.warn(`Appium exited with code ${code}`);
    } else if (signal) {
      console.warn(`Appium exited due to signal ${signal}`);
    }
  });

  return child;
}

async function waitForAppiumStatus() {
  const statusUrl = `http://${APPIUM_HOST}:${APPIUM_PORT}/status`;
  const timeoutMs = 60000;
  const start = Date.now();
  let lastError;

  while (Date.now() - start < timeoutMs) {
    try {
      const response = await fetch(statusUrl);
      if (response.ok) {
        console.log('Appium is ready.');
        return;
      }
    } catch (error) {
      lastError = error;
    }
    await delay(1000);
  }

  throw new Error(`Timed out waiting for Appium at ${statusUrl}: ${lastError}`);
}

async function waitForWebViewContext(driver) {
  const timeoutMs = 120000;
  const start = Date.now();
  let lastContexts = [];

  while (Date.now() - start < timeoutMs) {
    lastContexts = await driver.getContexts();
    const webviewContext = lastContexts.find((context) => String(context).startsWith('WEBVIEW'));
    if (webviewContext) {
      return webviewContext;
    }
    await delay(2000);
  }

  throw new Error(`Timed out waiting for WEBVIEW context. Last contexts: ${JSON.stringify(lastContexts)}`);
}

async function saveScreenshot(driver, filePath) {
  try {
    await driver.saveScreenshot(filePath);
    console.log(`Saved screenshot to ${filePath}`);
  } catch (error) {
    console.warn('Failed to save screenshot:', error);
  }
}

function findFirstApk(root) {
  if (!fs.existsSync(root)) {
    return undefined;
  }

  const queue = [root];
  while (queue.length > 0) {
    const current = queue.shift();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        queue.push(fullPath);
      } else if (entry.isFile() && entry.name.endsWith('.apk')) {
        return fullPath;
      }
    }
  }

  return undefined;
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
