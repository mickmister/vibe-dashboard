import springboard from 'springboard';

import { WorkspaceModule } from '../modules/workspace_module';

export default springboard.entrypoint(async ({ register }) => {
  await register(WorkspaceModule);
});
