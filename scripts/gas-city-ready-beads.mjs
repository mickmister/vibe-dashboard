#!/usr/bin/env node
import { spawn } from "node:child_process";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

const TERMINAL_STATUSES = new Set(["closed", "archived", "removed"]);

async function main() {
  const { command, flags } = parseArgs(process.argv.slice(2));
  if (command === "help" || command === "--help" || command === "-h") {
    printHelp();
    return;
  }
  if (command !== "launch" && command !== "watch") {
    throw new Error(`Unknown command ${command || "(missing)"}. Run with help for usage.`);
  }
  const input = parseLaunchInput(flags);
  if (command === "launch") {
    const result = await launchReadyBeads(input);
    console.log(JSON.stringify(result, null, 2));
    process.exitCode = result.errors.length > 0 ? 1 : 0;
    return;
  }
  await watchAndLaunch(input, {
    debounceMs: parseIntegerFlag(flags, "debounce-ms", 1_000),
    gcBinary: stringFlag(flags, "gc-binary", "gc"),
  });
}

function parseArgs(args) {
  const command = args[0];
  const flags = {};
  for (let i = 1; i < args.length; i += 1) {
    const arg = args[i];
    if (!arg.startsWith("--")) {
      throw new Error(`Unexpected positional argument ${arg}`);
    }
    const key = arg.slice(2);
    const next = args[i + 1];
    const value = next && !next.startsWith("--") ? next : "true";
    if (value !== "true") i += 1;
    if (flags[key] === undefined) flags[key] = value;
    else if (Array.isArray(flags[key])) flags[key].push(value);
    else flags[key] = [flags[key], value];
  }
  return { command, flags };
}

function parseLaunchInput(flags) {
  return {
    cityPath: requiredFlag(flags, "city"),
    workspacePath: requiredFlag(flags, "workspace"),
    workspaceId: requiredFlag(flags, "workspace-id"),
    target: requiredFlag(flags, "target"),
    formula: stringFlag(flags, "formula", ""),
    convoyId: stringFlag(flags, "convoy", ""),
    parentBeadId: stringFlag(flags, "parent", ""),
    limit: parseOptionalIntegerFlag(flags, "limit"),
    maxActive: parseOptionalIntegerFlag(flags, "max-active") ?? 1,
    nudge: booleanFlag(flags, "nudge"),
    vars: parseKeyValueFlags(flags, "var"),
    formulaByBeadId: parseKeyValueFlags(flags, "formula-for"),
    gcBinary: stringFlag(flags, "gc-binary", "gc"),
    bdBinary: stringFlag(flags, "bd-binary", "bd"),
  };
}

async function launchReadyBeads(input) {
  return withDirectoryLock(join(input.cityPath, ".vd-gc-ready-bead-locks"), lockKey(input.workspaceId), async () => {
    const convoyMembers = input.convoyId
      ? new Set(await listConvoyMembers(input))
      : null;
    const ready = await listReadyBeads(input);
    const active = new Set(await listLiveSourceWorkflowBeadIds(input));
    const activeBefore = active.size;
    const capacity = input.maxActive === 0 ? Number.MAX_SAFE_INTEGER : Math.max(0, input.maxActive - activeBefore);
    const launchLimit = input.limit == null || input.limit === 0 ? Number.POSITIVE_INFINITY : input.limit;
    const selected = [];
    const launched = [];
    const skipped = [];
    const errors = [];
    const formulaContractCache = new Map();

    for (const bead of ready) {
      if (convoyMembers && !convoyMembers.has(bead.id)) {
        skipped.push({ bead, reason: "convoy_mismatch", message: `Bead is not part of convoy ${input.convoyId}.` });
        continue;
      }
      if (TERMINAL_STATUSES.has(bead.status)) {
        skipped.push({ bead, reason: "terminal_status", message: `Bead status is ${bead.status}.` });
        continue;
      }
      if (active.has(bead.id) || hasLiveSourceWorkflow(bead)) {
        skipped.push({ bead, reason: "already_launched", message: "Bead already has a live Gas City source workflow." });
        continue;
      }
      if (selected.length >= capacity) {
        skipped.push({ bead, reason: "capacity_reached", message: "Ready-bead launch capacity is exhausted." });
        continue;
      }
      if (selected.length >= launchLimit) {
        skipped.push({ bead, reason: "limit_reached", message: "Ready-bead per-run launch limit is exhausted." });
        continue;
      }
      const formula = clean(input.formulaByBeadId[bead.id]) || clean(bead.metadata["vd.gas_city.formula"]) || clean(bead.metadata["gc.formula"]) || clean(input.formula);
      if (!formula) {
        skipped.push({ bead, reason: "missing_formula", message: "No formula was supplied and the bead has no formula metadata override." });
        continue;
      }
      selected.push(bead);
      try {
        const contract = await cachedFormulaContract(input, formulaContractCache, formula);
        if (contract !== "graph.v2") {
          throw new Error(`Formula ${formula} must be a graph.v2 formula for gc sling --on launches; got ${contract || "unknown"}.`);
        }
        const args = ["sling", input.target, bead.id, "--on", formula];
        if (input.nudge) args.push("--nudge");
        for (const [key, value] of Object.entries(input.vars).sort(([a], [b]) => a.localeCompare(b))) {
          args.push("--var", `${key}=${value}`);
        }
        const stdout = await execFileStdout(input.gcBinary, args, input.cityPath);
        launched.push({ bead, formula, stdout });
        active.add(bead.id);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (isSourceWorkflowConflict(message)) {
          skipped.push({ bead, reason: "already_launched", message });
          active.add(bead.id);
        } else {
          errors.push({ bead, formula, message });
        }
      }
    }

    return {
      workspaceId: input.workspaceId,
      convoyId: input.convoyId || null,
      lockKey: lockKey(input.workspaceId),
      activeBefore,
      capacity,
      selected,
      launched,
      skipped,
      errors,
      failed: errors,
    };
  });
}

async function watchAndLaunch(input, options) {
  let timer = null;
  let inFlight = Promise.resolve();
  const scheduleLaunch = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      inFlight = inFlight
        .catch(() => {})
        .then(async () => {
          const result = await launchReadyBeads(input);
          console.log(JSON.stringify({ event: "ready-bead-launch", result }));
        })
        .catch((error) => {
          console.error(error instanceof Error ? error.message : String(error));
        });
    }, options.debounceMs);
  };
  scheduleLaunch();
  const child = spawn(options.gcBinary, ["events", "--follow"], {
    cwd: input.cityPath,
    stdio: ["ignore", "pipe", "inherit"],
  });
  let buffer = "";
  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (chunk) => {
    buffer += chunk;
    let newline = buffer.indexOf("\n");
    while (newline >= 0) {
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      if (shouldTriggerFromEventLine(line)) scheduleLaunch();
      newline = buffer.indexOf("\n");
    }
  });
  await new Promise((resolve, reject) => {
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`gc events --follow exited with ${code}`));
    });
  });
  await inFlight;
}

function shouldTriggerFromEventLine(line) {
  if (!line) return false;
  try {
    const event = JSON.parse(line);
    return event?.type === "bead.closed" || event?.type === "bead.updated";
  } catch {
    return false;
  }
}

async function listReadyBeads(input) {
  const args = ["ready", "--json", "--limit", "0"];
  if (input.parentBeadId) args.push("--parent", input.parentBeadId);
  const stdout = await execFileStdout(input.bdBinary, args, input.workspacePath);
  return parseJsonArrayOutput(stdout).map(toReadyBead);
}

async function listConvoyMembers(input) {
  const stdout = await execFileStdout(input.gcBinary, ["convoy", "status", input.convoyId, "--json"], input.cityPath);
  const payload = parseJsonObjectOutput(stdout);
  return Array.isArray(payload.children) ? payload.children.map((child) => String(child?.id || "")).filter(Boolean) : [];
}

async function listLiveSourceWorkflowBeadIds(input) {
  const ids = new Set();
  for (const key of ["workflow_id", "gc.source_bead_id"]) {
    const args = ["list", "--json", "--all", "--has-metadata-key", key, "--limit", "0"];
    const stdout = await execFileStdout(input.bdBinary, args, input.workspacePath);
    for (const raw of parseJsonArrayOutput(stdout)) {
      const bead = toReadyBead(raw);
      if (!bead.id || TERMINAL_STATUSES.has(bead.status)) continue;
      if (key === "gc.source_bead_id" && clean(bead.metadata["gc.source_bead_id"])) {
        ids.add(clean(bead.metadata["gc.source_bead_id"]));
      } else if (key === "workflow_id" && clean(bead.metadata.workflow_id)) {
        ids.add(bead.id);
      }
    }
  }
  return [...ids];
}

async function cachedFormulaContract(input, cache, formula) {
  let pending = cache.get(formula);
  if (!pending) {
    pending = formulaContract(input, formula);
    cache.set(formula, pending);
  }
  return pending;
}

async function formulaContract(input, formula) {
  const stdout = await execFileStdout(input.gcBinary, ["formula", "show", formula, "--json"], input.cityPath);
  const payload = parseJsonObjectOutput(stdout);
  const steps = Array.isArray(payload.steps) ? payload.steps : [];
  for (const step of steps) {
    if (step?.is_root === true && step.metadata && typeof step.metadata === "object") {
      const contract = clean(step.metadata["gc.formula_contract"]);
      if (contract) return contract;
    }
  }
  return null;
}

async function withDirectoryLock(root, key, fn) {
  const staleMs = 10 * 60 * 1000;
  const retryDelayMs = 100;
  const maxWaitMs = 30_000;
  const startedAt = Date.now();
  const ownerToken = `${process.pid}.${startedAt}.${Math.random().toString(36).slice(2)}`;
  const dir = join(root, key.replace(/[^A-Za-z0-9_.-]+/g, "_").slice(0, 180) || "default");
  await mkdir(root, { recursive: true });
  while (true) {
    try {
      await mkdir(dir);
      break;
    } catch (error) {
      if (error?.code !== "EEXIST") throw error;
      await removeStaleLock(dir, staleMs);
      try {
        await mkdir(dir);
        break;
      } catch (retryError) {
        if (retryError?.code !== "EEXIST") throw retryError;
      }
      if (Date.now() - startedAt >= maxWaitMs) throw new Error(`Timed out waiting for ready-bead scheduler lock ${key}`);
      await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
    }
  }
  try {
    await writeFile(
      join(dir, "owner.json"),
      JSON.stringify({
        key,
        token: ownerToken,
        pid: process.pid,
        acquiredAt: new Date().toISOString(),
      }),
    );
    return await fn();
  } finally {
    await releaseDirectoryLock(dir, ownerToken);
  }
}

async function removeStaleLock(dir, staleMs) {
  const ownerPath = join(dir, "owner.json");
  try {
    const owner = JSON.parse(await readFile(ownerPath, "utf8"));
    const acquiredAt = Date.parse(String(owner.acquiredAt || ""));
    if (Number.isFinite(acquiredAt) && Date.now() - acquiredAt >= staleMs) {
      const currentOwner = JSON.parse(await readFile(ownerPath, "utf8"));
      if (currentOwner.token !== owner.token) return;
      await rm(dir, { recursive: true, force: true });
    }
  } catch {
    // Keep uncertain locks rather than deleting a lock we cannot prove stale.
  }
}

async function releaseDirectoryLock(dir, ownerToken) {
  try {
    const owner = JSON.parse(await readFile(join(dir, "owner.json"), "utf8"));
    if (owner.token !== ownerToken) return;
    await rm(dir, { recursive: true, force: true });
  } catch {
    // Missing/unreadable owner means this process no longer owns a releasable lock.
  }
}

function execFileStdout(command, args, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) resolve(stdout.trim());
      else reject(new Error((stderr || stdout || `${command} ${args.join(" ")} failed with ${code}`).trim()));
    });
  });
}

function toReadyBead(raw) {
  const record = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  const metadata = {};
  if (record.metadata && typeof record.metadata === "object" && !Array.isArray(record.metadata)) {
    for (const [key, value] of Object.entries(record.metadata)) {
      if (value != null && typeof value !== "object") metadata[key] = String(value);
    }
  }
  return {
    id: String(record.id || ""),
    title: String(record.title || ""),
    status: String(record.status || "open"),
    labels: Array.isArray(record.labels) ? record.labels.filter((entry) => typeof entry === "string") : [],
    parentId: clean(record.parent) || clean(record.parent_id) || null,
    metadata,
    convoyIds: [],
  };
}

function parseJsonArrayOutput(stdout) {
  const start = stdout.indexOf("[");
  const end = stdout.lastIndexOf("]");
  if (start < 0 || end < start) throw new Error("Command did not return a JSON array");
  const parsed = JSON.parse(stdout.slice(start, end + 1));
  if (!Array.isArray(parsed)) throw new Error("Command did not return a JSON array");
  return parsed;
}

function parseJsonObjectOutput(stdout) {
  const start = stdout.indexOf("{");
  const end = stdout.lastIndexOf("}");
  if (start < 0 || end < start) throw new Error("Command did not return a JSON object");
  const parsed = JSON.parse(stdout.slice(start, end + 1));
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("Command did not return a JSON object");
  return parsed;
}

function lockKey(workspaceId) {
  return `vd.ready-bead-launcher.workspace.${workspaceId}`;
}

function hasLiveSourceWorkflow(bead) {
  return Boolean(clean(bead.metadata.workflow_id));
}

function isSourceWorkflowConflict(message) {
  const lower = message.toLowerCase();
  return (lower.includes("source workflow") || lower.includes("source bead")) &&
    (lower.includes("already") || lower.includes("live workflow") || lower.includes("conflict"));
}

function parseKeyValueFlags(flags, key) {
  const result = {};
  for (const entry of arrayFlag(flags, key)) {
    const separator = entry.indexOf("=");
    if (separator <= 0) throw new Error(`--${key} must use key=value`);
    result[entry.slice(0, separator)] = entry.slice(separator + 1);
  }
  return result;
}

function parseOptionalIntegerFlag(flags, key) {
  const value = stringFlag(flags, key, "");
  if (!value) return null;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 0) throw new Error(`--${key} must be a non-negative integer`);
  return parsed;
}

function parseIntegerFlag(flags, key, fallback) {
  return parseOptionalIntegerFlag(flags, key) ?? fallback;
}

function booleanFlag(flags, key) {
  return flags[key] === "true" || flags[key] === true;
}

function requiredFlag(flags, key) {
  const value = stringFlag(flags, key, "");
  if (!value) throw new Error(`--${key} is required`);
  return value;
}

function stringFlag(flags, key, fallback) {
  const value = flags[key];
  if (Array.isArray(value)) return clean(value[value.length - 1]) || fallback;
  return clean(value) || fallback;
}

function arrayFlag(flags, key) {
  const value = flags[key];
  if (value == null) return [];
  return Array.isArray(value) ? value.map(String) : [String(value)];
}

function clean(value) {
  return typeof value === "string" ? value.trim() : "";
}

function printHelp() {
  console.log(`Usage:
  node scripts/gas-city-ready-beads.mjs launch --city <city> --workspace <repo> --workspace-id <uuid> --target <target> --formula <graph.v2>
  node scripts/gas-city-ready-beads.mjs watch  --city <city> --workspace <repo> --workspace-id <uuid> --target <target> --formula <graph.v2>

Options:
  --convoy <bead>            Restrict to members from "gc convoy status --json"
  --formula-for <id=name>    Per-bead formula override, repeatable
  --var <key=value>          Runtime variable for gc sling --on, repeatable
  --max-active <n>           Active source-workflow cap; default 1; 0 means unlimited
  --limit <n>                Per-invocation launch cap; 0 means unlimited
  --nudge                    Pass --nudge to gc sling
  --debounce-ms <n>          watch-mode debounce, default 1000
`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
