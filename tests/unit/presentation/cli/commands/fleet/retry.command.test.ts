/**
 * Fleet Retry Command Unit Tests
 *
 * The exit code is the contract a script reads: `shep fleet retry --failed && …`
 * must not carry on as if the fleet recovered when a feature was left behind.
 *
 * TDD Phase: RED-GREEN
 */

import 'reflect-metadata';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockRetryExecute } = vi.hoisted(() => ({
  mockRetryExecute: vi.fn(),
}));

vi.mock('@/infrastructure/di/container.js', () => ({
  container: { resolve: () => ({ execute: mockRetryExecute }) },
}));

import { createRetryCommand } from '../../../../../../src/presentation/cli/commands/fleet/retry.command.js';

function result(overrides: Record<string, unknown> = {}) {
  return {
    totalAttempted: 0,
    retriedCount: 0,
    retried: [],
    failedCount: 0,
    failures: [],
    ...overrides,
  };
}

async function run(args: string[]): Promise<void> {
  await createRetryCommand().parseAsync(args, { from: 'user' });
}

function printed(spy: ReturnType<typeof vi.spyOn>): string {
  return spy.mock.calls.map((call: unknown[]) => call.join(' ')).join('\n');
}

describe('createRetryCommand', () => {
  let log: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    process.exitCode = undefined;
  });

  it('exits 1 without touching the fleet when --failed is missing', async () => {
    await run([]);

    expect(mockRetryExecute).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(1);
  });

  it('exits 0 when every selected feature restarted', async () => {
    mockRetryExecute.mockResolvedValue(
      result({
        totalAttempted: 1,
        retriedCount: 1,
        retried: [{ featureId: 'a', featureName: 'Alpha' }],
      })
    );

    await run(['--failed']);

    expect(process.exitCode).toBeUndefined();
  });

  it('exits 0 when nothing failed', async () => {
    mockRetryExecute.mockResolvedValue(result());

    await run(['--failed']);

    expect(process.exitCode).toBeUndefined();
  });

  it('exits 1 when part of the batch could not be restarted', async () => {
    mockRetryExecute.mockResolvedValue(
      result({
        totalAttempted: 2,
        retriedCount: 1,
        retried: [{ featureId: 'a', featureName: 'Alpha' }],
        failedCount: 1,
        failures: [{ featureId: 'b', featureName: 'Beta', reason: 'worktree is dirty' }],
      })
    );

    await run(['--failed']);

    expect(process.exitCode).toBe(1);
    expect(printed(log)).toContain('worktree is dirty');
  });

  it('prints the pause once and exits 1 when the queue is parked', async () => {
    const blockedReason =
      'The fleet admission queue is paused, so no agents were restarted. ' +
      'Release it with `shep fleet resume`, then retry.';
    mockRetryExecute.mockResolvedValue(result({ totalAttempted: 3, blockedReason }));

    await run(['--failed']);

    expect(process.exitCode).toBe(1);
    const output = printed(log);
    expect(output.split('shep fleet resume')).toHaveLength(2);
    expect(output).not.toContain('Retried 0 of 3');
  });

  it('passes the repository scope through', async () => {
    mockRetryExecute.mockResolvedValue(result());

    await run(['--failed', '--repo', '/repo/alpha']);

    expect(mockRetryExecute).toHaveBeenCalledWith({ repositoryPath: '/repo/alpha' });
  });
});
