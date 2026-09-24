#!/usr/bin/env node
import { spawn } from 'node:child_process';

const encodedArgv = process.env.VD_SERVICE_ARGV_BASE64;
if (!encodedArgv) {
  console.error('VD service runner requires VD_SERVICE_ARGV_BASE64');
  process.exit(64);
}

let argv;
try {
  argv = JSON.parse(Buffer.from(encodedArgv, 'base64').toString('utf8'));
} catch (error) {
  console.error(`Failed to decode VD_SERVICE_ARGV_BASE64: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(64);
}

if (!Array.isArray(argv) || argv.length === 0 || argv.some((entry) => typeof entry !== 'string')) {
  console.error('VD_SERVICE_ARGV_BASE64 must decode to a non-empty string array');
  process.exit(64);
}

const child = spawn(argv[0], argv.slice(1), {
  stdio: 'inherit',
  env: process.env,
  cwd: process.cwd(),
  shell: false,
});

let childExited = false;
child.on('exit', (code, signal) => {
  childExited = true;
  if (signal) {
    process.exit(128 + signalExitCode(signal));
  }
  process.exit(code ?? 1);
});

child.on('error', (error) => {
  console.error(`Failed to start VD plugin service command ${JSON.stringify(argv[0])}: ${error.message}`);
  process.exit(127);
});

function signalExitCode(signal) {
  if (signal === 'SIGHUP') return 1;
  if (signal === 'SIGINT') return 2;
  if (signal === 'SIGTERM') return 15;
  return 0;
}

for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
  process.on(signal, () => {
    if (!childExited) child.kill(signal);
  });
}
