import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  createSkinLabStories,
  toSkinLabStoryExportName,
  type SkinLabOption,
} from "./skinLab";

type DemoArgs = {
  densityPreset: "desktop" | "mobile";
  skinPreset: "default" | "light";
  statePreset: "populated" | "empty";
  viewPackPreset: "default" | "dense";
};

const states: Array<SkinLabOption<DemoArgs>> = [
  { id: "populated", label: "Populated", args: { statePreset: "populated" } },
  { id: "empty", label: "Empty", args: { statePreset: "empty" } },
];

const skins: Array<SkinLabOption<DemoArgs>> = [
  { id: "default", label: "Default Dark", args: { skinPreset: "default" } },
  { id: "light", label: "Light Studio", args: { skinPreset: "light" } },
];

const viewPacks: Array<SkinLabOption<DemoArgs>> = [
  { id: "default", label: "Default", args: { viewPackPreset: "default" } },
  { id: "dense", label: "Dense", args: { viewPackPreset: "dense" } },
];

const densities: Array<SkinLabOption<DemoArgs>> = [
  {
    id: "desktop",
    label: "Desktop",
    args: { densityPreset: "desktop" },
    parameters: { viewport: { defaultViewport: "responsive" } },
  },
  {
    id: "mobile",
    label: "Mobile",
    args: { densityPreset: "mobile" },
    parameters: { viewport: { defaultViewport: "mobile1" } },
  },
];

describe("SkinLab Storybook matrix convention", () => {
  it("creates deterministic CSF export names from ids", () => {
    expect(toSkinLabStoryExportName("light-studio.mobile")).toBe(
      "LightStudioMobile",
    );
    expect(toSkinLabStoryExportName("404-state")).toBe("Story404State");
    expect(toSkinLabStoryExportName("")).toBe("GeneratedStory");
  });

  it("composes state, skin, view-pack, and density fixtures into story args", () => {
    const stories = createSkinLabStories<DemoArgs>({
      densities,
      legacyReferenceStories: ["Design Directions/Spaces Overview"],
      skins,
      states,
      stories: [
        {
          density: "mobile",
          id: "light-dense-mobile",
          label: "Light dense mobile",
          skin: "light",
          state: "populated",
          viewPack: "dense",
        },
      ],
      surfaceId: "demo-surface",
      viewPacks,
    });

    expect(stories.LightDenseMobile?.args).toEqual({
      densityPreset: "mobile",
      skinPreset: "light",
      statePreset: "populated",
      viewPackPreset: "dense",
    });
    expect(stories.LightDenseMobile?.parameters?.viewport).toEqual({
      defaultViewport: "mobile1",
    });
    expect(stories.LightDenseMobile?.parameters?.skinLab).toEqual({
      density: "mobile",
      legacyReferenceStories: ["Design Directions/Spaces Overview"],
      skin: "light",
      state: "populated",
      surfaceId: "demo-surface",
      viewPack: "dense",
    });
  });

  it("fails fast when story ids normalize to duplicate CSF export names", () => {
    expect(() =>
      createSkinLabStories<DemoArgs>({
        densities,
        skins,
        states,
        stories: [
          {
            density: "desktop",
            id: "light-studio.mobile",
            label: "Light studio mobile",
            skin: "light",
            state: "populated",
            viewPack: "default",
          },
          {
            density: "desktop",
            id: "light-studio-mobile",
            label: "Light studio mobile duplicate",
            skin: "light",
            state: "populated",
            viewPack: "default",
          },
        ],
        surfaceId: "demo-surface",
        viewPacks,
      }),
    ).toThrow(
      'Duplicate SkinLab generated export name "LightStudioMobile" for story id "light-studio-mobile"; already used by story id "light-studio.mobile".',
    );
  });

  it("documents preserved old exploration stories instead of silently pruning them", () => {
    const stories = createSkinLabStories<DemoArgs>({
      densities,
      legacyReferenceStories: ["Design Directions/Spaces Overview"],
      skins,
      states,
      stories: [
        {
          density: "desktop",
          id: "default-populated",
          label: "Default populated",
          skin: "default",
          state: "populated",
          viewPack: "default",
        },
      ],
      surfaceId: "demo-surface",
      viewPacks,
    });

    const description =
      stories.DefaultPopulated?.parameters?.docs &&
      typeof stories.DefaultPopulated.parameters.docs === "object" &&
      "description" in stories.DefaultPopulated.parameters.docs
        ? stories.DefaultPopulated.parameters.docs.description
        : null;

    expect(JSON.stringify(description)).toContain(
      "Legacy exploration stories preserved as references",
    );
  });

  it("has migrated SpacesOverview and Skin Editor stories opted into SkinLab", () => {
    const spacesOverviewStories = readFileSync(
      "src/components/SpacesOverview.stories.tsx",
      "utf8",
    );
    const skinEditorStories = readFileSync(
      "src/theme/skins/SkinEditorDialog.stories.tsx",
      "utf8",
    );

    expect(spacesOverviewStories).toContain("createSkinLabStories");
    expect(spacesOverviewStories).toContain("skinPreset");
    expect(spacesOverviewStories).toContain("viewPackPreset");
    expect(spacesOverviewStories).toContain("densityPreset");
    expect(spacesOverviewStories).toContain("Design Directions/Spaces Overview");
    expect(skinEditorStories).toContain("createSkinLabStories");
    expect(skinEditorStories).toContain("densityPreset");
    expect(skinEditorStories).toContain("vkvw-9yay.12");
  });
});
