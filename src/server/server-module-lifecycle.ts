export type ServerCleanup = () => void;

export class ServerModuleLifecycle {
  private cleanups = new Set<ServerCleanup>();

  register(cleanup: ServerCleanup): () => void {
    let active = true;
    const once = () => {
      if (!active) return;
      active = false;
      this.cleanups.delete(once);
      cleanup();
    };
    this.cleanups.add(once);
    return once;
  }

  dispose(): void {
    const current = [...this.cleanups];
    this.cleanups.clear();
    for (const cleanup of current.reverse()) cleanup();
  }
}

const productionLifecycle = new ServerModuleLifecycle();
let installed = false;

function installProductionTeardown(): void {
  if (installed) return;
  installed = true;
  process.once('beforeExit', () => productionLifecycle.dispose());
  process.once('exit', () => productionLifecycle.dispose());
}

installProductionTeardown();
export function registerServerModuleCleanup(cleanup: ServerCleanup): () => void {
  return productionLifecycle.register(cleanup);
}
export function disposeProductionServerModules(): void { productionLifecycle.dispose(); }
