import springboard from "springboard";
import {
  createPluginManifest,
  type PluginManifest,
} from "../vibe-dashboard/types";
import {
  createDefaultGasCityDashboardState,
  type GasCityDashboardState,
  type GasCityGeneratedCityRuntime,
  type GasCitySessionInfo,
  type GasCityPluginModule,
} from "./types";
import {
  previewGasCityGeneratedCityConfig,
  renderGasCityGeneratedCityConfig,
} from "./city-config-renderer";
import { scanGasCityLocalPack } from "./local-pack-scanner";

const manifest: PluginManifest = createPluginManifest({
  id: "dev.mickmister.gas-city",
  displayName: "Gas City",
  version: "1.0.0",
  contributions: {
    tabPresets: [
      {
        key: "gas-city",
        title: "Gas City",
        description: "Manage Gas City sessions and open related workdirs",
        mode: "immediate",
        urlTemplate: "internal://gas-city",
        order: 20,
      },
    ],
  },
});

type NodeFsPromises = typeof import("node:fs/promises");
type NodePath = typeof import("node:path");

async function writeFileAtomic(
  fs: NodeFsPromises,
  path: NodePath,
  targetPath: string,
  contents: string,
): Promise<void> {
  const tempSuffix = `${process.pid}.${Date.now()}.${Math.random()
    .toString(36)
    .slice(2)}`;
  const tempPath = path.join(
    path.dirname(targetPath),
    `.${path.basename(targetPath)}.${tempSuffix}.tmp`,
  );
  await fs.writeFile(tempPath, contents, "utf8");
  await fs.rename(tempPath, targetPath);
}

async function readTextFileIfPresent(
  fs: NodeFsPromises,
  filePath: string,
): Promise<string | null> {
  try {
    return await fs.readFile(filePath, "utf8");
  } catch (error) {
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      error.code === "ENOENT"
    ) {
      return null;
    }
    throw error;
  }
}

springboard.registerModule(
  "plugin-gas-city",
  { rpcMode: "remote" },
  async (moduleAPI) => {
    const pluginRegistry = moduleAPI.getModule("plugin-registry");
    if (pluginRegistry) {
      await pluginRegistry.actions.registerPlugin(manifest);
    }

    const dashboard =
      await moduleAPI.statesAPI.createPersistentState<GasCityDashboardState>(
        "plugin-gas-city",
        createDefaultGasCityDashboardState(),
      );

    const setLoading = (loading: boolean) => {
      dashboard.setStateImmer((draft) => {
        draft.loading = loading;
      });
    };

    const setError = (error: string | null) => {
      dashboard.setStateImmer((draft) => {
        draft.error = error;
      });
    };

    const ensureConfig = () => {
      const state = dashboard.getState();
      const gcBinary = state.gcBinary.trim();
      const cityPath = state.cityPath.trim();
      if (!gcBinary) {
        throw new Error("Set a Gas City binary first.");
      }
      if (!cityPath) {
        throw new Error("Set a Gas City city path first.");
      }
      return { gcBinary, cityPath };
    };

    const importNode = async <T>(specifier: string): Promise<T> => {
      const dynamicImporter = new Function(
        "specifier",
        "return import(specifier);",
      ) as (specifier: string) => Promise<T>;
      return dynamicImporter(specifier);
    };

    const runGc = async (
      args: string[],
      options?: { env?: Record<string, string> },
    ): Promise<{ stdout: string; stderr: string }> => {
      const { gcBinary, cityPath } = ensureConfig();
      const childProcess =
        await importNode<typeof import("node:child_process")>(
          "node:child_process",
        );

      return new Promise((resolve, reject) => {
        childProcess.execFile(
          gcBinary,
          args,
          {
            cwd: cityPath,
            env: {
              ...process.env,
              ...(options?.env ?? {}),
            },
            maxBuffer: 2 * 1024 * 1024,
          },
          (error, stdout, stderr) => {
            if (error) {
              const message = (stderr || stdout || error.message).trim();
              reject(
                new Error(
                  message || `Failed running ${gcBinary} ${args.join(" ")}`,
                ),
              );
              return;
            }
            resolve({
              stdout: stdout.trim(),
              stderr: stderr.trim(),
            });
          },
        );
      });
    };

    const runAndStoreOutput = async (args: string[]) => {
      const result = await runGc(args);
      dashboard.setStateImmer((draft) => {
        draft.lastCommandOutput = [result.stdout, result.stderr]
          .filter(Boolean)
          .join("\n")
          .trim();
        draft.error = null;
      });
      return result.stdout;
    };

    const refreshSessionsInternal = async (): Promise<GasCitySessionInfo[]> => {
      const { stdout } = await runGc([
        "session",
        "list",
        "--json",
        "--state",
        "all",
      ]);
      const sessions = (
        JSON.parse(stdout || "[]") as GasCitySessionInfo[]
      ).sort((a, b) => {
        const aTs = Date.parse(a.LastActive || a.CreatedAt || "");
        const bTs = Date.parse(b.LastActive || b.CreatedAt || "");
        return (isNaN(bTs) ? 0 : bTs) - (isNaN(aTs) ? 0 : aTs);
      });
      dashboard.setStateImmer((draft) => {
        draft.sessions = sessions;
        draft.loaded = true;
        draft.error = null;
      });
      return sessions;
    };

    const withLoading = async <T>(fn: () => Promise<T>) => {
      setLoading(true);
      try {
        return await fn();
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        setError(message);
        throw error;
      } finally {
        setLoading(false);
      }
    };

    const actions = moduleAPI.createActions({
      setConfig: (args: { gcBinary: string; cityPath: string }) => {
        dashboard.setStateImmer((draft) => {
          draft.gcBinary = args.gcBinary.trim() || "gc";
          draft.cityPath = args.cityPath.trim();
          draft.error = null;
        });
      },
      renderGeneratedCityConfig: async (args?: {
        runtimeRoot?: string;
        cityName?: string;
        cityId?: string;
      }) => {
        const fs = await importNode<typeof import("node:fs/promises")>(
          "node:fs/promises",
        );
        const path = await importNode<typeof import("node:path")>("node:path");
        const state = dashboard.getState();
        const runtimeRoot = (
          args?.runtimeRoot ?? state.cityBuilder.generatedCity.runtimeRoot
        ).trim();
        if (!runtimeRoot) {
          throw new Error("Choose a generated Gas City runtime directory.");
        }
        if (!path.isAbsolute(runtimeRoot)) {
          throw new Error(
            "Generated Gas City runtime directory must be an absolute path.",
          );
        }

        const builderState = {
          ...state.cityBuilder,
          generatedCity: {
            ...state.cityBuilder.generatedCity,
            cityId:
              args?.cityId?.trim() ||
              state.cityBuilder.generatedCity.cityId ||
              "default",
            cityName:
              args?.cityName?.trim() ||
              state.cityBuilder.generatedCity.cityName ||
              "vd-generated",
            runtimeRoot,
            cityTomlPath: path.join(runtimeRoot, "city.toml"),
          },
        };
        const rendered = renderGasCityGeneratedCityConfig(builderState);
        const cityTomlPath = path.join(runtimeRoot, "city.toml");
        const packTomlPath = path.join(runtimeRoot, "pack.toml");

        await fs.mkdir(runtimeRoot, { recursive: true });
        await writeFileAtomic(fs, path, cityTomlPath, rendered.cityToml);
        await writeFileAtomic(fs, path, packTomlPath, rendered.packToml);

        const runtime: GasCityGeneratedCityRuntime = {
          cityId: builderState.generatedCity.cityId,
          cityName: builderState.generatedCity.cityName,
          runtimeRoot,
          cityTomlPath,
          lastRenderedAt: new Date().toISOString(),
        };
        dashboard.setStateImmer((draft) => {
          draft.cityPath = runtimeRoot;
          draft.cityBuilder.generatedCity = runtime;
          draft.error = null;
          draft.lastCommandOutput = `Rendered generated Gas City config:\n${cityTomlPath}\n${packTomlPath}`;
        });
        return { runtime, packTomlPath };
      },
      previewGeneratedCityConfig: async (args?: {
        runtimeRoot?: string;
        cityName?: string;
        cityId?: string;
      }) => {
        const fs = await importNode<typeof import("node:fs/promises")>(
          "node:fs/promises",
        );
        const path = await importNode<typeof import("node:path")>("node:path");
        const state = dashboard.getState();
        const runtimeRoot = (
          args?.runtimeRoot ?? state.cityBuilder.generatedCity.runtimeRoot
        ).trim();
        if (!runtimeRoot) {
          throw new Error("Choose a generated Gas City runtime directory.");
        }
        if (!path.isAbsolute(runtimeRoot)) {
          throw new Error(
            "Generated Gas City runtime directory must be an absolute path.",
          );
        }
        const cityTomlPath = path.join(runtimeRoot, "city.toml");
        const packTomlPath = path.join(runtimeRoot, "pack.toml");
        const builderState = {
          ...state.cityBuilder,
          generatedCity: {
            ...state.cityBuilder.generatedCity,
            cityId:
              args?.cityId?.trim() ||
              state.cityBuilder.generatedCity.cityId ||
              "default",
            cityName:
              args?.cityName?.trim() ||
              state.cityBuilder.generatedCity.cityName ||
              "vd-generated",
            runtimeRoot,
            cityTomlPath,
          },
        };
        const preview = previewGasCityGeneratedCityConfig(builderState, {
          cityToml: await readTextFileIfPresent(fs, cityTomlPath),
          packToml: await readTextFileIfPresent(fs, packTomlPath),
        });
        dashboard.setStateImmer((draft) => {
          draft.error = null;
          draft.lastCommandOutput = preview.warning;
        });
        return preview;
      },
      scanLocalPack: async (args: { packRefId: string; sourcePath: string }) => {
        const validation = await scanGasCityLocalPack(args);
        dashboard.setStateImmer((draft) => {
          draft.cityBuilder.validationCacheByPackRefId[args.packRefId] =
            validation;
          const matchingPackRef = draft.cityBuilder.localPackRefs.find(
            (packRef) => packRef.id === args.packRefId,
          );
          if (matchingPackRef) {
            matchingPackRef.lastValidatedAt = validation.checkedAt;
          }
          draft.error = validation.errors[0] ?? null;
        });
        return validation;
      },
      setLocalPackEnabled: async (args: {
        packRefId: string;
        enabled: boolean;
      }) => {
        dashboard.setStateImmer((draft) => {
          const packRef = draft.cityBuilder.localPackRefs.find(
            (candidate) => candidate.id === args.packRefId,
          );
          if (!packRef) {
            draft.error = `Local pack ref not found: ${args.packRefId}`;
            return;
          }
          packRef.enabled = args.enabled;
          draft.error = null;
        });
      },
      setOrderSafeOverride: async (args: {
        packRefId: string;
        orderName: string;
        rigName?: string | null;
        enabled?: boolean | null;
        interval?: string | null;
      }) => {
        dashboard.setStateImmer((draft) => {
          const rigName = args.rigName ?? null;
          let override = draft.cityBuilder.orderOverrides.find(
            (candidate) =>
              candidate.packRefId === args.packRefId &&
              candidate.orderName === args.orderName &&
              candidate.rigName === rigName,
          );
          if (!override) {
            override = {
              packRefId: args.packRefId,
              orderName: args.orderName,
              rigName,
              enabled: null,
              interval: null,
            };
            draft.cityBuilder.orderOverrides.push(override);
          }
          if ("enabled" in args) {
            override.enabled = args.enabled ?? null;
          }
          if ("interval" in args) {
            override.interval = args.interval?.trim() || null;
          }
          draft.error = null;
        });
      },
      setAgentSafeOverride: async (args: {
        packRefId: string;
        agentName: string;
        rigName?: string | null;
        minActiveSessions?: number | null;
        maxActiveSessions?: number | null;
        defaultSlingFormula?: string | null;
        providerOptionDefaults?: Record<string, string>;
      }) => {
        dashboard.setStateImmer((draft) => {
          const rigName = args.rigName ?? null;
          let override = draft.cityBuilder.agentOverrides.find(
            (candidate) =>
              candidate.packRefId === args.packRefId &&
              candidate.agentName === args.agentName &&
              candidate.rigName === rigName,
          );
          if (!override) {
            override = {
              packRefId: args.packRefId,
              agentName: args.agentName,
              rigName,
              minActiveSessions: null,
              maxActiveSessions: null,
              defaultSlingFormula: null,
              providerOptionDefaults: {},
            };
            draft.cityBuilder.agentOverrides.push(override);
          }
          if ("minActiveSessions" in args) {
            override.minActiveSessions = args.minActiveSessions ?? null;
          }
          if ("maxActiveSessions" in args) {
            override.maxActiveSessions = args.maxActiveSessions ?? null;
          }
          if ("defaultSlingFormula" in args) {
            override.defaultSlingFormula =
              args.defaultSlingFormula?.trim() || null;
          }
          if (args.providerOptionDefaults) {
            override.providerOptionDefaults = args.providerOptionDefaults;
          }
          draft.error = null;
        });
      },
      refreshSessions: async () =>
        withLoading(async () => {
          return refreshSessionsInternal();
        }),
      refreshStatus: async () =>
        withLoading(async () => {
          const stdout = await runAndStoreOutput(["status"]);
          dashboard.setStateImmer((draft) => {
            draft.statusOutput = stdout;
          });
          return stdout;
        }),
      createSession: async (args: {
        template: string;
        alias?: string;
        title?: string;
      }) =>
        withLoading(async () => {
          const command = [
            "session",
            "new",
            args.template.trim(),
            "--no-attach",
          ];
          if (args.alias?.trim()) {
            command.push("--alias", args.alias.trim());
          }
          if (args.title?.trim()) {
            command.push("--title", args.title.trim());
          }
          const stdout = await runAndStoreOutput(command);
          await refreshSessionsInternal();
          return stdout;
        }),
      bootstrapSessionFromWorkspace: async (args: {
        workspaceId: string;
        workspaceName: string;
        sessionId: string;
        template: string;
        alias?: string;
        title?: string;
        executor: string;
        workingDir?: string;
      }) =>
        withLoading(async () => {
          const command = [
            "session",
            "new",
            args.template.trim(),
            "--no-attach",
          ];
          if (args.alias?.trim()) {
            command.push("--alias", args.alias.trim());
          }
          const title =
            args.title?.trim() ||
            `Bootstrap • ${args.workspaceName.trim() || "Workspace"}`;
          command.push("--title", title);
          const result = await runGc(command, {
            env: {
              VIBE_ADOPT_WORKSPACE_ID: args.workspaceId,
              VIBE_ADOPT_SESSION_ID: args.sessionId,
              VIBE_SESSION_LABEL: title,
              VIBE_EXECUTOR: args.executor.trim(),
              ...(args.workingDir?.trim()
                ? { VIBE_WORKING_DIR: args.workingDir.trim() }
                : {}),
            },
          });
          dashboard.setStateImmer((draft) => {
            draft.lastCommandOutput = [result.stdout, result.stderr]
              .filter(Boolean)
              .join("\n")
              .trim();
            draft.error = null;
          });
          await refreshSessionsInternal();
          return result.stdout;
        }),
      suspendSession: async (args: { sessionId: string }) =>
        withLoading(async () => {
          const stdout = await runAndStoreOutput([
            "session",
            "suspend",
            args.sessionId,
          ]);
          await refreshSessionsInternal();
          return stdout;
        }),
      wakeSession: async (args: { sessionId: string }) =>
        withLoading(async () => {
          const stdout = await runAndStoreOutput([
            "session",
            "wake",
            args.sessionId,
          ]);
          await refreshSessionsInternal();
          return stdout;
        }),
      killSession: async (args: { sessionId: string }) =>
        withLoading(async () => {
          const stdout = await runAndStoreOutput([
            "session",
            "kill",
            args.sessionId,
          ]);
          await refreshSessionsInternal();
          return stdout;
        }),
      submitToSession: async (args: {
        sessionId: string;
        message: string;
        intent?: "default" | "follow_up" | "interrupt_now";
      }) =>
        withLoading(async () => {
          const intent = args.intent ?? "follow_up";
          const stdout = await runAndStoreOutput([
            "session",
            "submit",
            args.sessionId,
            args.message,
            "--intent",
            intent,
          ]);
          await refreshSessionsInternal();
          return stdout;
        }),
      peekSession: async (args: { sessionId: string; lines?: number }) =>
        withLoading(async () => {
          const lines = Math.max(1, Math.min(500, args.lines ?? 120));
          const stdout = await runAndStoreOutput([
            "session",
            "peek",
            args.sessionId,
            "--lines",
            String(lines),
          ]);
          dashboard.setStateImmer((draft) => {
            draft.peekBySessionId[args.sessionId] = stdout;
          });
          return stdout;
        }),
      clearError: () => {
        dashboard.setStateImmer((draft) => {
          draft.error = null;
        });
      },
    });

    return {
      manifest,
      states: {
        dashboard,
      },
      actions,
    } as unknown as GasCityPluginModule;
  },
);
