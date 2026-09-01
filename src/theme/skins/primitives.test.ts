import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  VDAction,
  VDBadge,
  VDCard,
  VDHeading,
  VDIcon,
  VDRow,
  VDText,
} from "./primitives.view";

describe("skin-aware view primitives", () => {
  it("renders semantic text hooks without requiring manual data-vd attributes", () => {
    const html = renderToStaticMarkup(
      React.createElement(
        React.Fragment,
        null,
        React.createElement(VDHeading, { level: 2 }, "Workspaces"),
        React.createElement(VDText, { tone: "secondary" }, "2 active"),
        React.createElement(VDText, { tone: "muted" }, "Last updated"),
        React.createElement(VDText, { status: "success" }, "+42"),
      ),
    );

    expect(html).toContain("data-vd-text=\"primary\"");
    expect(html).toContain("data-vd-text=\"secondary\"");
    expect(html).toContain("data-vd-muted=\"true\"");
    expect(html).toContain("data-vd-status=\"success\"");
  });

  it("renders component hooks for common skinnable view building blocks", () => {
    const html = renderToStaticMarkup(
      React.createElement(
        React.Fragment,
        null,
        React.createElement(VDCard, null, "Card"),
        React.createElement(VDRow, { as: "button", type: "button" }, "Row"),
        React.createElement(VDAction, { tone: "danger", type: "button" }, "Delete"),
        React.createElement(VDBadge, { status: "warning" }, "Waiting"),
        React.createElement(VDIcon, { name: "chevron" }, "›"),
      ),
    );

    expect(html).toContain("data-vd-component=\"card\"");
    expect(html).toContain("data-vd-component=\"row\"");
    expect(html).toContain("data-vd-component=\"button\"");
    expect(html).toContain("data-vd-component=\"badge\"");
    expect(html).toContain("data-vd-tone=\"danger\"");
    expect(html).toContain("data-vd-status=\"warning\"");
    expect(html).toContain("data-vd-icon=\"chevron\"");
  });

  it("preserves native props and author class names", () => {
    const html = renderToStaticMarkup(
      React.createElement(
        VDAction,
        {
          "aria-label": "Open workspace",
          className: "rounded px-2",
          disabled: true,
          tone: "quiet",
          type: "button",
        },
        "Open",
      ),
    );

    expect(html).toContain("aria-label=\"Open workspace\"");
    expect(html).toContain("class=\"rounded px-2\"");
    expect(html).toContain("disabled=\"\"");
    expect(html).toContain("data-vd-tone=\"quiet\"");
  });

  it("defaults action buttons to non-submit buttons while preserving overrides", () => {
    const html = renderToStaticMarkup(
      React.createElement(
        React.Fragment,
        null,
        React.createElement(VDAction, null, "Default action"),
        React.createElement(VDAction, { type: "submit" }, "Submit action"),
        React.createElement(VDAction, { type: "reset" }, "Reset action"),
      ),
    );

    expect(html).toMatch(/<button[^>]*type="button"/);
    expect(html).toMatch(/<button[^>]*type="submit"/);
    expect(html).toMatch(/<button[^>]*type="reset"/);
  });

  it("defaults button rows to non-submit buttons while preserving overrides", () => {
    const html = renderToStaticMarkup(
      React.createElement(
        React.Fragment,
        null,
        React.createElement(VDRow, { as: "button" }, "Default row"),
        React.createElement(VDRow, { as: "button", type: "submit" }, "Submit row"),
        React.createElement(VDRow, { as: "button", type: "reset" }, "Reset row"),
      ),
    );

    expect(html).toMatch(/<button[^>]*type="button"/);
    expect(html).toMatch(/<button[^>]*type="submit"/);
    expect(html).toMatch(/<button[^>]*type="reset"/);
  });
});
