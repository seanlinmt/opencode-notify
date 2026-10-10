export interface NotifyConfig {
  ntfyUrl: string;
  topic: string;
  enabled: boolean;
  notifyOnSuccess: boolean;
  notifyOnError: boolean;
  minDurationMs: number;
}

export interface SessionInfo {
  sessionID: string;
  title: string;
  directory: string;
  status: 'busy' | 'idle' | 'retry' | 'error';
  startedAt: number;
  lastNotifiedAt?: number;
  lastStatusChangeAt: number;
}

export interface OutstandingJob {
  sessionID: string;
  title: string;
  durationMs: number;
}

export interface NotificationPayload {
  title: string;
  message: string;
  priority?: number;
  tags?: string[];
}
