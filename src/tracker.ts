import { existsSync, readdirSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { OutstandingJob, SessionInfo } from './types';

export function formatDuration(ms: number): string {
  if (ms < 1000) return '< 1s';
  const totalSeconds = Math.round(ms / 1000);
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (seconds === 0) return `${minutes}m`;
  return `${minutes}m ${seconds}s`;
}

function tryAcquireDebounceLock(sessionID: string, windowMs = 5000): boolean {
  const now = Date.now();
  const lastMem = JobTracker.globalLastNotified.get(sessionID);
  if (lastMem && now - lastMem < windowMs) {
    return false;
  }

  const baseDir = tmpdir();
  const lockFile = join(baseDir, `opencode-notify-${sessionID}.lock`);
  try {
    if (existsSync(lockFile)) {
      const stats = statSync(lockFile);
      if (now - stats.mtimeMs < windowMs) {
        return false;
      }
      try {
        unlinkSync(lockFile);
      } catch {}
    }
    writeFileSync(lockFile, String(now), { flag: 'wx' });
    JobTracker.globalLastNotified.set(sessionID, now);
    return true;
  } catch (err: any) {
    if (err && (err.code === 'EEXIST' || err.message?.includes('file already exists'))) {
      return false;
    }
    // If filesystem locking is inaccessible (e.g. sandbox permissions), fall back to in-memory lock
    JobTracker.globalLastNotified.set(sessionID, now);
    return true;
  }
}

export class JobTracker {
  public static globalLastNotified = new Map<string, number>();
  private sessions = new Map<string, SessionInfo>();
  private defaultDirectory: string;

  constructor(defaultDirectory = '') {
    this.defaultDirectory = defaultDirectory;
  }

  public static clearGlobalDebounce() {
    JobTracker.globalLastNotified.clear();
    try {
      const baseDir = tmpdir();
      const tmp = readdirSync(baseDir);
      for (const f of tmp) {
        if (f.startsWith('opencode-notify-') && f.endsWith('.lock')) {
          try {
            unlinkSync(join(baseDir, f));
          } catch {}
        }
      }
    } catch {}
  }

  public setDefaultDirectory(dir: string) {
    this.defaultDirectory = dir;
  }

  public registerSession(sessionID: string, title?: string, directory?: string): SessionInfo {
    let session = this.sessions.get(sessionID);
    const now = Date.now();
    if (!session) {
      session = {
        sessionID,
        title: title || `Session ${sessionID.slice(0, 8)}`,
        directory: directory || this.defaultDirectory,
        status: 'idle',
        startedAt: now,
        lastStatusChangeAt: now,
      };
      this.sessions.set(sessionID, session);
    } else {
      if (title && title !== `Session ${sessionID.slice(0, 8)}`) {
        session.title = title;
      }
      if (directory) {
        session.directory = directory;
      }
    }
    return session;
  }

  public onSessionBusy(sessionID: string, title?: string, directory?: string): SessionInfo {
    const session = this.registerSession(sessionID, title, directory);
    const now = Date.now();
    session.status = 'busy';
    session.startedAt = now;
    session.lastStatusChangeAt = now;
    return session;
  }

  public onSessionError(sessionID: string, errorDetails?: string): {
    shouldNotify: boolean;
    session: SessionInfo;
    durationMs: number;
    outstanding: OutstandingJob[];
  } | null {
    const session = this.sessions.get(sessionID);
    if (!session) return null;

    const now = Date.now();
    const wasBusy = session.status === 'busy';
    session.status = 'error';
    session.lastStatusChangeAt = now;

    if (!wasBusy) {
      return null;
    }

    // Atomic OS-level file lock to prevent duplicate notifications across multi-worker OpenCode processes
    if (!tryAcquireDebounceLock(sessionID, 5000)) {
      return null;
    }

    session.lastNotifiedAt = now;
    const durationMs = now - session.startedAt;
    const outstanding = this.getOutstandingJobs(sessionID);

    return {
      shouldNotify: true,
      session,
      durationMs,
      outstanding,
    };
  }

  public onSessionIdle(sessionID: string, title?: string): {
    shouldNotify: boolean;
    session: SessionInfo;
    durationMs: number;
    outstanding: OutstandingJob[];
  } | null {
    const session = this.registerSession(sessionID, title);
    const now = Date.now();
    const wasBusy = session.status === 'busy';

    session.status = 'idle';
    session.lastStatusChangeAt = now;

    if (!wasBusy) {
      return null;
    }

    // Atomic OS-level file lock to prevent duplicate notifications across multi-worker OpenCode processes
    if (!tryAcquireDebounceLock(sessionID, 5000)) {
      return null;
    }

    session.lastNotifiedAt = now;
    const durationMs = now - session.startedAt;
    const outstanding = this.getOutstandingJobs(sessionID);

    return {
      shouldNotify: true,
      session,
      durationMs,
      outstanding,
    };
  }

  public getOutstandingJobs(excludeSessionID?: string): OutstandingJob[] {
    const now = Date.now();
    const list: OutstandingJob[] = [];

    for (const [id, s] of this.sessions.entries()) {
      if (excludeSessionID && id === excludeSessionID) continue;
      if (s.status === 'busy') {
        list.push({
          sessionID: id,
          title: s.title,
          durationMs: now - s.startedAt,
        });
      }
    }

    return list;
  }

  public formatNotification(
    session: SessionInfo,
    durationMs: number,
    outstanding: OutstandingJob[],
    isError = false,
    errorMessage?: string,
  ): { title: string; message: string; priority: number; tags: string[] } {
    const statusText = isError ? 'Failed ❌' : 'Completed ✅';
    const tagEmoji = isError ? 'x,warning' : 'white_check_mark,opencode';
    const priority = isError ? 4 : 3;

    const notifTitle = isError
      ? `OpenCode Job Failed: ${session.title}`
      : `OpenCode Job Finished: ${session.title}`;

    const lines: string[] = [
      `Job: ${session.title}`,
      `Status: ${statusText}`,
      `Duration: ${formatDuration(durationMs)}`,
    ];

    if (session.directory) {
      const dirName = session.directory.split('/').filter(Boolean).pop() || session.directory;
      lines.push(`Project: ${dirName}`);
    }

    if (isError && errorMessage) {
      lines.push(`Error: ${errorMessage}`);
    }

    lines.push('');
    const remainingCount = outstanding.length;
    if (remainingCount === 0) {
      lines.push('Outstanding Jobs Remaining: 0 (All jobs complete 🎉)');
    } else {
      lines.push(`Outstanding Jobs Remaining: ${remainingCount}`);
      for (const job of outstanding) {
        lines.push(`• ${job.title} (${formatDuration(job.durationMs)} elapsed)`);
      }
    }

    return {
      title: notifTitle,
      message: lines.join('\n'),
      priority,
      tags: tagEmoji.split(','),
    };
  }
}
