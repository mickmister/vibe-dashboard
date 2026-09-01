import { useEffect, useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { SkinEditorDialog } from "./SkinEditorDialog";
import {
  DEFAULT_VD_SKIN_ID,
  lightStudioSkin,
  type VDSkinState,
} from "./index";
import {
  createSkinLabStories,
  type SkinLabOption,
} from "../../stories/skinLab";

const customStudioSkin = {
  ...lightStudioSkin,
  id: "vd-user-cyan-studio",
  name: "Cyan Studio",
  author: "Storybook",
  tokens: {
    ...lightStudioSkin.tokens,
    colors: {
      ...lightStudioSkin.tokens.colors,
      accent: "#0891b2",
      background: "#ecfeff",
      foreground: "#083344",
      panel: "#ffffff",
    },
  },
  surfaces: {
    ...lightStudioSkin.surfaces,
    "skin-editor": {
      background: "#ecfeff",
      foreground: "#083344",
      border: "#67e8f9",
      radius: "1rem",
      shadow: "0 24px 80px rgb(8 47 73 / 0.15)",
      accent: "#0891b2",
    },
  },
  rawCss: [],
};

type SkinEditorDensityPreset = "desktop" | "mobile";
type SkinEditorStatePreset = "default-global" | "custom-active";
type SkinEditorStoryArgs = {
  densityPreset: SkinEditorDensityPreset;
  initialState: VDSkinState;
  statePreset: SkinEditorStatePreset;
};

const defaultGlobalSkinState: VDSkinState = {
  version: 1,
  activeGlobalSkinId: DEFAULT_VD_SKIN_ID,
  userSkins: [],
};

const customSkinActiveState: VDSkinState = {
  version: 1,
  activeGlobalSkinId: customStudioSkin.id,
  userSkins: [customStudioSkin],
};

const skinEditorStateByPreset: Record<SkinEditorStatePreset, VDSkinState> = {
  "custom-active": customSkinActiveState,
  "default-global": defaultGlobalSkinState,
};

function SkinEditorStory({
  densityPreset = "desktop",
  initialState,
  statePreset = "default-global",
}: SkinEditorStoryArgs) {
  const selectedInitialState =
    skinEditorStateByPreset[statePreset] ?? initialState;
  const [state, setState] = useState(selectedInitialState);

  useEffect(() => {
    setState(selectedInitialState);
  }, [selectedInitialState]);

  return (
    <div
      className={
        densityPreset === "mobile"
          ? "mx-auto min-h-screen w-[390px] max-w-full bg-zinc-950 p-3"
          : "h-screen bg-zinc-950 p-6"
      }
      data-storybook-density={densityPreset}
    >
      <SkinEditorDialog
        actions={{
          saveSkinState: async ({ state: nextState }) => {
            setState(nextState);
            console.info("save skin state", nextState);
            return { ok: true };
          },
        }}
        onClose={() => console.info("close skin editor")}
        open
        skinState={state}
      />
    </div>
  );
}

const meta: Meta<typeof SkinEditorStory> = {
  title: "Scenes/SkinEditor",
  component: SkinEditorStory,
  args: {
    densityPreset: "desktop",
    initialState: defaultGlobalSkinState,
    statePreset: "default-global",
  },
  argTypes: {
    densityPreset: {
      control: "select",
      options: ["desktop", "mobile"],
      description:
        "Storybook SkinLab density control for checking dialog layout at desktop and mobile widths.",
    },
    statePreset: {
      control: "select",
      options: ["default-global", "custom-active"],
      description:
        "Storybook SkinLab state fixture control for default and user-customized global skin states.",
    },
    initialState: {
      control: false,
      table: {
        disable: true,
      },
    },
  },
  parameters: {
    docs: {
      description: {
        component:
          "SkinLab coverage for the second migrated global skin customization surface: controller/model/actions feed pure view files, safe token previews use SkinRoot, and import/save/revert flows stay raw-CSS-free. Production app wiring is tracked separately by vkvw-9yay.12.",
      },
    },
  },
};

export default meta;
type Story = StoryObj<typeof meta>;

const skinEditorStateOptions: Array<SkinLabOption<SkinEditorStoryArgs>> = [
  {
    id: "default-global",
    label: "Default global skin",
    args: {
      initialState: defaultGlobalSkinState,
      statePreset: "default-global",
    },
  },
  {
    id: "custom-active",
    label: "Custom skin active",
    args: {
      initialState: customSkinActiveState,
      statePreset: "custom-active",
    },
  },
];

const skinEditorSkinOptions: Array<SkinLabOption<SkinEditorStoryArgs>> = [
  { id: "runtime", label: "Editor preview runtime" },
];

const skinEditorViewPackOptions: Array<SkinLabOption<SkinEditorStoryArgs>> = [
  { id: "default", label: "Default dialog view" },
];

const skinEditorDensityOptions: Array<SkinLabOption<SkinEditorStoryArgs>> = [
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

const skinEditorStories = createSkinLabStories<SkinEditorStoryArgs>({
  densities: skinEditorDensityOptions,
  skins: skinEditorSkinOptions,
  states: skinEditorStateOptions,
  stories: [
    {
      density: "desktop",
      id: "default-global-skin",
      label: "Default global skin",
      skin: "runtime",
      state: "default-global",
      viewPack: "default",
    },
    {
      density: "desktop",
      id: "custom-skin-active",
      label: "Custom skin active",
      skin: "runtime",
      state: "custom-active",
      viewPack: "default",
    },
    {
      density: "mobile",
      id: "mobile-custom-skin-active",
      label: "Mobile custom skin active",
      description:
        "Proof that the migrated Skin Editor surface can reuse the same state fixture at mobile density.",
      skin: "runtime",
      state: "custom-active",
      viewPack: "default",
    },
  ],
  surfaceId: "skin-editor",
  viewPacks: skinEditorViewPackOptions,
});

export const DefaultGlobalSkin: Story =
  skinEditorStories.DefaultGlobalSkin as Story;

export const CustomSkinActive: Story =
  skinEditorStories.CustomSkinActive as Story;

export const MobileCustomSkinActive: Story =
  skinEditorStories.MobileCustomSkinActive as Story;
