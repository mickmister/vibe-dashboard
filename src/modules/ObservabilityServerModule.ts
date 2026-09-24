import { serverRegistry } from 'springboard/server/register';
import { startVdOtel } from '../server/observability/otel.node';

serverRegistry.registerServerModule(() => {
  startVdOtel();
});
