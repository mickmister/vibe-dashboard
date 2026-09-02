type StoryParameters = Record<string, unknown>;

export type SkinLabOption<TArgs extends Record<string, unknown>> = {
  args?: Partial<TArgs>;
  description?: string;
  id: string;
  label: string;
  parameters?: StoryParameters;
};

export type SkinLabStorySpec<TArgs extends Record<string, unknown>> = {
  args?: Partial<TArgs>;
  density: string;
  description?: string;
  id: string;
  label: string;
  parameters?: StoryParameters;
  skin: string;
  state: string;
  viewPack: string;
};

export type SkinLabStoryConfig<TArgs extends Record<string, unknown>> = {
  baseArgs?: Partial<TArgs>;
  baseParameters?: StoryParameters;
  densities: Array<SkinLabOption<TArgs>>;
  legacyReferenceStories?: string[];
  skins: Array<SkinLabOption<TArgs>>;
  states: Array<SkinLabOption<TArgs>>;
  stories: Array<SkinLabStorySpec<TArgs>>;
  surfaceId: string;
  viewPacks: Array<SkinLabOption<TArgs>>;
};

export type SkinLabStory<TArgs extends Record<string, unknown>> = {
  args: TArgs;
  name: string;
  parameters: StoryParameters;
};

export function toSkinLabStoryExportName(id: string): string {
  const name = id
    .split(/[^a-zA-Z0-9]+/)
    .filter(Boolean)
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join("");

  if (!name) return "GeneratedStory";
  return /^[0-9]/.test(name) ? `Story${name}` : name;
}

export function createSkinLabStories<TArgs extends Record<string, unknown>>(
  config: SkinLabStoryConfig<TArgs>,
): Record<string, SkinLabStory<TArgs>> {
  const stateOptions = indexOptions(config.states);
  const skinOptions = indexOptions(config.skins);
  const viewPackOptions = indexOptions(config.viewPacks);
  const densityOptions = indexOptions(config.densities);
  const stories: Record<string, SkinLabStory<TArgs>> = {};
  const storyIdByExportName = new Map<string, string>();

  for (const story of config.stories) {
    const state = getOption("state", stateOptions, story.state);
    const skin = getOption("skin", skinOptions, story.skin);
    const viewPack = getOption("view pack", viewPackOptions, story.viewPack);
    const density = getOption("density", densityOptions, story.density);
    const exportName = toSkinLabStoryExportName(story.id);
    const priorStoryId = storyIdByExportName.get(exportName);

    if (priorStoryId) {
      throw new Error(
        `Duplicate SkinLab generated export name "${exportName}" for story id "${story.id}"; already used by story id "${priorStoryId}".`,
      );
    }

    storyIdByExportName.set(exportName, story.id);

    stories[exportName] = {
      name: story.label,
      args: {
        ...config.baseArgs,
        ...state.args,
        ...skin.args,
        ...viewPack.args,
        ...density.args,
        ...story.args,
      } as TArgs,
      parameters: createStoryParameters({
        config,
        density,
        skin,
        state,
        story,
        viewPack,
      }),
    };
  }

  return stories;
}

function indexOptions<TArgs extends Record<string, unknown>>(
  options: Array<SkinLabOption<TArgs>>,
): Map<string, SkinLabOption<TArgs>> {
  const index = new Map<string, SkinLabOption<TArgs>>();
  for (const option of options) index.set(option.id, option);
  return index;
}

function getOption<TArgs extends Record<string, unknown>>(
  label: string,
  options: Map<string, SkinLabOption<TArgs>>,
  id: string,
): SkinLabOption<TArgs> {
  const option = options.get(id);
  if (!option) {
    throw new Error(`Unknown SkinLab ${label} "${id}"`);
  }
  return option;
}

function createStoryParameters<TArgs extends Record<string, unknown>>({
  config,
  density,
  skin,
  state,
  story,
  viewPack,
}: {
  config: SkinLabStoryConfig<TArgs>;
  density: SkinLabOption<TArgs>;
  skin: SkinLabOption<TArgs>;
  state: SkinLabOption<TArgs>;
  story: SkinLabStorySpec<TArgs>;
  viewPack: SkinLabOption<TArgs>;
}): StoryParameters {
  const description = [
    story.description,
    `SkinLab matrix: surface=${config.surfaceId}; state=${state.label}; skin=${skin.label}; view pack=${viewPack.label}; density=${density.label}.`,
    config.legacyReferenceStories?.length
      ? `Legacy exploration stories preserved as references: ${config.legacyReferenceStories.join(", ")}.`
      : null,
  ]
    .filter(Boolean)
    .join(" ");

  return mergeParameters(
    config.baseParameters,
    state.parameters,
    skin.parameters,
    viewPack.parameters,
    density.parameters,
    story.parameters,
    {
      docs: {
        description: {
          story: description,
        },
      },
      skinLab: {
        density: density.id,
        legacyReferenceStories: config.legacyReferenceStories ?? [],
        skin: skin.id,
        state: state.id,
        surfaceId: config.surfaceId,
        viewPack: viewPack.id,
      },
    },
  );
}

function mergeParameters(
  ...parameterSets: Array<StoryParameters | undefined>
): StoryParameters {
  const merged: StoryParameters = {};

  for (const parameters of parameterSets) {
    if (!parameters) continue;
    for (const [key, value] of Object.entries(parameters)) {
      if (isPlainObject(merged[key]) && isPlainObject(value)) {
        merged[key] = mergeParameters(
          merged[key] as StoryParameters,
          value as StoryParameters,
        );
      } else {
        merged[key] = value;
      }
    }
  }

  return merged;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
