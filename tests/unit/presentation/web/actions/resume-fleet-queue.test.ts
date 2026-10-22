/**
 * resumeFleetQueue server action — unit tests.
 *
 * The action is the dashboard's half of `shep fleet resume`: a thin pass-through
 * to `SetFleetQueuePauseUseCase`, resolved by string token. Its whole job is to
 * ask for the queue to be RELEASED — never parked — and to turn a thrown
 * container or use-case error into a value the status bar can toast.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockSetPauseExecute = vi.fn();

vi.mock('@/lib/server-container', () => ({
  resolve: (token: string) => {
    if (token === 'SetFleetQueuePauseUseCase') return { execute: mockSetPauseExecute };
    throw new Error(`Unknown token: ${token}`);
  },
}));

const { resumeFleetQueue } = await import(
  '../../../../../src/presentation/web/app/actions/resume-fleet-queue.js'
);

describe('resumeFleetQueue server action', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('releases the queue through the same use case as `shep fleet resume`', async () => {
    mockSetPauseExecute.mockResolvedValue(null);

    const result = await resumeFleetQueue();

    expect(mockSetPauseExecute).toHaveBeenCalledOnce();
    expect(mockSetPauseExecute).toHaveBeenCalledWith({ paused: false });
    expect(result).toEqual({ resumed: true });
  });

  it('returns the error instead of throwing when the use case refuses', async () => {
    mockSetPauseExecute.mockRejectedValue(
      new Error('Settings not found. Please run initialization first.')
    );

    const result = await resumeFleetQueue();

    expect(result).toEqual({
      resumed: false,
      error: 'Settings not found. Please run initialization first.',
    });
  });

  it('falls back to a readable message for a non-Error rejection', async () => {
    mockSetPauseExecute.mockRejectedValue('boom');

    const result = await resumeFleetQueue();

    expect(result).toEqual({ resumed: false, error: 'Failed to resume the fleet queue' });
  });
});
