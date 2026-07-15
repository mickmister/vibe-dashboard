import { spawn } from 'node:child_process';
import { stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createServer } from 'node:net';
import { BEADS_FORM_DISABLE_HMR_ENV, buildBeadsFormPreviewDevEnv, shouldDisableBeadsFormHmr } from '../../src/lib/beadsFormDevServer';

export type PreviewOptions = {
  formsDir?: string;
  port?: string;
  serverPort?: string;
  host?: string;
  printOnly?: boolean;
};

export type PreviewConfig = {
  formsDir: string;
  port: string;
  serverPort: string;
  url: string;
};

export function buildBeadsFormPreviewUrl(args: { origin: string; formsDir: string }): string {
  const params = new URLSearchParams();
  params.set('folder', resolve(args.formsDir));
  return `${args.origin.replace(/\/$/, '')}/dashboard/forms/preview?${params.toString()}`;
}

export function parsePreviewArgs(argv: string[]): PreviewOptions {
  const options: PreviewOptions = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--folder' || arg === '-f') {
      options.formsDir = argv[index + 1];
      index += 1;
      continue;
    }
    if (arg?.startsWith('--folder=')) {
      options.formsDir = arg.slice('--folder='.length);
      continue;
    }
    if (arg === '--port' || arg === '-p') {
      options.port = argv[index + 1];
      index += 1;
      continue;
    }
    if (arg?.startsWith('--port=')) {
      options.port = arg.slice('--port='.length);
      continue;
    }
    if (arg === '--server-port') {
      options.serverPort = argv[index + 1];
      index += 1;
      continue;
    }
    if (arg?.startsWith('--server-port=')) {
      options.serverPort = arg.slice('--server-port='.length);
      continue;
    }
    if (arg === '--host') {
      options.host = argv[index + 1];
      index += 1;
      continue;
    }
    if (arg?.startsWith('--host=')) {
      options.host = arg.slice('--host='.length);
      continue;
    }
    if (arg === '--print-only') {
      options.printOnly = true;
      continue;
    }
    if (!arg?.startsWith('-') && !options.formsDir) {
      options.formsDir = arg;
    }
  }
  return options;
}

export async function resolvePreviewConfig(options: PreviewOptions): Promise<PreviewConfig> {
  const rawFormsDir = options.formsDir ?? process.env.FORMS_DIR;
  if (!rawFormsDir) {
    throw new Error('Usage: npm run dev:beads-form-preview -- --folder /path/to/forms');
  }
  const formsDir = resolve(rawFormsDir);

  const folderStat = await stat(formsDir).catch(() => undefined);
  if (!folderStat?.isDirectory()) {
    throw new Error(`Forms folder does not exist or is not a directory: ${formsDir}`);
  }

  const port = options.port ?? process.env.BEADS_FORM_PREVIEW_PORT ?? String(await findFreePort(51000));
  const serverPort = options.serverPort ?? process.env.BEADS_FORM_PREVIEW_SERVER_PORT ?? String(await findFreePort(Number(port) + 1));
  const host = options.host ?? process.env.BEADS_FORM_PREVIEW_HOST ?? `http://localhost:${port}`;
  return {
    formsDir,
    port,
    serverPort,
    url: buildBeadsFormPreviewUrl({ origin: host, formsDir }),
  };
}

async function findFreePort(start: number): Promise<number> {
  for (let port = start; port < start + 1000; port += 1) {
    if (await canListen(port)) return port;
  }
  throw new Error(`Could not find a free port starting at ${start}`);
}

function canListen(port: number): Promise<boolean> {
  return new Promise((resolveCanListen) => {
    const server = createServer();
    server.once('error', () => resolveCanListen(false));
    server.once('listening', () => {
      server.close(() => resolveCanListen(true));
    });
    server.listen(port, '0.0.0.0');
  });
}

async function main() {
  const options = parsePreviewArgs(process.argv.slice(2));
  const config = await resolvePreviewConfig(options);
  console.log('BeadsForm folder preview');
  console.log(`Forms folder: ${config.formsDir}`);
  console.log(`Preview URL:  ${config.url}`);
  const devEnv = buildBeadsFormPreviewDevEnv(process.env);
  console.log(`Browser auto-reload: ${shouldDisableBeadsFormHmr(devEnv) ? `disabled (${BEADS_FORM_DISABLE_HMR_ENV}=1)` : 'enabled'}`);
  console.log('');
  if (options.printOnly) return;

  const child = spawn('npm', ['run', 'dev'], {
    stdio: 'inherit',
    env: {
      ...devEnv,
      FORMS_DIR: config.formsDir,
      PORT: config.port,
      SERVER_PORT: config.serverPort,
    },
  });

  child.on('exit', (code, signal) => {
    if (signal) process.kill(process.pid, signal);
    process.exit(code ?? 0);
  });
}

if (process.argv[1] && import.meta.url === new URL(process.argv[1], 'file:').href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
