import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const verifiedAdapters = new WeakSet<object>();

export interface PinnedGasCityCompilerPolicy {
  mode: "production_packaged" | "hermetic_test";
  gasCityExecutable: string;
  gasCityExecutableSha256: string;
  gasCityArchiveSha256: string;
  gasCityVersion: "1.4.1";
  gasCityBuild: string;
  beadsExecutable: string;
  beadsExecutableSha256: string;
  beadsArchiveSha256: string;
  beadsVersion: "1.2.2";
  compilerIdentity: "gas-city.formula-compiler.v2@1.4.1";
  invocationContract: "gc-formula-show-json.v1";
  /** Test-only controls; rejected for production packaged adapters. */
  testTemporaryRoot?: string;
  testTimeoutMs?: number;
}

export interface CanonicalPinnedGasCityOutput {
  semantics: unknown;
  nodes: Array<{ id: string; role: string; needs: string[]; type: string; stateId: string; roleId: string; actions: unknown }>;
  vars: Array<{ name: string; type: string; required: boolean }>;
}

export interface PinnedGasCityCompilation {
  policy: Omit<PinnedGasCityCompilerPolicy, "gasCityExecutable" | "beadsExecutable" | "testTemporaryRoot" | "testTimeoutMs">;
  formulaSha256: string;
  rawOutputSha256: string;
  canonicalOutputSha256: string;
  canonicalOutput: CanonicalPinnedGasCityOutput;
}

export class PinnedGasCityFormulaCompilerAdapter {
  readonly policy: Readonly<PinnedGasCityCompilerPolicy>;

  private constructor(policy: PinnedGasCityCompilerPolicy) {
    this.policy = Object.freeze({ ...policy });
  }

  static async create(policy: PinnedGasCityCompilerPolicy): Promise<PinnedGasCityFormulaCompilerAdapter> {
    validatePolicy(policy);
    await verifyExecutable(policy.gasCityExecutable, policy.gasCityExecutableSha256);
    await verifyExecutable(policy.beadsExecutable, policy.beadsExecutableSha256);
    const gcVersion = await invoke(policy.gasCityExecutable, ["version", "--json"]);
    let gcIdentity: { version?: unknown; commit?: unknown; build?: unknown };
    try { gcIdentity = JSON.parse(gcVersion.stdout); } catch { throw new Error("Packaged Gas City version response is invalid."); }
    if (gcIdentity.version !== "1.4.1" || (gcIdentity.commit ?? gcIdentity.build) !== policy.gasCityBuild) throw new Error("Packaged Gas City build identity does not match compiler policy.");
    const beadsVersion = await invoke(policy.beadsExecutable, ["version"]);
    if (!/^bd version 1\.2\.2(?:\s|$)/m.test(beadsVersion.stdout)) throw new Error("Packaged Beads identity does not match compiler policy.");
    const adapter = new PinnedGasCityFormulaCompilerAdapter(policy);
    verifiedAdapters.add(adapter);
    return adapter;
  }

  async compileFormula(formulaBytes: Uint8Array): Promise<PinnedGasCityCompilation> {
    if (!verifiedAdapters.has(this)) throw new Error("Unverified Gas City compiler adapter.");
    const formulaText = new TextDecoder().decode(formulaBytes);
    const formulaName = /^formula\s*=\s*"([a-zA-Z0-9_.-]+)"$/m.exec(formulaText)?.[1];
    if (!formulaName) throw new Error("Generated formula name is invalid.");
    const root = await mkdtemp(join(this.policy.testTemporaryRoot ?? tmpdir(), "vd-gc-compiler-"));
    try {
      await chmod(root, 0o700);
      await writeFile(join(root, "city.toml"), '[workspace]\nname = "vd-compiler"\nprovider = "claude"\n\n[providers.claude]\nbase = "builtin:claude"\n\n[daemon]\nformula_v2 = true\n', { mode: 0o600 });
      const formulas = join(root, "formulas");
      await mkdir(formulas, { mode: 0o700 });
      await writeFile(join(formulas, `${formulaName}.toml`), formulaBytes, { mode: 0o600 });
      const result = await invoke(this.policy.gasCityExecutable, ["formula", "show", formulaName, "--json"], root, this.policy.testTimeoutMs);
      const rawOutput = new TextEncoder().encode(result.stdout);
      const parsed = parseCompilerOutput(result.stdout, formulaName);
      return {
        policy: stripPaths(this.policy),
        formulaSha256: sha256(formulaBytes),
        rawOutputSha256: sha256(rawOutput),
        canonicalOutputSha256: sha256(new TextEncoder().encode(JSON.stringify(parsed))),
        canonicalOutput: parsed,
      };
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }
}

export function isVerifiedPinnedGasCityAdapter(value: unknown): value is PinnedGasCityFormulaCompilerAdapter {
  return typeof value === "object" && value !== null && verifiedAdapters.has(value);
}

function parseCompilerOutput(stdout: string, formulaName: string): CanonicalPinnedGasCityOutput {
  let value: any;
  try { value = JSON.parse(stdout); } catch { throw new Error("Pinned Gas City compiler returned invalid structured output."); }
  if (!value || value.schema_version !== "1" || value.ok !== true || value.name !== formulaName || !Array.isArray(value.steps) || (value.vars !== undefined && !Array.isArray(value.vars))) throw new Error("Pinned Gas City compiler output is incomplete.");
  if (value.phase || value.pour === true || value.root_only === true || (Array.isArray(value.warnings) && value.warnings.length) || (value.provided_vars && Object.keys(value.provided_vars).length)) throw new Error("Pinned Gas City compiler output contains unsupported execution semantics.");
  const semanticsText = value.metadata?.vd_execution_semantics;
  if (typeof semanticsText !== "string") throw new Error("Pinned Gas City output omitted execution semantics.");
  let semantics: unknown;
  try { semantics = JSON.parse(semanticsText); } catch { throw new Error("Pinned Gas City output contains invalid execution semantics."); }
  const relevant = value.steps.filter((step: any) => typeof step?.metadata?.vd_workflow_state_id === "string");
  const relevantIds = new Set(relevant.map((step: any) => step.id));
  const normalizedIds = new Map<string, string>(relevant.map((step: any) => [String(step.id), `state-${slug(step.metadata.vd_workflow_state_id).slice(0, 50) || "step"}`]));
  const dependencies = new Map<string, string[]>();
  for (const dep of Array.isArray(value.deps) ? value.deps : []) {
    if (relevantIds.has(dep.step_id) && relevantIds.has(dep.depends_on_id)) {
      const list = dependencies.get(dep.step_id) ?? []; list.push(normalizedIds.get(dep.depends_on_id)!); dependencies.set(dep.step_id, list);
    }
  }
  return canonicalize({
    semantics,
    nodes: relevant.map((step: any) => {
      let actions: unknown;
      try { actions = JSON.parse(step.metadata?.vd_workflow_actions ?? "[]"); } catch { throw new Error("Pinned Gas City output contains invalid route metadata."); }
      return { id: normalizedIds.get(step.id)!, role: String(step.assignee ?? ""), needs: [...(dependencies.get(step.id) ?? [])].sort(), type: String(step.type ?? ""), stateId: String(step.metadata.vd_workflow_state_id), roleId: String(step.metadata.vd_workflow_role_id ?? ""), actions };
    }).sort((a: any, b: any) => a.id.localeCompare(b.id)),
    vars: (value.vars ?? []).map((item: any) => ({ name: String(item.name), type: String(item.type ?? ""), required: item.required === true })).sort((a: any, b: any) => a.name.localeCompare(b.name)),
  }) as CanonicalPinnedGasCityOutput;
}

function validatePolicy(policy: PinnedGasCityCompilerPolicy): void {
  if (policy.gasCityVersion !== "1.4.1" || policy.beadsVersion !== "1.2.2" || policy.compilerIdentity !== "gas-city.formula-compiler.v2@1.4.1" || policy.invocationContract !== "gc-formula-show-json.v1") throw new Error("Unsupported pinned compiler policy.");
  for (const digest of [policy.gasCityExecutableSha256, policy.gasCityArchiveSha256, policy.beadsExecutableSha256, policy.beadsArchiveSha256]) if (!/^[a-f0-9]{64}$/.test(digest)) throw new Error("Pinned compiler policy requires exact SHA-256 digests.");
  if (policy.mode === "hermetic_test") {
    if (process.env.NODE_ENV !== "test") throw new Error("Hermetic compiler fixtures are test-only.");
  } else {
    if (policy.testTemporaryRoot !== undefined || policy.testTimeoutMs !== undefined) throw new Error("Test compiler controls are not allowed in production.");
    const gcRelease = new Map([
      ["8d8c8b511db3fc44931445aab5cb9f212509c0867105c880d6c3d0e6e5d33e42", "38950f1b763f413bd0d7462e9e09de28dff59b604dfa6a1f8521044d057522c4"],
      ["6620ef51c8ba620821e5ef8b208bb1b3de090fa86ec5e0327da1edd615407e29", "129af47a25e44fdb007ce3b597530edf96e02c2f4307c67b39819ab8c55d4139"],
    ]);
    const beadsRelease = new Map([
      ["8140098a51d3b81d5548d1c5e6db1a2d9930e5d141efe2a4bff7d079c4d321e8", "54fc0e0581ce4c5487a5b242f0a4f34af1ef09cf056e164a1af63a6ec7aa1e0e"],
      ["501f38a1070d4b9b3b6261a86a3c92c4a52366869021560430a4bb0036afd83a", "a1a7853e4877ac158c75fe9ca6828e11d9d898d6441b7f729046ce07b2e65afe"],
    ]);
    if (gcRelease.get(policy.gasCityArchiveSha256) !== policy.gasCityExecutableSha256 || beadsRelease.get(policy.beadsArchiveSha256) !== policy.beadsExecutableSha256) throw new Error("Packaged archive and executable digests do not match the pinned release allowlist.");
  }
  if (!policy.gasCityBuild.trim()) throw new Error("Pinned Gas City build identity is required.");
}
async function verifyExecutable(path: string, expected: string): Promise<void> { const actual = sha256(await readFile(path)); if (actual !== expected) throw new Error("Packaged executable digest does not match compiler policy."); }
async function invoke(file: string, args: string[], cwd?: string, timeout = 15_000): Promise<{ stdout: string }> { const result = await execFileAsync(file, args, { cwd, encoding: "utf8", timeout, maxBuffer: 4 * 1024 * 1024 }); return { stdout: result.stdout }; }
function stripPaths(policy: PinnedGasCityCompilerPolicy): PinnedGasCityCompilation["policy"] { const { gasCityExecutable: _gc, beadsExecutable: _bd, testTemporaryRoot: _root, testTimeoutMs: _timeout, ...safe } = policy; return safe; }
function canonicalize(value: unknown): unknown { if (Array.isArray(value)) return value.map(canonicalize); if (value && typeof value === "object") return Object.fromEntries(Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, canonicalize(item)])); return value; }
function slug(value: string): string { return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""); }
function sha256(value: Uint8Array): string { return createHash("sha256").update(value).digest("hex"); }
