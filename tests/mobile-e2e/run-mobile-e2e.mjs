import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { remote } from 'webdriverio';

const APPIUM_PORT = Number(process.env.APPIUM_PORT || 4723);
const APPIUM_HOST = process.env.APPIUM_HOST || '127.0.0.1';
const MOBILE_E2E_PLATFORM = normalizePlatform(process.env.MOBILE_E2E_PLATFORM || 'android');
const MOBILE_E2E_TEST_MODE = normalizeTestMode(process.env.MOBILE_E2E_TEST_MODE || 'webview');
const REPO_ROOT = path.resolve(import.meta.dirname, '../..');
const ARTIFACTS_DIR = path.resolve(
  REPO_ROOT,
  process.env.MOBILE_E2E_ARTIFACTS_DIR || process.env.ARTIFACTS_DIR || `artifacts/mobile-e2e/${MOBILE_E2E_PLATFORM}`,
);
const SCREENSHOTS_DIR = path.resolve(ARTIFACTS_DIR, 'screenshots');
const APPIUM_LOG = path.resolve(ARTIFACTS_DIR, 'appium.log');
const MOBILE_APP_PATH = process.env.MOBILE_APP_PATH || findFirstApp(ARTIFACTS_DIR, MOBILE_E2E_PLATFORM);

fs.mkdirSync(SCREENSHOTS_DIR, { recursive: true });

if (!MOBILE_APP_PATH) {
  throw new Error(`MOBILE_APP_PATH is not set and no ${MOBILE_E2E_PLATFORM} app was found in ${ARTIFACTS_DIR}`);
}

if (!fs.existsSync(MOBILE_APP_PATH)) {
  throw new Error(`App does not exist: ${MOBILE_APP_PATH}`);
}

console.log(`Using ${MOBILE_E2E_PLATFORM} app for ${MOBILE_E2E_TEST_MODE} E2E: ${MOBILE_APP_PATH}`);

const appium = startAppium(MOBILE_E2E_PLATFORM);
let driver;

try {
  await waitForAppiumStatus();

  driver = await remote({
    hostname: APPIUM_HOST,
    port: APPIUM_PORT,
    path: '/',
    logLevel: 'info',
    capabilities: createCapabilities(MOBILE_E2E_PLATFORM, MOBILE_APP_PATH),
  });

  if (MOBILE_E2E_TEST_MODE === 'native') {
    await assertNativeChatView(driver);
  } else {
    await assertWebViewDashboard(driver);
  }

  console.log(`${displayPlatform(MOBILE_E2E_PLATFORM)} mobile ${MOBILE_E2E_TEST_MODE} E2E passed.`);
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

function normalizePlatform(platform) {
  const normalized = platform.toLowerCase();
  if (normalized !== 'android' && normalized !== 'ios') {
    throw new Error(`Unsupported MOBILE_E2E_PLATFORM: ${platform}`);
  }
  return normalized;
}

function normalizeTestMode(testMode) {
  const normalized = testMode.toLowerCase();
  if (normalized !== 'webview' && normalized !== 'native') {
    throw new Error(`Unsupported MOBILE_E2E_TEST_MODE: ${testMode}`);
  }
  return normalized;
}

function displayPlatform(platform) {
  return platform === 'ios' ? 'iOS' : 'Android';
}

async function assertWebViewDashboard(driver) {
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
}

async function assertNativeChatView(driver) {
  const screen = await driver.$('~Native chat screen');
  await screen.waitForDisplayed({ timeout: 120000 });

  const welcome = await driver.$('~Native chat welcome');
  await welcome.waitForDisplayed({ timeout: 30000 });
  const welcomeText = await welcome.getText();

  if (!/How can I help you today\?/i.test(welcomeText)) {
    throw new Error(`Expected native welcome text, got: ${welcomeText}`);
  }

  const composer = await driver.$('~Message input');
  await composer.waitForDisplayed({ timeout: 30000 });
}

function createCapabilities(platform, appPath) {
  if (platform === 'ios') {
    return {
      platformName: 'iOS',
      'appium:automationName': process.env.APPIUM_AUTOMATION_NAME || 'XCUITest',
      'appium:app': appPath,
      'appium:deviceName': process.env.IOS_DEVICE_NAME || 'iPhone 16',
      ...(process.env.IOS_DEVICE_UDID ? { 'appium:udid': process.env.IOS_DEVICE_UDID } : {}),
      ...(process.env.IOS_PLATFORM_VERSION ? { 'appium:platformVersion': process.env.IOS_PLATFORM_VERSION } : {}),
      'appium:autoAcceptAlerts': true,
      'appium:autoWebview': false,
      'appium:newCommandTimeout': 240,
      'appium:includeSafariInWebviews': true,
      'appium:fullContextList': true,
      'appium:webviewConnectTimeout': 120000,
    };
  }

  return {
    platformName: 'Android',
    'appium:automationName': process.env.APPIUM_AUTOMATION_NAME || 'UiAutomator2',
    'appium:app': appPath,
    'appium:autoWebview': false,
    'appium:newCommandTimeout': 240,
    'appium:adbExecTimeout': 120000,
    'appium:androidInstallTimeout': 180000,
    'appium:chromedriverAutodownload': true,
    'appium:ensureWebviewsHavePages': true,
  };
}

function startAppium(platform) {
  const out = fs.openSync(APPIUM_LOG, 'a');
  const args = [
    'appium',
    '--address',
    APPIUM_HOST,
    '--port',
    String(APPIUM_PORT),
    '--base-path',
    '/',
  ];

  if (platform === 'android') {
    args.push('--allow-insecure', 'uiautomator2:chromedriver_autodownload');
  }

  const child = spawn(process.platform === 'win32' ? 'npx.cmd' : 'npx', args, {
    cwd: import.meta.dirname,
    stdio: ['ignore', out, out],
    detached: process.platform !== 'win32',
  });

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

function findFirstApp(root, platform) {
  if (!fs.existsSync(root)) {
    return undefined;
  }

  const queue = [root];
  while (queue.length > 0) {
    const current = queue.shift();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        if (platform === 'ios' && entry.name.endsWith('.app')) {
          return fullPath;
        }
        queue.push(fullPath);
      } else if (entry.isFile() && platform === 'android' && entry.name.endsWith('.apk')) {
        return fullPath;
      }
    }
  }

  return undefined;
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
