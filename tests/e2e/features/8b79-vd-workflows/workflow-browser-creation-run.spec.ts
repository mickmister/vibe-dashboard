/**
 * Covers:
 * - test-plans/branches/8b79-vd-workflows/test-plan-11.md
 * - TEST_CASE_M120C_1A
 * - TEST_CASE_M120C_1B
 * - TEST_CASE_M120C_1C
 * - TEST_CASE_M120C_1D
 *
 * This browser E2E creates and publishes the workflow through the UI, then
 * launches it through the UI and lets VK qa-mode complete the agent decision at
 * the real queued-turn/message boundary. It does not seed the workflow
 * definition and it does not call runtime completion helpers.
 */
import { promises as fs } from "node:fs";
import { expect, test, type APIRequestContext, type TestInfo } from "playwright/test";

const sandboxUrl = process.env.VK_MOCKED_SANDBOX_URL ?? "http://127.0.0.1:50005";
const requiredScriptFile = "qa-scripted-lv2k-workflows.json";
const promptMarker = "LV2K_STEP:m120c_browser_create";
const finalSummary = "Browser-created workflow completed through VK qa-mode.";
const forbiddenTerms = [
  "webhook",
  "HMAC",
  "queue item",
  "trigger",
  "delivery ID",
  "execution process ID",
  "runReady",
  "raw JSON",
  "raw XML",
  "WorkflowStepState",
  "bd show",
  "shell command",
  "/Users/",
];

type Workspace = { id: string; name?: string | null };
type Presentation = {
  status: string;
  workflowName: string;
  originalTask?: string | null;
  provenance?: { workflowVersion?: number | null; roles?: Array<{ executorType?: string | null; model?: string | null }> } | null;
  timeline: Array<{ initialMessage: { text: string } | null; finalResponse: { text: string } | null }>;
  outputs?: Array<{ value: string }> | null;
};

test.describe("M120C browser workflow creation and run", () => {
  test.skip(
    !process.env.VK_QA_SCRIPTED_OUTCOME_FILE?.includes(requiredScriptFile),
    `M120C browser creation E2E requires VK_QA_SCRIPTED_OUTCOME_FILE pointing at ${requiredScriptFile}.`,
  );

  test("TEST_CASE_M120C_1A-D creates, publishes, launches, and verifies a browser-created workflow", async ({ page, request }, testInfo) => {
    test.setTimeout(600_000);

    await expectDashboardHealth(request);
    await expectProvisionedWebhook(request);
    const workspace = await firstWorkspace(request);
    const unique = Date.now();
    const workflowName = `M120C Browser Workflow ${unique}`;
    const task = `Run M120C browser-created workflow ${unique}`;
    const sessionName = `M120C Implementer ${unique}`;

    await page.goto(`/dashboard/workflows?workspaceId=${encodeURIComponent(workspace.id)}`);
    await expect(page.getByRole("heading", { name: "Workflows", exact: true })).toBeVisible();
    await page.locator(`a[href="/dashboard/workflows/new?workspaceId=${encodeURIComponent(workspace.id)}"]`).click();

    await expect(page.getByRole("heading", { name: "Create workflow" })).toBeVisible();
    await page.getByLabel("Starter template").selectOption("built-in/simple-agent-decision");
    await page.getByLabel("Workflow name").fill(workflowName);
    await page.getByLabel("Purpose").fill("Browser E2E creates, publishes, launches, and verifies this workflow from a starter template copy.");
    const graphPreview = page.locator("aside").filter({ hasText: "Review graph" });
    await expect(graphPreview.getByText("This will create a copy from the selected starter template.")).toBeVisible();
    await expect(graphPreview.getByText("The copied workflow keeps the selected workflow structure.")).toBeVisible();

    await page.getByRole("button", { name: "Save & publish" }).click();
    await expect(page.getByLabel("Wizard result")).toContainText("Published v1");
    await page.locator(`a[href="/dashboard/workflows?workspaceId=${encodeURIComponent(workspace.id)}"]`, { hasText: "Run from Workflows tab" }).click();

    const workflowCard = page.locator("article").filter({ hasText: workflowName }).first();
    await expect(workflowCard).toBeVisible({ timeout: 60_000 });
    await expect(workflowCard).toContainText("Published v1");
    await workflowCard.getByRole("button", { name: "Run", exact: true }).click();

    const dialog = page.getByRole("dialog", { name: `Run ${workflowName}` });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText("Run workflow")).toBeVisible();
    await expect(dialog.getByLabel("Launch summary")).toContainText(`${workflowName} · Published v1`);
    await expect(dialog.getByLabel("Implementer executor")).toHaveValue("");
    await expect(dialog.getByLabel("Implementer model")).toHaveValue("");
    await expect(dialog.getByText("Workspace default").first()).toBeVisible();
    await dialog.getByRole("button", { name: "Create sessions for all roles" }).click();
    await dialog.getByLabel("Implementer session name").fill(sessionName);
    await dialog.getByLabel("featureRequest *").fill(task);
    await dialog.getByLabel("Additional instructions for this run").fill(`M120C browser creation E2E uses VK qa-mode scripted XML. ${promptMarker}`);

    const launchRequestPromise = page.waitForRequest((browserRequest) => browserRequest.url().endsWith("/dashboard/api/workflows/launch") && browserRequest.method() === "POST");
    const launchResponsePromise = page.waitForResponse((response) => response.url().endsWith("/dashboard/api/workflows/launch") && response.request().method() === "POST");
    await dialog.getByRole("button", { name: "Launch workflow" }).click();
    const [launchRequest, launchResponse] = await Promise.all([launchRequestPromise, launchResponsePromise]);
    const launchPayload = JSON.parse(launchRequest.postData() ?? "{}") as { roleBindings?: Record<string, Record<string, unknown>> };
    expect(launchPayload.roleBindings?.implementer).toMatchObject({ mode: "create_or_reuse", name: sessionName });
    expect(launchPayload.roleBindings?.implementer).not.toHaveProperty("executorType");
    expect(launchPayload.roleBindings?.implementer).not.toHaveProperty("model");
    const launchBody = await launchResponse.json() as { run?: { runId?: string; detailUrl?: string } };
    expect(launchResponse.status(), JSON.stringify(launchBody)).toBe(201);
    const runId = launchBody.run?.runId;
    expect(runId).toBeTruthy();

    await expect(dialog.getByLabel("Launch result")).toContainText("Workflow launched");
    await dialog.locator(`a[href="/dashboard/workflows/${runId}"]`, { hasText: "Open run page" }).click();

    const presentation = await waitForPresentationCompleted(request, runId!, testInfo);
    expect(presentation.workflowName).toBe(workflowName);
    expect(presentation.originalTask).toBe(task);
    expect(presentation.provenance).toMatchObject({ workflowVersion: 1 });
    const presentationJson = JSON.stringify(presentation);
    expect(presentationJson).toContain(promptMarker);
    expect(presentationJson).toContain(finalSummary);
    for (const forbidden of forbiddenTerms) expect(presentationJson).not.toContain(forbidden);

    await page.reload();
    await expect(page.getByRole("heading", { name: workflowName })).toBeVisible();
    await expect(page.getByLabel("Run summary")).toContainText("Complete");
    await expect(page.getByRole("heading", { name: "Timeline" })).toBeVisible();
    await expect(page.getByText(finalSummary).first()).toBeVisible();
    for (const term of forbiddenTerms) {
      await expect(page.getByText(term, { exact: false })).toHaveCount(0);
    }

    await attachJson(testInfo, "m120c-browser-created-workflow", {
      workflowName,
      workspaceId: workspace.id,
      runId,
      status: presentation.status,
      promptMarker,
      launchRoleBindings: launchPayload.roleBindings,
      usedDbSeeding: false,
      usedDirectRuntimeCompletion: false,
    });
  });
});

function url(path: string) {
  return new URL(path, sandboxUrl).toString();
}

async function expectDashboardHealth(request: APIRequestContext) {
  await expect.poll(async () => {
    const response = await request.get(url("/dashboard/api/workflows/health"));
    if (!response.ok()) return null;
    return await response.json().catch(() => null) as { ok?: boolean } | null;
  }, { timeout: 120_000, message: "dashboard workflow health should return JSON" }).toEqual({ ok: true });
}

async function expectProvisionedWebhook(request: APIRequestContext) {
  await expect.poll(async () => {
    const response = await request.get(url("/dashboard/api/workflow-webhooks/provisioning"));
    if (!response.ok()) return null;
    const body = await response.json().catch(() => null) as { state?: { status?: string } | null } | null;
    return body?.state?.status ?? null;
  }, { timeout: 60_000, intervals: [1_000, 2_000, 5_000], message: "VD should self-provision VK terminal execution webhook before browser launch" }).toBe("provisioned");
}

async function firstWorkspace(request: APIRequestContext): Promise<Workspace> {
  let workspace: Workspace | null = null;
  await expect.poll(async () => {
    const response = await request.get(url("/vk-api/workspaces"));
    if (!response.ok()) return null;
    const body = await response.json() as { data?: Workspace[] };
    workspace = body.data?.[0] ?? null;
    return workspace?.id ?? null;
  }, { timeout: 600_000, intervals: [1_000, 2_000, 5_000], message: "seeded VK workspace should become available" }).not.toBeNull();
  if (!workspace) throw new Error("Expected seeded VK workspace in qa-mode sandbox");
  return workspace;
}

async function waitForPresentationCompleted(request: APIRequestContext, runId: string, testInfo: TestInfo): Promise<Presentation> {
  let last: Presentation | null = null;
  try {
    await expect.poll(async () => {
      const response = await request.get(url(`/dashboard/api/workflow-instances/${encodeURIComponent(runId)}/presentation`));
      if (!response.ok()) return null;
      const body = await response.json() as { presentation: Presentation };
      last = body.presentation;
      return last.status;
    }, { timeout: 240_000, intervals: [1_000, 2_000, 5_000], message: "browser-created workflow should complete from qa-mode VK XML message" }).toBe("completed");
    return last!;
  } finally {
    await attachJson(testInfo, "m120c-last-presentation", last);
  }
}

async function attachJson(testInfo: TestInfo, name: string, value: unknown) {
  const path = testInfo.outputPath(`${name}.json`);
  await fs.writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await testInfo.attach(name, { path, contentType: "application/json" });
}
