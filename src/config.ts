import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { NotifyConfig } from './types';

const DEFAULT_CONFIG: NotifyConfig = {
  ntfyUrl: 'http://localhost:8080',
  topic: 'opencode-jobs',
  enabled: true,
  notifyOnSuccess: true,
  notifyOnError: true,
  minDurationMs: 0,
};

function getConfigFile(): string {
  const configHome = process.env.XDG_CONFIG_HOME || join(homedir(), '.config');
  return join(configHome, 'opencode', 'notify.json');
}

export function loadConfig(options?: Partial<NotifyConfig>): NotifyConfig {
  try {
    const proc = process as unknown as { loadEnvFile?: () => void };
    if (typeof proc.loadEnvFile === 'function') {
      proc.loadEnvFile();
    }
  } catch {}

  let fileConfig: Partial<NotifyConfig> = {};
  const configPath = getConfigFile();

  try {
    if (existsSync(configPath)) {
      const raw = readFileSync(configPath, 'utf-8');
      fileConfig = JSON.parse(raw);
    }
  } catch (err) {
    console.warn(`[opencode-notify] Failed to read ${configPath}:`, err);
  }

  const envConfig: Partial<NotifyConfig> = {};
  const ntfyUrl = process.env.OPENCODE_NTFY_URL || process.env.NTFY_URL;
  if (ntfyUrl) {
    envConfig.ntfyUrl = ntfyUrl;
  }
  const topic = process.env.OPENCODE_NTFY_TOPIC || process.env.NTFY_TOPIC;
  if (topic) {
    envConfig.topic = topic;
  }
  const enabledRaw = process.env.OPENCODE_NTFY_ENABLED ?? process.env.NTFY_ENABLED;
  if (enabledRaw !== undefined) {
    envConfig.enabled = enabledRaw === 'true' || enabledRaw === '1';
  }

  return {
    ...DEFAULT_CONFIG,
    ...fileConfig,
    ...envConfig,
    ...(options || {}),
  };
}
