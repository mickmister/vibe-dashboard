export interface WorkflowBeadPromptSummary {
  beadId: string;
  title: string;
  status?: string | null;
  labels?: string[];
  workspaceId?: string | null;
}

export interface WorkflowBeadPromptContext {
  beadIds: string[];
  beads: WorkflowBeadPromptSummary[];
  unavailableReason?: string | null;
  sample?: boolean;
}

export function extractWorkflowBeadIds(input: unknown): string[] {
  const record = asRecord(input);
  const workflowContext = asRecord(record?.workflowContext);
  const candidates = [
    record?.beadIds,
    record?.beadId,
    workflowContext?.beadIds,
    workflowContext?.beadId,
  ];
  const ids: string[] = [];
  for (const candidate of candidates) {
    if (Array.isArray(candidate)) ids.push(...candidate.filter((item): item is string => typeof item === 'string'));
    else if (typeof candidate === 'string') ids.push(candidate);
  }
  return uniqueClean(ids);
}

export function withWorkflowBeadContextInput(inputs: Record<string, unknown>, beadIds: string[]): Record<string, unknown> {
  const clean = uniqueClean(beadIds);
  if (!clean.length) return inputs;
  const existingContext = asRecord(inputs.workflowContext) ?? {};
  return {
    ...inputs,
    workflowContext: {
      ...existingContext,
      beadIds: clean,
    },
  };
}

export async function resolveWorkflowBeadPromptContext(input: {
  inputs: unknown;
  provider?: WorkflowBeadPromptProvider | null;
}): Promise<WorkflowBeadPromptContext | null> {
  const beadIds = extractWorkflowBeadIds(input.inputs);
  if (!beadIds.length) return null;
  if (!input.provider) {
    return { beadIds, beads: beadIds.map((beadId) => ({ beadId, title: beadId })), unavailableReason: 'Bead details are unavailable.' };
  }
  try {
    const beads = await input.provider.readBeads(beadIds);
    const byId = new Map(beads.map((bead) => [bead.beadId, bead]));
    return {
      beadIds,
      beads: beadIds.map((beadId) => summarizeBead(byId.get(beadId) ?? { beadId, title: beadId, status: 'open', accessible: true })),
      unavailableReason: null,
    };
  } catch (error) {
    return {
      beadIds,
      beads: beadIds.map((beadId) => ({ beadId, title: beadId })),
      unavailableReason: scrubPromptContextText(error instanceof Error ? error.message : String(error)),
    };
  }
}

export function sampleWorkflowBeadPromptContext(): WorkflowBeadPromptContext {
  return {
    beadIds: ['vibe-kanban-vscode-web-example'],
    beads: [{ beadId: 'vibe-kanban-vscode-web-example', title: 'Example workflow task', status: 'open', labels: ['workflow'] }],
    sample: true,
  };
}

export function composeWorkflowAgentPrompt(input: {
  basePrompt: string;
  beadContext?: WorkflowBeadPromptContext | null;
}): string {
  const base = input.basePrompt.trim();
  const context = renderWorkflowBeadContextSection(input.beadContext);
  if (!context) return base;
  const marker = 'Expected XML Schema (XSD):';
  const markerIndex = base.indexOf(marker);
  if (markerIndex === -1) return [base, context].filter(Boolean).join('\n\n');
  const before = base.slice(0, markerIndex).trimEnd();
  const after = base.slice(markerIndex).trimStart();
  return [before, context, after].filter(Boolean).join('\n\n');
}

export function renderWorkflowBeadContextSection(context?: WorkflowBeadPromptContext | null): string | null {
  if (!context?.beads.length) return null;
  const lines = context.beads.map((bead) => {
    const status = bead.status ? ` (${scrubPromptContextText(bead.status)})` : '';
    const labels = bead.labels?.length ? ` — labels: ${bead.labels.slice(0, 6).map(scrubPromptContextText).join(', ')}` : '';
    return `- ${scrubPromptContextText(bead.beadId)}: ${scrubPromptContextText(bead.title)}${status}${labels}`;
  });
  return [
    context.sample ? '## Task context (sample bead context for preview)' : '## Task context',
    ...lines,
    context.unavailableReason ? `- Bead details note: ${scrubPromptContextText(context.unavailableReason)}` : null,
    'Use the task context above and any explicitly available typed bead tools to inspect more details when needed.',
  ].filter((line): line is string => Boolean(line)).join('\n');
}

export interface WorkflowBeadPromptProviderBead {
  beadId: string;
  title: string;
  status?: string | null;
  accessible?: boolean;
  labels?: string[];
  workspaceId?: string | null;
}

export interface WorkflowBeadPromptProvider {
  readBeads(beadIds: string[]): Promise<WorkflowBeadPromptProviderBead[]>;
}

function summarizeBead(bead: WorkflowBeadPromptProviderBead): WorkflowBeadPromptSummary {
  return {
    beadId: scrubPromptContextText(bead.beadId),
    title: scrubPromptContextText(bead.title),
    status: bead.status ? scrubPromptContextText(bead.status) : null,
    labels: (bead.labels ?? []).map(scrubPromptContextText).slice(0, 8),
    workspaceId: bead.workspaceId ? scrubPromptContextText(bead.workspaceId) : null,
  };
}

function uniqueClean(values: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const raw of values) {
    const value = raw.trim();
    if (!value || seen.has(value)) continue;
    seen.add(value);
    result.push(value);
  }
  return result;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function scrubPromptContextText(value: string): string {
  return value
    .replace(/\/Users\/[^\s]+/gu, '[redacted-home]')
    .replace(/\bbd\s+[^\n]*/giu, 'bead detail command')
    .replace(/\bshell\b/giu, 'workflow action')
    .replace(/\bgit\s+[^\n]*/giu, 'version control action')
    .replace(/\bwebhook\b/giu, 'workflow update')
    .replace(/\bqueue[-_ ]?item\b/giu, 'workflow item')
    .slice(0, 500);
}
