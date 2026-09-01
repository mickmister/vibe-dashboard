import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { SkinEditorDialog } from "./SkinEditorDialog";
import {
  DEFAULT_VD_SKIN_ID,
  lightStudioSkin,
  type VDSkinState,
} from "./index";

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

function SkinEditorStory({ initialState }: { initialState: VDSkinState }) {
  const [state, setState] = useState(initialState);

  return (
    <div className="h-screen bg-zinc-950 p-6">
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
  parameters: {
    docs: {
      description: {
        component:
          "Manual proof for the second migrated global skin customization surface: controller/model/actions feed pure view files, safe token previews use SkinRoot, and import/save/revert flows stay raw-CSS-free.",
      },
    },
  },
};

export default meta;
type Story = StoryObj<typeof meta>;

export const DefaultGlobalSkin: Story = {
  args: {
    initialState: {
      version: 1,
      activeGlobalSkinId: DEFAULT_VD_SKIN_ID,
      userSkins: [],
    },
  },
};

export const CustomSkinActive: Story = {
  args: {
    initialState: {
      version: 1,
      activeGlobalSkinId: customStudioSkin.id,
      userSkins: [customStudioSkin],
    },
  },
};
