import { type ToolDefinition, tool } from '@opencode-ai/plugin';
import { sendNtfyNotification } from './notifier';
import type { JobTracker } from './tracker';
import { formatDuration } from './tracker';
import type { NotifyConfig } from './types';

const z = tool.schema;

export function createNotifyTool(
  tracker: JobTracker,
  config: NotifyConfig,
): ToolDefinition {
  return tool({
    description:
      'Send a push notification over ntfy/Telegram reporting job status and outstanding jobs remaining.',
    args: {
      message: z.string().describe('The notification message body or summary'),
      title: z
        .string()
        .optional()
        .describe('Optional custom title for the notification'),
      status: z
        .enum(['completed', 'failed', 'in_progress', 'info'])
        .optional()
        .describe('Status of the job (completed, failed, in_progress, info)'),
    },
    async execute(args, context) {
      const status = (args.status as string) || 'completed';
      let message = (args.message as string) || '';
      message = message.replace(/\\r\\n/g, '\n').replace(/\\n/g, '\n');
      const isError = status === 'failed';
      const priority = isError ? 4 : status === 'in_progress' ? 2 : 3;

      let tag = 'white_check_mark,opencode';
      if (status === 'failed') tag = 'x,warning';
      if (status === 'in_progress') tag = 'hourglass_flowing_sand,opencode';
      if (status === 'info') tag = 'information_source,opencode';

      const outstanding = tracker.getOutstandingJobs(context.sessionID);
      const remainingCount = outstanding.length;

      const lines: string[] = [message, ''];
      if (remainingCount === 0) {
        lines.push('Outstanding Jobs Remaining: 0 (All jobs complete 🎉)');
      } else {
        lines.push(`Outstanding Jobs Remaining: ${remainingCount}`);
        for (const job of outstanding) {
          lines.push(
            `• ${job.title} (${formatDuration(job.durationMs)} elapsed)`,
          );
        }
      }

      const notifTitle =
        (args.title as string) || `OpenCode: Job ${status.toUpperCase()}`;
      const payload = {
        title: notifTitle,
        message: lines.join('\n'),
        priority,
        tags: tag.split(','),
      };

      const result = await sendNtfyNotification(config, payload);
      if (result.success) {
        return `Notification sent successfully to ${config.ntfyUrl}/${config.topic} (forwarded to Telegram).\nOutstanding jobs: ${remainingCount}`;
      } else {
        return `Failed to send notification: ${result.error}`;
      }
    },
  });
}
