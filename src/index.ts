import { appendFileSync } from 'node:fs';
import type {
  Hooks,
  Plugin,
  PluginInput,
  PluginOptions,
} from '@opencode-ai/plugin';
import { loadConfig } from './config';
import { sendNtfyNotification } from './notifier';
import { createNotifyTool } from './tool';
import { JobTracker } from './tracker';
import type { NotifyConfig } from './types';

interface EventLike {
  id?: string;
  sessionID?: string;
  type?: string;
  title?: string;
  directory?: string;
  location?: { directory?: string };
  data?: {
    id?: string;
    sessionID?: string;
    title?: string;
    directory?: string;
    error?: { message?: string } | string;
  };
  properties?: {
    id?: string;
    sessionID?: string;
    directory?: string;
    error?: { message?: string } | string;
    status?: { type?: string; message?: string } | string;
    info?: {
      id?: string;
      sessionID?: string;
      title?: string;
      directory?: string;
    };
  };
}

interface PluginSetupContext {
  directory?: string;
  options?: Partial<NotifyConfig>;
  event?: {
    subscribe?: (opts?: { signal?: AbortSignal }) => AsyncIterable<EventLike>;
  };
}

const LOG_FILE = '/tmp/opencode-notify.log';

function logDebug(msg: string, data?: unknown) {
  const line = `[${new Date().toISOString()}] ${msg} ${data ? JSON.stringify(data) : ''}\n`;
  try {
    appendFileSync(LOG_FILE, line);
  } catch {}
}

function resolveSessionID(event: EventLike): string | undefined {
  if (!event) return undefined;
  return (
    event.sessionID ??
    event.data?.sessionID ??
    event.data?.id ??
    event.properties?.sessionID ??
    event.properties?.info?.sessionID ??
    event.properties?.info?.id ??
    event.properties?.id ??
    event.id
  );
}

function resolveDirectory(event: EventLike): string | undefined {
  if (!event) return undefined;
  return (
    event.location?.directory ??
    event.data?.directory ??
    event.properties?.info?.directory ??
    event.properties?.directory ??
    event.directory
  );
}

export function createEventHandler(
  tracker: JobTracker,
  config: NotifyConfig,
  getSessionTitle?: (id: string) => Promise<string | undefined>,
) {
  return async (rawEvent: EventLike) => {
    if (!rawEvent) return;
    const type = rawEvent.type;
    if (!type) return;

    const sessionID = resolveSessionID(rawEvent);
    const directory = resolveDirectory(rawEvent);

    if (type.startsWith('session.')) {
      logDebug(`Session event: ${type}`, {
        sessionID,
        directory,
        keys: Object.keys(rawEvent),
        data: rawEvent.data,
      });
    }

    if (!config.enabled) return;

    // Track session created or renamed
    if (
      type === 'session.created' ||
      type === 'session.updated' ||
      type === 'session.renamed'
    ) {
      const title =
        rawEvent.data?.title ??
        rawEvent.properties?.info?.title ??
        rawEvent.title;
      if (sessionID) {
        tracker.registerSession(sessionID, title, directory);
      }
      return;
    }

    // Job execution started
    const statusVal = rawEvent.properties?.status;
    const isBusy =
      statusVal === 'busy' ||
      (typeof statusVal === 'object' &&
        statusVal !== null &&
        statusVal.type === 'busy');

    if (
      type === 'session.execution.started' ||
      type === 'session.step.started' ||
      (type === 'session.status' && isBusy)
    ) {
      if (sessionID) {
        tracker.onSessionBusy(sessionID, undefined, directory);
        logDebug(`Marked busy for: ${sessionID}`);
      }
      return;
    }

    // Job execution succeeded / finished
    const isIdle =
      statusVal === 'idle' ||
      (typeof statusVal === 'object' &&
        statusVal !== null &&
        statusVal.type === 'idle');

    if (
      type === 'session.execution.succeeded' ||
      type === 'session.idle' ||
      (type === 'session.status' && isIdle)
    ) {
      if (sessionID) {
        logDebug(`Processing completion for: ${sessionID} on ${type}`);
        const freshTitle = getSessionTitle
          ? await getSessionTitle(sessionID)
          : undefined;
        const completion = tracker.onSessionIdle(sessionID, freshTitle);
        if (completion?.shouldNotify && config.notifyOnSuccess) {
          logDebug(`Dispatching completion notification for: ${sessionID}`);
          const notif = tracker.formatNotification(
            completion.session,
            completion.durationMs,
            completion.outstanding,
            false,
          );
          const res = await sendNtfyNotification(config, notif);
          logDebug(`Notification dispatch result:`, res);
        }
      }
      return;
    }

    // Job execution failed / interrupted
    if (
      type === 'session.execution.failed' ||
      type === 'session.execution.interrupted' ||
      type === 'session.error'
    ) {
      if (sessionID) {
        logDebug(`Processing error/interrupted for: ${sessionID} on ${type}`);
        const errorData = rawEvent.data?.error ?? rawEvent.properties?.error;
        const errorMsg =
          typeof errorData === 'string'
            ? errorData
            : errorData?.message ||
              (type === 'session.execution.interrupted'
                ? 'Interrupted'
                : JSON.stringify(errorData || {}));

        const completion = tracker.onSessionError(sessionID, errorMsg);
        if (completion?.shouldNotify && config.notifyOnError) {
          const notif = tracker.formatNotification(
            completion.session,
            completion.durationMs,
            completion.outstanding,
            true,
            errorMsg,
          );
          const res = await sendNtfyNotification(config, notif);
          logDebug(`Error notification dispatch result:`, res);
        }
      }
      return;
    }
  };
}

export const notifyPlugin: Plugin = async (
  input: PluginInput,
  options?: PluginOptions,
): Promise<Hooks> => {
  const config: NotifyConfig = loadConfig(options as Partial<NotifyConfig>);
  const tracker = new JobTracker(input.directory || input.worktree || '');

  logDebug(`Plugin notifyPlugin initialized (v1)`, {
    directory: input.directory,
    ntfy: `${config.ntfyUrl}/${config.topic}`,
  });

  const notifyTool = createNotifyTool(tracker, config);

  async function tryResolveSessionTitle(
    sessionID: string,
  ): Promise<string | undefined> {
    try {
      const sessionApi = input.client?.session as
        | {
            get?: (arg: {
              path: { id: string };
            }) => Promise<{ data?: { title?: string } }>;
          }
        | undefined;
      if (sessionApi?.get) {
        const res = await sessionApi.get({ path: { id: sessionID } });
        if (res?.data?.title) {
          return res.data.title;
        }
      }
    } catch {
      // Ignore API errors, use tracked title
    }
    return undefined;
  }

  const handleEvent = createEventHandler(
    tracker,
    config,
    tryResolveSessionTitle,
  );

  const hooks: Hooks = {
    tool: {
      notify_job_status: notifyTool,
    },
    event: async ({ event }) => {
      await handleEvent(event as unknown as EventLike);
    },
  };

  return hooks;
};

export const OpenCodeNotifyPlugin = {
  id: 'opencode-notify',
  server: notifyPlugin,
  setup: async (ctx: PluginSetupContext) => {
    logDebug(`Plugin OpenCodeNotifyPlugin setup invoked (v2)`, {
      hasSubscribe: typeof ctx?.event?.subscribe === 'function',
      directory: ctx?.directory,
    });

    const config = loadConfig(ctx?.options);
    const tracker = new JobTracker(ctx?.directory || '');
    const handleEvent = createEventHandler(tracker, config);

    if (ctx?.event?.subscribe) {
      const subscribe = ctx.event.subscribe;
      const controller = new AbortController();
      void (async () => {
        try {
          for await (const event of subscribe({
            signal: controller.signal,
          })) {
            await handleEvent(event);
          }
        } catch (e: unknown) {
          const errMessage = e instanceof Error ? e.message : String(e);
          logDebug(`Error in event subscription: ${errMessage}`);
        }
      })();
      return () => controller.abort();
    }
  },
};

export default OpenCodeNotifyPlugin;
