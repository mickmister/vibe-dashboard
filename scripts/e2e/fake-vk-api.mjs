#!/usr/bin/env node
import http from 'node:http';

const port = Number.parseInt(process.env.PORT || '3000', 10);
const workspaceId = process.env.FAKE_VK_WORKSPACE_ID || 'workspace-1';
const sessionId = process.env.FAKE_VK_SESSION_ID || 'session-1';

const repos = [
  {
    id: 'repo-z',
    name: 'zulu-repo',
    display_name: 'Zulu Repo',
    target_branch: 'main',
  },
  {
    id: 'repo-a',
    name: 'alpha-repo',
    display_name: 'Alpha Repo',
    target_branch: 'main',
  },
];

function sendJson(res, status, data) {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ success: status < 400, data }));
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);

  if (req.method === 'GET' && url.pathname === '/api/workspaces') {
    sendJson(res, 200, [
      {
        id: workspaceId,
        task_id: 'task-1',
        container_ref: '/tmp/workspace-1',
        name: 'Alpha workspace',
        archived: false,
        pinned: false,
      },
    ]);
    return;
  }

  if (req.method === 'GET' && url.pathname === `/api/workspaces/${workspaceId}/repos`) {
    sendJson(res, 200, repos);
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/workspaces/summaries') {
    sendJson(res, 200, {
      summaries: [
        {
          workspace_id: workspaceId,
          latest_session_id: sessionId,
          has_pending_approval: false,
          has_running_dev_server: false,
          has_unseen_turns: false,
          latest_process_status: 'completed',
          files_changed: null,
          lines_added: null,
          lines_removed: null,
          pr_status: null,
        },
      ],
    });
    return;
  }

  if (req.method === 'GET' && url.pathname === '/api/sessions') {
    sendJson(res, 200, [
      {
        id: sessionId,
        workspace_id: workspaceId,
        name: 'E2E session',
      },
    ]);
    return;
  }

  if (req.method === 'PUT' && url.pathname === `/api/workspaces/${workspaceId}/seen`) {
    sendJson(res, 200, null);
    return;
  }

  res.writeHead(404, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ success: false, message: `No fake VK route for ${req.method} ${url.pathname}` }));
});

server.listen(port, '0.0.0.0', () => {
  console.log(`[fake-vk-api] listening on ${port}`);
});
