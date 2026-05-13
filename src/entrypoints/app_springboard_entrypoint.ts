import type { SpringboardRegistry } from 'springboard/core/engine/register';

import { registerWorkspaceModule } from '../modules/workspace_module';

export default function applicationEntrypoint(registry: SpringboardRegistry) {
  registerWorkspaceModule(registry);
}
