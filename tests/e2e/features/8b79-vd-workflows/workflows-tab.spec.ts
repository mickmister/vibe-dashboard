/**
 * Covers:
 * - test-plans/branches/8b79-vd-workflows/test-plan-3.md
 * - TEST_CASE_M94_1A
 * - TEST_CASE_M94_1B
 * - TEST_CASE_M95_1A
 * - TEST_CASE_M95_1B
 * - TEST_CASE_M97_1A
 * - TEST_CASE_M97_1B
 * - TEST_CASE_M98_1A
 * - TEST_CASE_M98_2A
 * - TEST_CASE_M100_1A
 * - TEST_CASE_M105_1A
 * - TEST_CASE_M105_1D
 * - TEST_CASE_M105_1F
 * - TEST_CASE_M106_1A
 * - TEST_CASE_M106_1B
 * - TEST_CASE_M106_1C
 * - TEST_CASE_M106_1D
 * - TEST_CASE_M106_1E
 * - TEST_CASE_M107_1A
 * - TEST_CASE_M107_1C
 * - TEST_CASE_M107_1E
 * - TEST_CASE_M107_1F
 * - TEST_CASE_M108_1A
 * - TEST_CASE_M108_1B
 * - TEST_CASE_M108_1C
 * - TEST_CASE_M108_1D
 * - TEST_CASE_M108_1E
 * - TEST_CASE_M109_1A
 * - TEST_CASE_M109_1B
 * - TEST_CASE_M120C_1D
 */
import { expect, test } from "playwright/test";

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
];
const workflow = {
  id: "design-dev-review-tester",
  title: "Dev Review Tester",
  description: "Feature work loop",
  source: "published_design",
  status: "ready",
  version: 1,
  unavailableReason: null,
  canRun: true,
  inputs: [
    {
      id: "featureRequest",
      type: "markdown",
      required: true,
      description: null,
    },
  ],
  roles: [
    { id: "dev", label: "Dev", description: null },
    { id: "review", label: "Review", description: null },
  ],
  launchSummary: {
    firstStateId: "dev",
    firstActorRoleId: "dev",
    firstActorLabel: "Dev",
    mayNeedHumanInput: true,
    mayCallWorkflows: false,
  },
};

test.describe("Workspace Workflows tab shell", () => {
  test("renders the workspace Workflows tab as an in-process React craft surface", async ({
    page,
  }) => {
    await page.route("**/dashboard/api/workflows/home?**", async (route) => {
      const url = new URL(route.request().url());
      expect(url.searchParams.get("workspaceId")).toBeTruthy();
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({ home: homeFixture(false) }),
      });
    });

    await page.goto(
      "/?voyage=basic-seeded-voyage-4227c394d0d7&craft=basic-seeded-vk-craft-12-12&views=workflows-workflows",
    );

    await expect(
      page.getByTestId("react-craft-surface:vibe-dashboard/workflows"),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Workflows", exact: true }),
    ).toBeVisible();
    await expect(page.locator('iframe[title="Workflows"]')).toHaveCount(0);
  });

  test("shows workspace-scoped workflows home without debug terms", async ({
    page,
  }) => {
    await page.route("**/dashboard/api/workflows/home?**", async (route) => {
      const url = new URL(route.request().url());
      expect(url.searchParams.get("workspaceId")).toBe("workspace-e2e");
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({ home: homeFixture(false) }),
      });
    });

    await page.goto("/dashboard/workflows?workspaceId=workspace-e2e");

    await expect(page.getByTestId("standalone-dashboard-page")).toHaveClass(
      /h-screen/,
    );
    await expect(page.getByTestId("standalone-dashboard-page")).toHaveClass(
      /overflow-y-auto/,
    );
    await expect(
      page.getByRole("heading", { name: "Workflows", exact: true }),
    ).toBeVisible();
    await expect(page.getByText("Workspace workflow center")).toBeVisible();
    await expect(
      page.locator('a[href="/dashboard/workflows/roadmap"]'),
    ).toBeVisible();
    await expect(page.getByText("Create, run, and monitor workflows for")).toBeVisible();
    await expect(page.getByLabel("Workflow dashboard summary")).toContainText("Needs input");
    await expect(page.getByLabel("Workflow dashboard summary")).toContainText("Active runs");
    await expect(
      page.getByRole("heading", { name: "Active runs" }),
    ).toBeVisible();
    await expect(
      page.getByText("Running now. Open the run page to see who has the next step."),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Your workflows" }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Starter templates" }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Recent runs" }),
    ).toBeVisible();
    await expect(page.getByText("Dev Review Tester")).toBeVisible();
    await expect(page.getByText("Dev / Review / Tester")).toBeVisible();
    await expect(page.getByText("Create form from agent")).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Run", exact: true }),
    ).toBeVisible();
    await expect(
      page
        .locator("article")
        .filter({ hasText: "Dev / Review / Tester" })
        .getByRole("button", { name: "Create copy" }),
    ).toBeVisible();
    await expect(
      page
        .locator("article")
        .filter({ hasText: "Dev / Review / Tester" })
        .getByRole("button", { name: "Run", exact: true }),
    ).toHaveCount(0);
    await expect(
      page.locator('a[href="/dashboard/workflows/legacy-clean"]'),
    ).toBeVisible();
    await expect(page.getByText("Answer planning questions")).toBeVisible();
    await expect(
      page.getByText("The workflow resumes after you submit the requested input."),
    ).toBeVisible();
    await expect(
      page.locator('a[href="/dashboard/workflows/run-clean"]'),
    ).toHaveCount(0);
    for (const term of forbiddenTerms) {
      await expect(page.getByText(term, { exact: false })).toHaveCount(0);
    }
  });

  test("shows read-only workflow roadmap route", async ({ page }) => {
    await page.route("**/dashboard/api/workflows/roadmap", async (route) => {
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          roadmap: {
            spikeId: "vk/8b79-vd-workflows",
            title: "Workflow builder and automation spike",
            description: "Read-only workflow milestone progress.",
            generatedAt: 1_700_000,
            statusCounts: { complete: 1, in_progress: 1, blocked: 0, review: 1, tester: 0, remaining: 1 },
            nextAction: "Finish CKOV implementation and send to review.",
            stale: false,
            source: {
              label: "Checked-in workflow roadmap",
              description: "Typed milestone data for this spike.",
            },
            milestones: [
              {
                beadId: "vibe-kanban-vscode-web-ehl",
                milestone: "M90",
                title: "Workflow design store",
                status: "complete",
                priority: "P2",
                summary: "Designs and versions are in place.",
                reviewState: "passed",
                nextAction: null,
                dependencies: [],
                links: [{ label: "Open bead", href: "/beads/project?bead=vibe-kanban-vscode-web-ehl", kind: "bead" }],
                children: [],
              },
              {
                beadId: "vibe-kanban-vscode-web-ckov",
                milestone: "CKOV",
                title: "Workflow roadmap and multi-bead progress UI",
                status: "in_progress",
                priority: "P2",
                summary: "Roadmap UI is being implemented.",
                reviewState: "implementation",
                nextAction: "Finish CKOV implementation and send to review.",
                dependencies: ["SEBL"],
                links: [{ label: "Open bead", href: "/beads/project?bead=vibe-kanban-vscode-web-ckov", kind: "bead" }],
                children: [
                  {
                    beadId: "vibe-kanban-vscode-web-ckov-readmodel",
                    title: "Typed roadmap read model",
                    status: "in_progress",
                    summary: "Expose milestone progress as product data.",
                    nextAction: "Finish tests.",
                    links: [{ label: "Open bead", href: "/beads/project?bead=vibe-kanban-vscode-web-ckov-readmodel", kind: "bead" }],
                  },
                ],
              },
            ],
          },
        }),
      });
    });

    await page.goto("/dashboard/workflows/roadmap");

    await expect(page.getByRole("heading", { name: "Workflow builder and automation spike" })).toBeVisible();
    await expect(page.getByLabel("Roadmap status summary")).toContainText("Complete");
    await expect(page.getByLabel("Roadmap status summary")).toContainText("In progress");
    await expect(page.getByText("Workflow roadmap and multi-bead progress UI")).toBeVisible();
    await expect(page.getByText("Typed roadmap read model")).toBeVisible();
    await expect(page.locator('a[href="/beads/project?bead=vibe-kanban-vscode-web-ckov"]')).toBeVisible();
    for (const term of forbiddenTerms) {
      await expect(page.getByText(term, { exact: false })).toHaveCount(0);
    }
  });

  test("shows meta-workflow browser create and monitor route", async ({ page }) => {
    await page.route("**/dashboard/api/workflows/home?**", async (route) => {
      const home = homeFixture(false);
      await route.fulfill({ contentType: "application/json", body: JSON.stringify({ home }) });
    });
    await page.route("**/dashboard/api/workflows/meta-beads?**", async (route) => {
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          unavailableReason: null,
          beads: [
            { beadId: "A", title: "A title", status: "open", workspaceId: "workspace-a", accessible: true, labels: ["workflow"], url: "/beads/project?bead=A" },
            { beadId: "B", title: "B title", status: "open", workspaceId: null, accessible: true, labels: [], url: "/beads/project?bead=B" },
          ],
        }),
      });
    });
    await page.route("**/dashboard/api/workflows/meta-runs?**", async (route) => {
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({ metaRuns: [metaRunFixture()] }),
      });
    });

    await page.goto("/dashboard/workflows/meta-runs?workspaceId=workspace-a");

    await expect(page.getByRole("heading", { name: "Meta-workflows" })).toBeVisible();
    await expect(page.getByLabel("Bead filter")).toBeVisible();
    await expect(page.getByText("Current workspace parent beads")).toBeVisible();
    await expect(page.getByText("A title")).toBeVisible();
    await expect(page.getByText("Selected bead order")).toBeVisible();
    await expect(page.getByLabel("Child workflow")).toBeVisible();
    await expect(page.getByText("Monitor meta-workflows")).toBeVisible();
    await expect(page.getByText("Waiting for B to complete before starting the next bead.")).toBeVisible();
    await expect(page.locator('a[href="/dashboard/workflows/child-b"]')).toBeVisible();
    for (const term of forbiddenTerms) {
      await expect(page.getByText(term, { exact: false })).toHaveCount(0);
    }
  });

  test("launches a workflow with required input validation and runtime session binding", async ({
    page,
  }) => {
    let launched = false;
    await page.route("**/dashboard/api/workflows/home?**", async (route) => {
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({ home: homeFixture(launched) }),
      });
    });
    await page.route(
      "**/dashboard/api/workflows/launch-options?**",
      async (route) => {
        const url = new URL(route.request().url());
        expect(url.searchParams.get("workspaceId")).toBe("workspace-e2e");
        expect(url.searchParams.get("designId")).toBe(
          "design-dev-review-tester",
        );
        await route.fulfill({
          contentType: "application/json",
          body: JSON.stringify({
            options: {
              workspaceId: "workspace-e2e",
              workflow,
              sessions: [
                {
                  sessionId: "session-dev",
                  name: "Dev session",
                  executor: "CODEX",
                  workspaceId: "workspace-e2e",
                },
                {
                  sessionId: "session-review",
                  name: "Review session",
                  executor: "CODEX",
                  workspaceId: "workspace-e2e",
                },
              ],
            },
          }),
        });
      },
    );
    await page.route("**/dashboard/api/workflows/launch", async (route) => {
      const body = route.request().postDataJSON();
      expect(body).toMatchObject({
        workspaceId: "workspace-e2e",
        designId: "design-dev-review-tester",
        inputs: { featureRequest: "Build a clean launch flow" },
        additionalInstructions: "Keep this run small.",
        roleBindings: {
          dev: { mode: "create_or_reuse", name: "Dev" },
          review: { mode: "create_or_reuse", name: "Review" },
        },
      });
      expect(body.roleBindings.dev).not.toHaveProperty("executorType");
      expect(body.roleBindings.dev).not.toHaveProperty("model");
      expect(body.roleBindings.review).not.toHaveProperty("executorType");
      expect(body.roleBindings.review).not.toHaveProperty("model");
      launched = true;
      await route.fulfill({
        contentType: "application/json",
        status: 201,
        body: JSON.stringify({
          run: {
            runId: "run-launched",
            workspaceId: "workspace-e2e",
            status: "running",
            detailUrl: "/dashboard/workflows/run-launched",
          },
          home: homeFixture(true),
        }),
      });
    });

    await page.goto("/dashboard/workflows?workspaceId=workspace-e2e");
    await page.getByRole("button", { name: "Run", exact: true }).click();
    await expect(page.getByLabel("Launch summary")).toContainText(
      "Dev Review Tester · Published v1",
    );
    await expect(page.getByLabel("Launch summary")).toContainText(
      "featureRequest",
    );
    await expect(page.getByLabel("Launch summary")).toContainText("Dev in dev");
    await expect(page.getByLabel("Launch summary")).toContainText(
      "This workflow may ask you for input.",
    );
    await expect(
      page.getByText(
        "Applies only to this run. It will not change the workflow design or future runs.",
      ),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Create sessions for all roles" })
      .click();
    await page.getByRole("button", { name: "Launch workflow" }).click();
    await expect(page.getByText("This field is required.")).toBeVisible();
    await page.getByLabel("featureRequest *").fill("Build a clean launch flow");
    await page
      .getByLabel("Additional instructions for this run")
      .fill("Keep this run small.");
    await page.getByRole("button", { name: "Launch workflow" }).click();

    await expect(page.getByLabel("Launch result")).toContainText(
      "Workflow launched",
    );
    await expect(
      page.locator('a[href="/dashboard/workflows/run-launched"]', {
        hasText: "Open run page",
      }),
    ).toBeVisible();
    for (const term of forbiddenTerms) {
      await expect(page.getByText(term, { exact: false })).toHaveCount(0);
    }
  });

  test("renders clean run monitoring story without transport details", async ({
    page,
  }) => {
    await page.route(
      "**/dashboard/api/workflow-instances/run-story/presentation",
      async (route) => {
        await route.fulfill({
          contentType: "application/json",
          body: JSON.stringify({ presentation: runStoryFixture() }),
        });
      },
    );

    await page.goto("/dashboard/workflows/run-story");

    await expect(
      page.getByRole("heading", { name: "Dev Review Tester run" }),
    ).toBeVisible();
    await expect(page.getByLabel("Automation provenance")).toContainText(
      "Dev Review Tester run workflow v1",
    );
    await expect(page.getByLabel("Run summary")).toContainText("In progress");
    await expect(page.getByLabel("Run summary")).toContainText("Reviewer");
    await expect(page.getByLabel("Run summary")).toContainText(
      "Waiting for Review response.",
    );
    await expect(page.getByLabel("Run summary")).toContainText(
      "The workflow resumes when the child workflow completes.",
    );
    await expect(page.getByRole("heading", { name: "Timeline" })).toBeVisible();
    await expect(page.getByText("Loop")).toBeVisible();
    await expect(page.getByText("Reviewer asked for changes.")).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Child workflows" }),
    ).toBeVisible();
    await expect(
      page.locator('a[href="/dashboard/workflows/child-run"]', {
        hasText: "Open child run",
      }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Outputs and artifacts" }),
    ).toBeVisible();
    await expect(
      page.getByText("workflow-run://child-run/output"),
    ).toBeVisible();
    for (const term of forbiddenTerms) {
      await expect(page.getByText(term, { exact: false })).toHaveCount(0);
    }
  });

  test("queues a batch run and shows per-item errors", async ({ page }) => {
    let batchQueued = false;
    await page.route("**/dashboard/api/workflows/home?**", async (route) => {
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({ home: homeFixture(false, false, batchQueued) }),
      });
    });
    await page.route(
      "**/dashboard/api/workflows/launch-options?**",
      async (route) => {
        const url = new URL(route.request().url());
        expect(url.searchParams.get("workspaceId")).toBe("workspace-e2e");
        expect(url.searchParams.get("designId")).toBe(
          "design-dev-review-tester",
        );
        await route.fulfill({
          contentType: "application/json",
          body: JSON.stringify({
            options: {
              workspaceId: "workspace-e2e",
              workflow,
              sessions: [
                {
                  sessionId: "session-dev",
                  name: "Dev session",
                  executor: "CODEX",
                  workspaceId: "workspace-e2e",
                },
              ],
            },
          }),
        });
      },
    );
    await page.route("**/dashboard/api/workflows/batches", async (route) => {
      const body = route.request().postDataJSON();
      expect(body).toMatchObject({
        workspaceId: "workspace-e2e",
        designId: "design-dev-review-tester",
        items: [{ inputs: { featureRequest: "One" } }, { inputs: {} }],
        roleBindings: {
          dev: { mode: "existing", sessionId: "session-dev" },
          review: { mode: "existing", sessionId: "session-dev" },
        },
      });
      batchQueued = true;
      const home = homeFixture(false, false, true);
      await route.fulfill({
        contentType: "application/json",
        status: 201,
        body: JSON.stringify({ batch: home.recentBatches[0], home }),
      });
    });

    await page.goto("/dashboard/workflows?workspaceId=workspace-e2e");
    await page
      .locator("article")
      .filter({ hasText: "Dev Review Tester" })
      .getByRole("button", { name: "Batch run" })
      .click();
    await expect(
      page.getByRole("dialog", { name: "Batch run Dev Review Tester" }),
    ).toBeVisible();
    await page
      .getByLabel("Batch items")
      .fill('{\"featureRequest\":\"One\"}\n{}');
    await page.getByLabel("Batch session").selectOption("session-dev");
    await page.getByRole("button", { name: "Queue batch" }).click();

    await expect(
      page.getByText("1 complete · 1 running · 1 pending · 1 errors"),
    ).toBeVisible();
    await page.getByText("Batch item details").click();
    await expect(page.getByText("Line 2")).toBeVisible();
    await expect(
      page.getByText("Batch item 2 is missing required workflow fields."),
    ).toBeVisible();
    await expect(
      page.getByText("featureRequest: This field is required."),
    ).toBeVisible();
    await expect(
      page.locator('a[href="/dashboard/workflow-batches/batch-e2e"]', {
        hasText: "Open batch details",
      }),
    ).toBeVisible();
    for (const term of forbiddenTerms) {
      await expect(page.getByText(term, { exact: false })).toHaveCount(0);
    }
  });

  test("renders workflow batch detail with filters, run links, errors, and capacity explanation", async ({
    page,
  }) => {
    await page.route(
      "**/dashboard/api/workflows/batches/batch-e2e",
      async (route) => {
        await route.fulfill({
          contentType: "application/json",
          body: JSON.stringify({ batch: batchDetailFixture() }),
        });
      },
    );

    await page.goto("/dashboard/workflow-batches/batch-e2e");
    await expect(
      page.getByRole("heading", { name: "Dev Review Tester" }),
    ).toBeVisible();
    await expect(
      page.getByText("1 complete · 1 running · 1 pending · 1 failed/blocked"),
    ).toBeVisible();
    await expect(page.getByText("Workspace active runs")).toBeVisible();
    await expect(
      page.getByText(
        "Pending items are waiting because this workspace already has 1 active run",
      ),
    ).toBeVisible();
    await expect(page.getByText("Line 1")).toBeVisible();
    await expect(
      page.locator('a[href="/dashboard/workflows/run-batch-0"]', {
        hasText: "Open run",
      }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Failed/blocked" }).click();
    await expect(page.getByText("Line 2")).toBeVisible();
    await expect(
      page.getByText("Batch item 2 is missing required workflow fields."),
    ).toBeVisible();
    await expect(
      page.getByText("featureRequest: This field is required."),
    ).toBeVisible();
    await expect(page.getByText("Line 1")).toHaveCount(0);
    await page.getByRole("button", { name: "Pending" }).click();
    await expect(page.getByText("Line 4")).toBeVisible();
    await expect(
      page.getByText(
        "This item will start when workspace capacity is available.",
      ),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: "Retry" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Cancel" })).toHaveCount(0);
    for (const term of forbiddenTerms) {
      await expect(page.getByText(term, { exact: false })).toHaveCount(0);
    }
  });

  test("creates and publishes a simple workflow through the wizard", async ({
    page,
  }) => {
    await page.route("**/dashboard/api/workflows/home?**", async (route) => {
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({ home: homeFixture(false) }),
      });
    });
    await page.route("**/dashboard/api/workflow-designs", async (route) => {
      const body = route.request().postDataJSON();
      expect(body).toMatchObject({
        workspaceId: "workspace-e2e",
        name: "Wizard Smoke Workflow",
        publish: true,
      });
      expect(body.definition.states.work.steps[0].type).toBe("agent_turn");
      expect(JSON.stringify(body.definition)).not.toContain("fire_and_forget");
      await route.fulfill({
        contentType: "application/json",
        status: 201,
        body: JSON.stringify({
          design: {
            designId: "design-wizard-smoke",
            name: "Wizard Smoke Workflow",
            latestPublishedVersion: 1,
          },
          draft: {
            draftId: "draft-wizard-smoke",
            designId: "design-wizard-smoke",
          },
          version: { designId: "design-wizard-smoke", version: 1 },
          editor: {
            designId: "design-wizard-smoke",
            name: "Wizard Smoke Workflow",
            description: null,
            draftId: "draft-wizard-smoke",
            version: 1,
            readonly: false,
            definition: body.definition,
            validationStatus: "valid",
            validationIssues: [],
          },
        }),
      });
    });

    await page.goto("/dashboard/workflows?workspaceId=workspace-e2e");
    await page
      .locator('a[href="/dashboard/workflows/new?workspaceId=workspace-e2e"]')
      .click();
    await expect(
      page.getByRole("heading", { name: "Create workflow" }),
    ).toBeVisible();
    await expect(page.getByText("Blank simple workflow")).toBeVisible();
    await expect(page.getByText("Review graph")).toBeVisible();
    await page.getByLabel("Workflow name").fill("Wizard Smoke Workflow");
    await page
      .getByLabel("Purpose")
      .fill("Create a simple workflow through the wizard.");
    const graphPreview = page
      .locator("aside")
      .filter({ hasText: "Review graph" });
    await expect(
      graphPreview.getByText("work → done: Done", { exact: true }),
    ).toBeVisible();
    await expect(
      graphPreview.getByText("work → work: Continue working", { exact: true }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Save & publish" }).click();
    await expect(page.getByLabel("Wizard result")).toContainText(
      "Published v1",
    );
    await expect(
      page.locator(
        'a[href="/dashboard/workflows/editor/design-wizard-smoke"]',
        { hasText: "Open graph editor" },
      ),
    ).toBeVisible();
    await expect(
      page.locator('a[href="/dashboard/workflows?workspaceId=workspace-e2e"]', {
        hasText: "Run from Workflows tab",
      }),
    ).toBeVisible();
    for (const term of forbiddenTerms) {
      await expect(page.getByText(term, { exact: false })).toHaveCount(0);
    }
  });

  test("uses built-in Dev Review Tester and Create form templates as real designs", async ({
    page,
  }) => {
    let used = false;
    await page.route("**/dashboard/api/workflows/home?**", async (route) => {
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({ home: homeFixture(false, used) }),
      });
    });
    await page.route(
      "**/dashboard/api/workflow-templates/built-in%2Fdev-review-tester/use",
      async (route) => {
        const body = route.request().postDataJSON();
        expect(body).toMatchObject({
          workspaceId: "workspace-e2e",
          publish: true,
        });
        used = true;
        await route.fulfill({
          contentType: "application/json",
          status: 201,
          body: JSON.stringify({
            design: {
              designId: "design-drt-used",
              name: "Dev / Review / Tester",
              latestPublishedVersion: 1,
            },
            draft: { draftId: "draft-drt-used", designId: "design-drt-used" },
            version: { designId: "design-drt-used", version: 1 },
            home: homeFixture(false, true),
          }),
        });
      },
    );

    await page.goto("/dashboard/workflows?workspaceId=workspace-e2e");
    await expect(page.getByText("Dev / Review / Tester")).toBeVisible();
    await expect(page.getByText("Create form from agent")).toBeVisible();
    await page
      .locator("article")
      .filter({ hasText: "Dev / Review / Tester" })
      .getByRole("button", { name: "Create copy" })
      .click();
    await expect(
      page.locator('a[href="/dashboard/workflows/editor/design-drt-used"]'),
    ).toBeVisible();
    await expect(
      page
        .locator("article")
        .filter({ hasText: "Dev / Review / Tester" })
        .getByRole("button", { name: "Run", exact: true }),
    ).toBeVisible();
    await expect(
      page
        .locator("article")
        .filter({ hasText: "Create form from agent" })
        .getByRole("button", { name: "Create copy" }),
    ).toBeVisible();
  });

  test("renders workflow graph and validates transition edits before save", async ({
    page,
  }) => {
    let savedDefinition: any = null;
    let published = false;
    await page.route(
      "**/dashboard/api/workflow-designs/design-dev-review-tester/editor",
      async (route) => {
        await route.fulfill({
          contentType: "application/json",
          body: JSON.stringify({
            editor: editorFixture(savedDefinition ?? graphDefinition()),
          }),
        });
      },
    );
    await page.route("**/dashboard/api/workflow-assets", async (route) => {
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          prompts: [
            {
              kind: "prompt",
              id: "prompt.dev.implement",
              version: 1,
              name: "Old implement prompt",
              description: "Existing prompt ref",
              source: "built_in",
              preview: "Implement feature",
            },
            {
              kind: "prompt",
              id: "prompt.drt.dev.implement",
              version: 1,
              name: "DRT implement prompt",
              description: "Materialized starter prompt",
              source: "built_in",
              preview: "Implement the requested feature",
            },
          ],
          skills: [
            {
              kind: "skill",
              id: "skill.testing.notes",
              version: 1,
              name: "Testing notes",
              description: "Markdown skill snippet",
              source: "user",
              preview: "Write focused tests.",
            },
          ],
        }),
      });
    });
    await page.route(
      "**/dashboard/api/workflow-design-drafts/draft-dev-review-tester",
      async (route) => {
        const body = route.request().postDataJSON();
        savedDefinition = body.definition;
        expect(savedDefinition.states.dev.actions.ready_for_review.label).toBe(
          "Proceed to review",
        );
        expect(
          savedDefinition.states.dev.actions.ready_for_review.targetState,
        ).toBe("review");
        expect(savedDefinition.name).toBe("Dev Review Tester Copy");
        expect(savedDefinition.roles.dev.label).toBe("Implementer");
        expect(
          savedDefinition.states.dev.steps[0].prompt.refs[0],
        ).toMatchObject({
          kind: "prompt",
          id: "prompt.drt.dev.implement",
          version: 1,
        });
        await route.fulfill({
          contentType: "application/json",
          body: JSON.stringify({ editor: editorFixture(savedDefinition) }),
        });
      },
    );

    await page.route(
      "**/dashboard/api/workflow-design-drafts/draft-dev-review-tester/publish",
      async (route) => {
        published = true;
        await route.fulfill({
          contentType: "application/json",
          body: JSON.stringify({
            editor: editorFixture(savedDefinition ?? graphDefinition()),
          }),
        });
      },
    );

    await page.goto("/dashboard/workflows/editor/design-dev-review-tester");

    await expect(
      page.getByRole("heading", { name: "Dev Review Tester" }),
    ).toBeVisible();
    await expect(page.getByTestId("standalone-dashboard-page")).toHaveClass(
      /h-screen/,
    );
    await expect(page.getByTestId("standalone-dashboard-page")).toHaveClass(
      /overflow-y-auto/,
    );
    await expect(page.getByText("Graph preview is collapsed.")).toBeVisible();
    await expect(page.getByTestId("workflow-react-flow-canvas")).toHaveCount(0);
    await page.getByRole("button", { name: "Show graph" }).click();
    await expect(page.getByTestId("workflow-react-flow-canvas")).toBeVisible();
    await expect(page.getByText(/Role dev:/)).toBeVisible();
    await expect(
      page.locator(".react-flow__node.workflow-state-node").first(),
    ).toHaveCSS("background-color", "rgb(15, 23, 42)");
    await expect(
      page.locator(".react-flow__node.workflow-terminal-node"),
    ).toHaveCSS("background-color", "rgb(5, 46, 43)");
    await expect(
      page.locator(".react-flow__edge.workflow-loop-edge"),
    ).toHaveCount(1);
    const details = page.locator("aside");
    await details.getByRole("button", { name: /Dev dev · 1 state/ }).click();
    await details.getByRole("button", { name: /Dev dev/ }).click();
    await expect(details.getByText("Owner role")).toBeVisible();
    await expect(
      details.getByRole("heading", { name: "Dev", exact: true }),
    ).toBeVisible();
    await expect(details.getByText("implement", { exact: true })).toBeVisible();
    await expect(
      details.getByText("self_review", { exact: true }),
    ).toBeVisible();
    await details.getByRole("button", { name: "Edit state" }).click();
    const implementPicker = details.locator(
      'section[aria-label="implement prompt and skill picker"]',
    );
    await expect(
      implementPicker.getByRole("heading", {
        name: "Prompt and skill snippets",
      }),
    ).toBeVisible();
    await expect(
      implementPicker.getByLabel("prompt:prompt.dev.implement@1"),
    ).toBeChecked();
    await expect(
      implementPicker
        .locator("label")
        .filter({ hasText: "DRT implement prompt" }),
    ).toContainText("v1 · Built-in");
    await expect(
      implementPicker.locator("label").filter({ hasText: "Testing notes" }),
    ).toContainText("v1 · User");
    await expect(
      implementPicker.getByText("Raw JSON remains diagnostics-only."),
    ).toBeVisible();
    await expect(page.getByText("Ready to save.")).toBeVisible();
    await implementPicker.getByLabel("prompt:prompt.dev.implement@1").uncheck();
    await implementPicker
      .getByLabel("prompt:prompt.drt.dev.implement@1")
      .check();
    await page.getByRole("button", { name: "Edit design" }).click();
    await page.getByLabel("Workflow name").fill("Dev Review Tester Copy");
    await page.getByRole("button", { name: "Done" }).first().click();
    await page.getByRole("button", { name: "Edit role" }).click();
    await page.getByLabel("dev label").fill("Implementer");
    await page.getByRole("button", { name: "Done" }).first().click();

    await details.getByRole("button", { name: /Ready for review/ }).click();
    await details.getByRole("button", { name: "Edit action" }).click();
    await page.getByLabel("Target state").selectOption("");
    await expect(
      page.getByText("Choose an existing target state."),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Save draft" }),
    ).toBeDisabled();

    await page.getByLabel("Action label").fill("Proceed to review");
    await page.getByLabel("Target state").selectOption("review");
    await expect(page.getByText("Ready to save.")).toBeVisible();
    await page.getByRole("button", { name: "Save draft" }).click();
    await expect(page.getByText("Saved workflow draft.")).toBeVisible();
    await page.getByRole("button", { name: "Publish" }).click();
    await expect(page.getByText(/Published workflow version/)).toBeVisible();
    expect(published).toBe(true);

    const bodyText = await page.locator("body").innerText();
    expect(bodyText).not.toContain("workflow_call");
  });
});

function metaRunFixture() {
  return {
    metaRunId: "meta-browser",
    parentWorkspaceId: "workspace-a",
    laneId: null,
    status: "running",
    currentIndex: 1,
    childWorkflowDesignId: "design-drt",
    childWorkflowDesignVersion: 1,
    title: "Browser meta workflow",
    summary: null,
    currentItem: null,
    progress: { total: 2, completed: 1, pending: 0, running: 1, blocked: 0 },
    nextAction: "Waiting for B to complete before starting the next bead.",
    blockedReason: null,
    createdAt: 1,
    updatedAt: 2,
    items: [
      { itemId: "i-a", beadId: "A", title: "A title", beadStatus: "open", index: 0, status: "completed", childRunId: "child-a", noteRef: "note-a", result: { summary: "A complete" }, error: null, startedAt: 1, completedAt: 2 },
      { itemId: "i-b", beadId: "B", title: "B title", beadStatus: "open", index: 1, status: "running", childRunId: "child-b", noteRef: null, result: null, error: null, startedAt: 3, completedAt: null },
    ],
  };
}

function homeFixture(
  launched: boolean,
  usedTemplate = false,
  batchQueued = false,
) {
  return {
    workspaceId: "workspace-e2e",
    userWorkflows: [
      workflow,
      ...(usedTemplate
        ? [
            {
              id: "design-drt-used",
              title: "Dev / Review / Tester",
              description: "Three role workflow",
              source: "published_design",
              status: "ready",
              version: 1,
              unavailableReason: null,
              canRun: true,
              inputs: workflow.inputs,
              roles: workflow.roles,
            },
          ]
        : []),
    ],
    starterTemplates: [
      {
        id: "built-in/dev-review-tester",
        title: "Dev / Review / Tester",
        description: "Three role workflow",
        source: "template",
        status: "ready",
        version: null,
        unavailableReason: null,
        canRun: false,
        inputs: [],
        roles: [],
      },
      {
        id: "built-in/create-form-from-agent",
        title: "Create form from agent",
        description: "Create a form schema",
        source: "template",
        status: "ready",
        version: null,
        unavailableReason: null,
        canRun: false,
        inputs: [],
        roles: [],
      },
    ],
    recentRuns: launched
      ? [
          {
            runId: "run-launched",
            workflowName: "Launched workflow run",
            status: "running",
            startedAt: 4,
            updatedAt: 5,
            detailUrl: null,
          },
        ]
      : [
          {
            runId: "run-clean",
            workflowName: "Feature workflow run",
            status: "running",
            startedAt: 1,
            updatedAt: 2,
            detailUrl: null,
          },
        ],
    needsInput: [
      {
        attentionItemId: "attention-clean",
        title: "Answer planning questions",
        description: "Please fill out the form.",
        workflowName: "Feature workflow run",
        createdAt: 3,
        detailUrl: "/dashboard/workflows/legacy-clean",
      },
    ],
    recentBatches: batchQueued ? [batchFixture()] : [],
  };
}

function runStoryFixture() {
  return {
    instanceId: "run-story",
    workflowId: "dev-review-tester",
    workflowName: "Dev Review Tester run",
    status: "running",
    humanStatus: "not_needed",
    originalTask: "Build a readable workflow page",
    startedAt: 1,
    updatedAt: 5,
    completedAt: null,
    summary: {
      statusLabel: "In progress",
      currentOwner: "Reviewer",
      currentState: "Review",
      currentStep: "Review turn",
      waitingReason: "Waiting for Review response.",
      nextAction: "The workflow resumes when the child workflow completes.",
    },
    timeline: [
      {
        id: "dev-1",
        role: "Dev",
        title: "Implementation turn",
        status: "Completed",
        kind: "agent_turn",
        state: "Dev",
        step: "Implement",
        session: null,
        initialMessage: {
          text: "Implement the feature.",
          truncated: false,
          maxChars: null,
        },
        finalResponse: {
          text: "Implementation complete.",
          truncated: false,
          maxChars: null,
        },
        responseUnavailable: null,
        commits: [],
      },
      {
        id: "decision-1",
        role: "Workflow",
        title: "Request changes",
        status: "Completed",
        kind: "decision",
        state: "Review",
        step: "Review turn",
        action: "changes_requested",
        isLoop: true,
        session: null,
        initialMessage: null,
        finalResponse: {
          text: "Reviewer asked for changes.",
          truncated: false,
          maxChars: null,
        },
        responseUnavailable: null,
        commits: [],
      },
      {
        id: "call-child",
        role: "Workflow",
        title: "Run child workflow",
        status: "Waiting",
        kind: "workflow_call",
        state: "Review",
        step: "Call acceptance workflow",
        session: null,
        initialMessage: {
          text: "Started child workflow Child acceptance.",
          truncated: false,
          maxChars: null,
        },
        finalResponse: null,
        responseUnavailable: "Waiting for child workflow.",
        commits: [],
      },
    ],
    callTree: [
      {
        turnId: "call-child",
        label: "Child acceptance",
        status: "running",
        childRunId: "child-run",
        childUrl: "/dashboard/workflows/child-run",
        waitingReason: "Parent is waiting for this child workflow.",
        outputRef: "workflow-run://child-run/output",
      },
    ],
    outputs: [
      {
        id: "child-output",
        label: "Child workflow output",
        value: "workflow-run://child-run/output",
        kind: "workflow_call_output",
      },
    ],
    attention: null,
    provenance: {
      label: "Dev Review Tester run workflow v1",
      workflowName: "Dev Review Tester run",
      workflowDesignId: "dev-review-tester",
      workflowVersion: 1,
    },
  };
}

function batchFixture() {
  return {
    batchId: "batch-e2e",
    workflowName: "Dev Review Tester",
    status: "running",
    counts: {
      total: 4,
      pending: 1,
      running: 1,
      completed: 1,
      failed: 1,
      blocked: 0,
      cancelled: 0,
    },
    items: [
      {
        batchItemId: "batch-e2e-item-0",
        itemIndex: 0,
        status: "completed",
        runId: "run-batch-0",
        error: null,
      },
      {
        batchItemId: "batch-e2e-item-1",
        itemIndex: 1,
        status: "failed",
        runId: null,
        error: {
          code: "workflow_launch_validation_failed",
          message: "Batch item 2 is missing required workflow fields.",
          fieldErrors: { featureRequest: "This field is required." },
        },
      },
      {
        batchItemId: "batch-e2e-item-2",
        itemIndex: 2,
        status: "running",
        runId: "run-batch-2",
        error: null,
      },
      {
        batchItemId: "batch-e2e-item-3",
        itemIndex: 3,
        status: "pending",
        runId: null,
        error: null,
      },
    ],
    updatedAt: 6,
    detailUrl: "/dashboard/workflow-batches/batch-e2e",
  };
}

function batchDetailFixture() {
  return {
    batchId: "batch-e2e",
    workflowName: "Dev Review Tester",
    status: "running",
    counts: {
      total: 4,
      pending: 1,
      running: 1,
      completed: 1,
      failed: 1,
      blocked: 0,
      cancelled: 0,
    },
    capacity: {
      globalActiveRunLimit: 4,
      workspaceActiveRunLimit: 1,
      globalActiveRuns: 1,
      workspaceActiveRuns: 1,
      explanation:
        "Pending items are waiting because this workspace already has 1 active run; the workspace limit is 1.",
    },
    items: [
      {
        batchItemId: "batch-e2e-item-0",
        lineNumber: 1,
        itemIndex: 0,
        inputSummary: "featureRequest: One",
        status: "completed",
        runId: "run-batch-0",
        runUrl: "/dashboard/workflows/run-batch-0",
        error: null,
        startedAt: 1,
        completedAt: 2,
        updatedAt: 2,
        pendingReason: null,
      },
      {
        batchItemId: "batch-e2e-item-1",
        lineNumber: 2,
        itemIndex: 1,
        inputSummary: "No input fields provided.",
        status: "failed",
        runId: null,
        runUrl: null,
        error: {
          code: "workflow_launch_validation_failed",
          message: "Batch item 2 is missing required workflow fields.",
          fieldErrors: { featureRequest: "This field is required." },
        },
        startedAt: null,
        completedAt: 3,
        updatedAt: 3,
        pendingReason: null,
      },
      {
        batchItemId: "batch-e2e-item-2",
        lineNumber: 3,
        itemIndex: 2,
        inputSummary: "featureRequest: Two",
        status: "running",
        runId: "run-batch-2",
        runUrl: "/dashboard/workflows/run-batch-2",
        error: null,
        startedAt: 4,
        completedAt: null,
        updatedAt: 5,
        pendingReason: null,
      },
      {
        batchItemId: "batch-e2e-item-3",
        lineNumber: 4,
        itemIndex: 3,
        inputSummary: "featureRequest: Three",
        status: "pending",
        runId: null,
        runUrl: null,
        error: null,
        startedAt: null,
        completedAt: null,
        updatedAt: 6,
        pendingReason:
          "This item will start when workspace capacity is available.",
      },
    ],
    createdAt: 1,
    updatedAt: 6,
  };
}

function editorFixture(definition: any) {
  return {
    designId: "design-dev-review-tester",
    name: "Dev Review Tester",
    description: "Feature work loop",
    draftId: "draft-dev-review-tester",
    version: 1,
    readonly: false,
    definition,
    validationStatus: "valid",
    validationIssues: [],
  };
}

function graphDefinition() {
  return {
    schemaVersion: 1,
    name: "Dev Review Tester",
    inputs: { featureRequest: { type: "markdown", required: true } },
    roles: {
      dev: { label: "Dev" },
      review: { label: "Review" },
      tester: { label: "Tester" },
    },
    initialState: "dev",
    states: {
      dev: {
        owner: "dev",
        steps: [
          {
            id: "implement",
            type: "agent_turn",
            turnType: "non_decision",
            prompt: {
              template: "Implement feature",
              refs: [
                { kind: "prompt", id: "prompt.dev.implement", version: 1 },
              ],
            },
          },
          {
            id: "self_review",
            type: "agent_turn",
            turnType: "decision",
            prompt: { template: "Self-review" },
            response: decisionResponse(),
          },
        ],
        actions: {
          ready_for_review: {
            label: "Ready for review",
            targetState: "review",
          },
          keep_working: { label: "Keep working", targetState: "dev" },
        },
      },
      review: {
        owner: "review",
        steps: [
          {
            id: "review",
            type: "agent_turn",
            turnType: "decision",
            prompt: { template: "Review code" },
            response: decisionResponse(),
          },
        ],
        actions: {
          approved: { label: "Approved", targetState: "tester" },
          changes_requested: { label: "Request changes", targetState: "dev" },
        },
      },
      tester: {
        owner: "tester",
        steps: [
          {
            id: "acceptance_form",
            type: "human_form",
            title: "Acceptance results",
            form: {
              providerType: "beads_form",
              formSchema: { fields: { approved: { type: "boolean" } } },
            },
          },
          {
            id: "tester_decision",
            type: "agent_turn",
            turnType: "decision",
            prompt: { template: "Choose acceptance outcome" },
            response: decisionResponse(),
          },
        ],
        actions: {
          approved: { label: "Approved", targetState: "done" },
          bug_found: { label: "Bug found", targetState: "dev" },
        },
      },
      done: { terminal: true },
    },
  };
}

function decisionResponse() {
  return {
    format: "xml",
    schema: { format: "xsd", source: "state_actions" },
    invalidXmlRetry: {
      maxAttempts: 1,
      prompt: "engine_default_with_validation_errors",
      onExhausted: "blocked",
    },
    storeRawXml: true,
    storeParsedFields: true,
    unknownFields: "reject_unless_allowed_by_result_contract",
  };
}
