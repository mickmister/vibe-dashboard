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
const VIDEOS_DIR = path.resolve(ARTIFACTS_DIR, 'videos');
const MOBILE_APP_PATH = process.env.MOBILE_APP_PATH || findFirstApp(ARTIFACTS_DIR, MOBILE_E2E_PLATFORM);

fs.mkdirSync(SCREENSHOTS_DIR, { recursive: true });
fs.mkdirSync(VIDEOS_DIR, { recursive: true });

if (!MOBILE_APP_PATH) {
  throw new Error(`MOBILE_APP_PATH is not set and no ${MOBILE_E2E_PLATFORM} app was found in ${ARTIFACTS_DIR}`);
}

if (!fs.existsSync(MOBILE_APP_PATH)) {
  throw new Error(`App does not exist: ${MOBILE_APP_PATH}`);
}

console.log(`Using ${MOBILE_E2E_PLATFORM} app for ${MOBILE_E2E_TEST_MODE} E2E: ${MOBILE_APP_PATH}`);

const appium = startAppium(MOBILE_E2E_PLATFORM);
let driver;
let screenRecording;

try {
  await waitForAppiumStatus();

  driver = await remote({
    hostname: APPIUM_HOST,
    port: APPIUM_PORT,
    path: '/',
    logLevel: 'info',
    connectionRetryTimeout: Number(process.env.WEBDRIVER_CONNECTION_RETRY_TIMEOUT || 720000),
    connectionRetryCount: Number(process.env.WEBDRIVER_CONNECTION_RETRY_COUNT || 1),
    capabilities: createCapabilities(MOBILE_E2E_PLATFORM, MOBILE_APP_PATH),
  });

  screenRecording = await startScreenRecording(driver, MOBILE_E2E_PLATFORM);

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
    await savePageSource(driver, path.resolve(ARTIFACTS_DIR, 'page-source-failure.xml'));
  }
  process.exitCode = 1;
} finally {
  if (driver) {
    if (screenRecording) {
      await stopScreenRecording(screenRecording);
    }

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

async function startScreenRecording(driver, platform) {
  if (process.env.MOBILE_E2E_RECORD_VIDEO === 'false') {
    console.log('Mobile E2E screen recording disabled by MOBILE_E2E_RECORD_VIDEO=false.');
    return undefined;
  }

  try {
    if (platform === 'ios') {
      const filePath = path.resolve(VIDEOS_DIR, 'ios-mobile-e2e.mp4');
      const timeLimit = String(Number(process.env.MOBILE_E2E_RECORDING_TIME_LIMIT_SECONDS || 180));
      await driver.startRecordingScreen({
        timeLimit,
        videoType: 'h264',
        videoQuality: 'medium',
        videoFps: 10,
      });
      console.log(`Started iOS Appium screen recording for active test window: ${filePath}`);
      return { kind: 'appium', platform, driver, filePath };
    }

    const deviceFilePath = '/sdcard/mobile-e2e.mp4';
    const logPath = path.resolve(VIDEOS_DIR, 'android-screenrecord.log');
    const out = fs.openSync(logPath, 'a');
    const child = spawn('adb', ['shell', 'screenrecord', '--bugreport', '--bit-rate', '1000000', deviceFilePath], {
      stdio: ['ignore', out, out],
      detached: process.platform !== 'win32',
    });
    console.log(`Started Android screen recording for active Appium test window: ${deviceFilePath}`);
    await delay(1000);
    return { kind: 'process', platform, child, deviceFilePath, filePath: path.resolve(VIDEOS_DIR, 'android-mobile-e2e.mp4') };
  } catch (error) {
    console.warn('Failed to start screen recording:', error);
    return undefined;
  }
}

async function stopScreenRecording(recording) {
  if (!recording) {
    return;
  }

  if (recording.kind === 'appium') {
    try {
      const base64Video = await recording.driver.stopRecordingScreen();
      if (!base64Video) {
        console.warn('Screen recording stopped but Appium returned no video data.');
        return;
      }
      fs.writeFileSync(recording.filePath, Buffer.from(base64Video, 'base64'));
      console.log(`Saved screen recording to ${recording.filePath}`);
    } catch (error) {
      console.warn('Failed to stop Appium screen recording:', error);
    }
    return;
  }

  try {
    signalChildProcessGroup(recording.child, 'SIGINT');
    await waitForChild(recording.child, Number(process.env.MOBILE_E2E_RECORDING_STOP_TIMEOUT_MS || 60000));
  } catch (error) {
    console.warn('Failed to stop screen recording cleanly:', error);
    signalChildProcessGroup(recording.child, 'SIGTERM');
  }

  if (recording.platform === 'android') {
    await runCommand('adb', ['pull', recording.deviceFilePath, recording.filePath]).catch((error) => {
      console.warn('Failed to pull Android screen recording:', error);
    });
    await runCommand('adb', ['shell', 'rm', recording.deviceFilePath]).catch(() => {});
  }

  console.log(`Saved screen recording to ${recording.filePath}`);
}

function signalChildProcessGroup(child, signal) {
  if (process.platform === 'win32') {
    child.kill(signal);
    return;
  }

  try {
    process.kill(-child.pid, signal);
  } catch (error) {
    console.warn(`Failed to signal process group for ${child.pid}; signaling child directly:`, error);
    child.kill(signal);
  }
}

function waitForChild(child, timeoutMs) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error(`Timed out waiting for process ${child.pid} to exit`));
    }, timeoutMs);

    child.once('exit', () => {
      clearTimeout(timeout);
      resolve();
    });
  });
}

function runCommand(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: 'inherit' });
    child.once('exit', (code, signal) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`${command} ${args.join(' ')} failed with code ${code} signal ${signal}`));
      }
    });
  });
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
  await waitForAnyDisplayed(
    driver,
    [
      '~Native chat welcome',
      '-ios predicate string:name CONTAINS "Native chat welcome" OR label CONTAINS "Native chat welcome"',
      '//*[@content-desc="Native chat welcome"]',
    ],
    120000,
  );

  const source = await driver.getPageSource();
  assertSourceIncludes(source, 'Native chat screen');
  assertSourceIncludes(source, 'Native chat welcome');
  assertSourceIncludes(source, "What's the weather in Tokyo?");
  assertSourceIncludes(source, 'Tell me a joke');
  assertSourceIncludes(source, 'Help me write an email');
  assertSourceIncludes(source, 'Message input');
}

function assertSourceIncludes(source, expected) {
  if (!source.includes(expected)) {
    throw new Error(`Expected native page source to include ${JSON.stringify(expected)}`);
  }
}

async function waitForAnyDisplayed(driver, selectors, timeoutMs) {
  const start = Date.now();
  const attempts = [];

  while (Date.now() - start < timeoutMs) {
    for (const selector of selectors) {
      try {
        const element = await driver.$(selector);
        if (await element.isDisplayed()) {
          console.log(`Found displayed element with selector: ${selector}`);
          return element;
        }
      } catch (error) {
        attempts.push(`${selector}: ${error.message}`);
      }
    }
    await delay(1000);
  }

  throw new Error(`Timed out waiting for one of: ${selectors.join(', ')}. Last errors: ${attempts.slice(-5).join(' | ')}`);
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
      'appium:isHeadless': process.env.IOS_SIMULATOR_HEADLESS !== 'false',
      'appium:simulatorStartupTimeout': Number(process.env.IOS_SIMULATOR_STARTUP_TIMEOUT || 600000),
      'appium:wdaLaunchTimeout': Number(process.env.IOS_WDA_LAUNCH_TIMEOUT || 600000),
      'appium:wdaConnectionTimeout': Number(process.env.IOS_WDA_CONNECTION_TIMEOUT || 600000),
      'appium:wdaStartupRetries': Number(process.env.IOS_WDA_STARTUP_RETRIES || 2),
      'appium:wdaStartupRetryInterval': Number(process.env.IOS_WDA_STARTUP_RETRY_INTERVAL || 20000),
      'appium:showXcodeLog': process.env.IOS_SHOW_XCODE_LOG !== 'false',
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
    const webviewContext = lastContexts.find((context) => contextId(context).startsWith('WEBVIEW'));
    if (webviewContext) {
      return contextId(webviewContext);
    }
    await delay(2000);
  }

  throw new Error(`Timed out waiting for WEBVIEW context. Last contexts: ${JSON.stringify(lastContexts)}`);
}

function contextId(context) {
  return typeof context === 'string' ? context : String(context?.id || '');
}

async function saveScreenshot(driver, filePath) {
  try {
    await driver.saveScreenshot(filePath);
    console.log(`Saved screenshot to ${filePath}`);
  } catch (error) {
    console.warn('Failed to save screenshot:', error);
  }
}

async function savePageSource(driver, filePath) {
  try {
    const source = await driver.getPageSource();
    fs.writeFileSync(filePath, source);
    console.log(`Saved page source to ${filePath}`);
  } catch (error) {
    console.warn('Failed to save page source:', error);
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
