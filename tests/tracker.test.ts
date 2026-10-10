import { beforeEach, describe, expect, it } from 'bun:test';
import { formatDuration, JobTracker } from '../src/tracker';

describe('JobTracker', () => {
  beforeEach(() => {
    JobTracker.clearGlobalDebounce();
  });

  it('formats duration properly', () => {
    expect(formatDuration(500)).toBe('< 1s');
    expect(formatDuration(12000)).toBe('12s');
    expect(formatDuration(60000)).toBe('1m');
    expect(formatDuration(75000)).toBe('1m 15s');
    expect(formatDuration(3600000)).toBe('60m');
  });

  it('tracks a busy session transitioning to idle with 0 outstanding jobs', () => {
    const tracker = new JobTracker('/projects/web');
    tracker.registerSession('session-1', 'Build Frontend', '/projects/web');

    // Start busy
    tracker.onSessionBusy('session-1');

    // Complete
    const result = tracker.onSessionIdle('session-1');
    expect(result).not.toBeNull();
    expect(result!.shouldNotify).toBe(true);
    expect(result!.session.title).toBe('Build Frontend');
    expect(result!.outstanding.length).toBe(0);

    const formatted = tracker.formatNotification(
      result!.session,
      result!.durationMs,
      result!.outstanding,
      false,
    );
    expect(formatted.title).toContain('OpenCode Job Finished: Build Frontend');
    expect(formatted.message).toContain('Outstanding Jobs Remaining: 0');
    expect(formatted.priority).toBe(3);
    expect(formatted.tags).toContain('white_check_mark');
  });

  it('reports outstanding jobs when other sessions are busy', () => {
    const tracker = new JobTracker('/projects/web');
    tracker.registerSession('session-1', 'Build Frontend');
    tracker.registerSession('session-2', 'Run Migrations');

    // Both busy
    tracker.onSessionBusy('session-1');
    tracker.onSessionBusy('session-2');

    // session-1 finishes, session-2 is still busy
    const result = tracker.onSessionIdle('session-1');
    expect(result).not.toBeNull();
    expect(result!.outstanding.length).toBe(1);
    expect(result!.outstanding[0]!.title).toBe('Run Migrations');

    const formatted = tracker.formatNotification(
      result!.session,
      result!.durationMs,
      result!.outstanding,
      false,
    );
    expect(formatted.message).toContain('Outstanding Jobs Remaining: 1');
    expect(formatted.message).toContain('Run Migrations');
  });

  it('handles error state properly with elevated priority', () => {
    const tracker = new JobTracker('/projects/api');
    tracker.registerSession('session-err', 'Database Sync');
    tracker.onSessionBusy('session-err');

    const result = tracker.onSessionError('session-err', 'Connection refused');
    expect(result).not.toBeNull();
    expect(result!.shouldNotify).toBe(true);

    const formatted = tracker.formatNotification(
      result!.session,
      result!.durationMs,
      result!.outstanding,
      true,
      'Connection refused',
    );
    expect(formatted.title).toContain('OpenCode Job Failed: Database Sync');
    expect(formatted.priority).toBe(4);
    expect(formatted.tags).toContain('warning');
    expect(formatted.message).toContain('Error: Connection refused');
  });

  it('suppresses duplicate notifications within debounce window', () => {
    const tracker = new JobTracker();
    tracker.registerSession('session-dup', 'Task A');
    tracker.onSessionBusy('session-dup');

    const first = tracker.onSessionIdle('session-dup');
    expect(first).not.toBeNull();

    // Immediate second call
    const second = tracker.onSessionIdle('session-dup');
    expect(second).toBeNull();
  });
});
