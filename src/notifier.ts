import type { NotificationPayload, NotifyConfig } from './types';
import https from 'node:https';

export async function sendNtfyNotification(
  config: NotifyConfig,
  payload: NotificationPayload,
): Promise<{ success: boolean; error?: string }> {
  if (!config.enabled) {
    return { success: true };
  }

  const endpoint = `${config.ntfyUrl.replace(/\/+$/, '')}/${encodeURIComponent(config.topic)}`;

  const headers: Record<string, string> = {
    'Content-Type': 'text/plain; charset=utf-8',
    'Title': payload.title,
  };

  if (payload.priority !== undefined) {
    headers['Priority'] = String(payload.priority);
  }

  if (payload.tags && payload.tags.length > 0) {
    headers['Tags'] = payload.tags.join(',');
  }

  const normalizedMessage = payload.message.replace(/\\r\\n/g, '\n').replace(/\\n/g, '\n');

  try {
    // Attempt modern fetch with Bun/Node support
    const res = await fetch(endpoint, {
      method: 'POST',
      body: normalizedMessage,
      headers,
      // Bun tls option:
      // @ts-ignore
      tls: { rejectUnauthorized: false },
    });

    if (!res.ok) {
      const errText = await res.text();
      return { success: false, error: `HTTP ${res.status}: ${errText}` };
    }

    return { success: true };
  } catch (err: any) {
    // Fallback to node:https for strict environments
    try {
      const url = new URL(endpoint);
      const postData = Buffer.from(normalizedMessage, 'utf-8');

      return await new Promise((resolve) => {
        const req = https.request(
          {
            hostname: url.hostname,
            port: url.port || 443,
            path: url.pathname,
            method: 'POST',
            rejectUnauthorized: false,
            headers: {
              ...headers,
              'Content-Length': postData.length,
            },
          },
          (res) => {
            if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
              resolve({ success: true });
            } else {
              resolve({ success: false, error: `HTTP ${res.statusCode}` });
            }
          },
        );

        req.on('error', (e) => {
          resolve({ success: false, error: e.message });
        });

        req.write(postData);
        req.end();
      });
    } catch (fallbackErr: any) {
      return { success: false, error: fallbackErr.message || String(err) };
    }
  }
}
