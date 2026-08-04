import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("workflow-e2e-docker-smoke harness", () => {
  it("keeps workflow E2E execution inside Docker and uses docker exec", () => {
    const script = readFileSync(
      resolve("scripts/workflow-e2e-docker-smoke.sh"),
      "utf8",
    );

    expect(script).toContain("docker run");
    expect(script).toContain("docker exec");
    expect(script).toContain(
      "cargo test -p executors --features qa-mode qa_mock --no-default-features",
    );
    expect(script).toContain('export PATH="/usr/local/cargo/bin:${PATH}"');

    const nonCommentLines = script
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#"));
    expect(nonCommentLines.some((line) => line.startsWith("cargo test"))).toBe(
      false,
    );
  });
});
