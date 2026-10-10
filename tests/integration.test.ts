import { describe, expect, it, mock } from 'bun:test';
import { notifyPlugin } from '../src/index';

describe('OpenCode Notify Plugin Integration', () => {
  it('registers tool and processes session events', async () => {
    let sentPayload: any = null;

    // Mock fetch to intercept ntfy call
    const originalFetch = globalThis.fetch;
    // @ts-ignore
    globalThis.fetch = mock(async (url: string, init?: any) => {
      sentPayload = {
        url,
        body: init?.body,
        headers: init?.headers,
      };
      return new Response(JSON.stringify({ id: 'test-123' }), { status: 200 });
    });

    try {
      const hooks = await notifyPlugin({
        client: {} as any,
        project: {} as any,
        directory: '/Users/sean/projects/opencode-notify',
        worktree: '/Users/sean/projects/opencode-notify',
        experimental_workspace: { register: () => {} },
        serverUrl: new URL('http://localhost:49374'),
        $: {} as any,
      });

      expect(hooks.tool).toBeDefined();
      expect(hooks.tool?.notify_job_status).toBeDefined();
      expect(hooks.event).toBeDefined();

      // 1. Session created
      await hooks.event!({
        event: {
          type: 'session.created',
          properties: {
            info: {
              id: 'sess-integration-1',
              title: 'Build Release Artifacts',
              directory: '/Users/sean/projects/opencode-notify',
            },
          },
        } as any,
      });

      // 2. Session starts work (busy)
      await hooks.event!({
        event: {
          type: 'session.status',
          properties: {
            sessionID: 'sess-integration-1',
            status: { type: 'busy' },
          },
        } as any,
      });

      // 3. Session finishes work (idle)
      await hooks.event!({
        event: {
          type: 'session.status',
          properties: {
            sessionID: 'sess-integration-1',
            status: { type: 'idle' },
          },
        } as any,
      });

      // Give microtask queue a tick
      await new Promise((r) => setTimeout(r, 50));

      expect(sentPayload).not.toBeNull();
      expect(sentPayload.url).toContain('/opencode-jobs');
      expect(sentPayload.headers.Title).toContain('Build Release Artifacts');
      expect(sentPayload.body).toContain('Status: Completed ✅');
      expect(sentPayload.body).toContain('Outstanding Jobs Remaining: 0');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('reports outstanding remaining jobs when another job is still busy', async () => {
    let sentPayload: any = null;

    const originalFetch = globalThis.fetch;
    // @ts-ignore
    globalThis.fetch = mock(async (url: string, init?: any) => {
      sentPayload = {
        url,
        body: init?.body,
        headers: init?.headers,
      };
      return new Response(JSON.stringify({ id: 'test-456' }), { status: 200 });
    });

    try {
      const hooks = await notifyPlugin({
        client: {} as any,
        project: {} as any,
        directory: '/Users/sean/projects/demo',
        worktree: '/Users/sean/projects/demo',
        experimental_workspace: { register: () => {} },
        serverUrl: new URL('http://localhost:49374'),
        $: {} as any,
      });

      // Two sessions created
      await hooks.event!({
        event: {
          type: 'session.created',
          properties: {
            info: { id: 'job-1', title: 'Compile Binary' },
          },
        } as any,
      });

      await hooks.event!({
        event: {
          type: 'session.created',
          properties: {
            info: { id: 'job-2', title: 'Run End-to-End Tests' },
          },
        } as any,
      });

      // Both start running
      await hooks.event!({
        event: {
          type: 'session.status',
          properties: { sessionID: 'job-1', status: { type: 'busy' } },
        } as any,
      });
      await hooks.event!({
        event: {
          type: 'session.status',
          properties: { sessionID: 'job-2', status: { type: 'busy' } },
        } as any,
      });

      // job-1 finishes
      await hooks.event!({
        event: {
          type: 'session.idle',
          properties: { sessionID: 'job-1' },
        } as any,
      });

      await new Promise((r) => setTimeout(r, 50));

      expect(sentPayload).not.toBeNull();
      expect(sentPayload.body).toContain('Outstanding Jobs Remaining: 1');
      expect(sentPayload.body).toContain('Run End-to-End Tests');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
