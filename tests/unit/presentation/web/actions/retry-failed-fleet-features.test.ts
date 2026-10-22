/**
 * retryFailedFleetFeatures server action — unit tests.
 *
 * The action is a thin pass-through to `RetryFailedFleetFeaturesUseCase`, the same
 * use case `shep fleet retry --failed` runs. Its whole job is to resolve the use
 * case by token, forward the scope, and turn a thrown container/use-case error
 * into a value the drawer can toast instead of an unhandled rejection.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockRetryExecute = vi.fn();

vi.mock('@/lib/server-container', () => ({
  resolve: (token: string) => {
    if (token === 'RetryFailedFleetFeaturesUseCase') return { execute: mockRetryExecute };
    throw new Error(`Unknown token: ${token}`);
  },
}));

const { retryFailedFleetFeatures } = await import(
  '../../../../../src/presentation/web/app/actions/retry-failed-fleet-features.js'
);

describe('retryFailedFleetFeatures server action', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('forwards the selected feature ids to the retry use case', async () => {
    mockRetryExecute.mockResolvedValue({
      totalAttempted: 2,
      retriedCount: 2,
      retried: [
        { featureId: 'feat-1', featureName: 'First' },
        { featureId: 'feat-2', featureName: 'Second' },
      ],
      failedCount: 0,
      failures: [],
    });

    const result = await retryFailedFleetFeatures({ featureIds: ['feat-1', 'feat-2'] });

    expect(mockRetryExecute).toHaveBeenCalledWith({ featureIds: ['feat-1', 'feat-2'] });
    expect(result).toEqual({
      totalAttempted: 2,
      retriedCount: 2,
      retried: [
        { featureId: 'feat-1', featureName: 'First' },
        { featureId: 'feat-2', featureName: 'Second' },
      ],
      failedCount: 0,
      failures: [],
    });
  });

  it('retries every failed run when no ids are supplied', async () => {
    mockRetryExecute.mockResolvedValue({
      totalAttempted: 3,
      retriedCount: 3,
      retried: [],
      failedCount: 0,
      failures: [],
    });

    await retryFailedFleetFeatures();

    expect(mockRetryExecute).toHaveBeenCalledWith({});
  });

  it('reports per-feature failures without failing the whole call', async () => {
    mockRetryExecute.mockResolvedValue({
      totalAttempted: 2,
      retriedCount: 1,
      retried: [{ featureId: 'feat-1', featureName: 'First' }],
      failedCount: 1,
      failures: [{ featureId: 'feat-2', featureName: 'Second', reason: 'worktree is dirty' }],
    });

    const result = await retryFailedFleetFeatures({ featureIds: ['feat-1', 'feat-2'] });

    expect(result.retriedCount).toBe(1);
    expect(result.failures).toEqual([
      { featureId: 'feat-2', featureName: 'Second', reason: 'worktree is dirty' },
    ]);
    expect(result.error).toBeUndefined();
  });

  it('turns a thrown error into an error result rather than rejecting', async () => {
    mockRetryExecute.mockRejectedValue(new Error('DI container not available'));

    const result = await retryFailedFleetFeatures({ featureIds: ['feat-1'] });

    expect(result).toEqual({
      totalAttempted: 0,
      retriedCount: 0,
      retried: [],
      failedCount: 0,
      failures: [],
      error: 'DI container not available',
    });
  });
});
