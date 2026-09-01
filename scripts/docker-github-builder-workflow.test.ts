import { readFileSync } from "fs";
import { describe, expect, it } from "vitest";

const dockerBuilderWorkflowPath = ".github/workflows/docker-github-builder-build.yml";
const publishWorkflowPath = ".github/workflows/publish-ghcr-vk-vd.yml";

function readDockerBuilderWorkflow() {
  return readFileSync(dockerBuilderWorkflowPath, "utf8");
}

function readPublishWorkflow() {
  return readFileSync(publishWorkflowPath, "utf8");
}

function stepBlock(workflow: string, stepName: string, occurrence = 1) {
  const marker = `        name: ${stepName}`;
  let index = -1;
  let from = 0;

  for (let count = 0; count < occurrence; count += 1) {
    index = workflow.indexOf(marker, from);
    if (index === -1) {
      throw new Error(`Could not find workflow step "${stepName}" occurrence ${occurrence}`);
    }
    from = index + marker.length;
  }

  const nextStep = workflow.indexOf("\n      -\n", from);
  return workflow.slice(index, nextStep === -1 ? undefined : nextStep);
}

describe("docker-github-builder-build workflow", () => {
  it("does not install cosign or verify dependency signatures when signing is explicitly disabled", () => {
    const workflow = readDockerBuilderWorkflow();
    const prepareCosign = stepBlock(workflow, "Install Cosign", 1);
    const dependencySignatureCheck = stepBlock(workflow, "Check dependencies signatures");

    for (const block of [prepareCosign, dependencySignatureCheck]) {
      expect(block).toContain("if: ${{");
      expect(block).toContain("inputs.sign == 'true'");
      expect(block).toContain("inputs.sign == 'auto'");
      expect(block).not.toContain("inputs.sign != 'false'");
    }
  });

  it("does not make GitHub Actions cache signing force cosign when output signing is disabled", () => {
    const workflow = readDockerBuilderWorkflow();
    const buildCosign = stepBlock(workflow, "Install Cosign", 2);

    expect(workflow).toContain(
      "const ghaCacheSign = inpActionsIdTokenSet && sign ? 'true' : 'false';",
    );
    expect(buildCosign).toContain(
      "if: ${{ needs.prepare.outputs.sign == 'true' || needs.prepare.outputs.ghaCacheSign == 'true' }}",
    );
    expect(buildCosign).not.toContain("|| inputs.cache");
  });
});

describe("Publish VK/VD Image to GHCR workflow", () => {
  it("exposes the resolved VD ref and commit before passing them to the Docker Git context", () => {
    const workflow = readPublishWorkflow();

    expect(workflow).toContain("vd_ref: ${{ steps.resolve.outputs.vd_ref }}");
    expect(workflow).toContain("vd_commit: ${{ steps.resolve.outputs.vd_commit }}");
    expect(workflow).toContain("source-ref: ${{ needs.resolve-vk-ref.outputs.vd_ref }}");
    expect(workflow).toContain(
      "source-checksum: ${{ needs.resolve-vk-ref.outputs.vd_commit }}",
    );
  });
});
