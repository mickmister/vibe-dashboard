import {serverRegistry} from 'springboard/server/register';

serverRegistry.registerServerModule(({hono}) => {
  hono.get('/vk-api/workspaces', async c => {
    const url = `${process.env.VIBE_API_URL}/api/workspaces`;
    return fetch(url);
  });
});
