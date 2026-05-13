import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sourceDir = path.join(rootDir, 'dist', 'react-native', 'browser');
const destinationDir = path.join(rootDir, 'apps', 'mobile', 'assets', 'web');

const sourceHtmlPath = path.join(sourceDir, 'index.html');
if (!fs.existsSync(sourceHtmlPath)) {
  throw new Error(`Missing mobile browser build output: ${sourceHtmlPath}`);
}

fs.mkdirSync(destinationDir, { recursive: true });

const html = fs.readFileSync(sourceHtmlPath, 'utf8');
const cssMatch = html.match(/<link[^>]+href=["']([^"']+\.css)["']/i);
const jsMatch = html.match(/<script[^>]+src=["']([^"']+\.js)["']/i);

const resolveBuiltAsset = (assetPath) => {
  const cleanAssetPath = assetPath.replace(/^\//, '');
  return path.join(sourceDir, cleanAssetPath);
};

const destinationCssPath = path.join(destinationDir, 'index-css.css');
const destinationJsPath = path.join(destinationDir, 'index-js.js.asset');
const destinationHtmlPath = path.join(destinationDir, 'index.html');

if (cssMatch) {
  fs.copyFileSync(resolveBuiltAsset(cssMatch[1]), destinationCssPath);
} else {
  fs.writeFileSync(destinationCssPath, '', 'utf8');
}

if (!jsMatch) {
  throw new Error('Could not find bundled JS asset in mobile browser index.html');
}
fs.copyFileSync(resolveBuiltAsset(jsMatch[1]), destinationJsPath);

let rewrittenHtml = html;
if (cssMatch) {
  rewrittenHtml = rewrittenHtml.replace(cssMatch[1], '/dist/index-mobile.css');
} else {
  rewrittenHtml = rewrittenHtml.replace(
    '</head>',
    `  <link rel="stylesheet" href="/dist/index-mobile.css">\n</head>`,
  );
}
rewrittenHtml = rewrittenHtml.replace(jsMatch[1], '/dist/index-mobile.js');

fs.writeFileSync(destinationHtmlPath, rewrittenHtml, 'utf8');

console.log(`Synced mobile web assets into ${path.relative(rootDir, destinationDir)}`);
