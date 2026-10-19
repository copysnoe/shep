'use server';

/**
 * Retry failed fleet features for the triage drawer (spec 111).
 *
 * Thin server action over `RetryFailedFleetFeaturesUseCase` — the same use case
 * `shep fleet retry --failed` runs — so the web drawer and the CLI can never
 * disagree about what "retry the failed ones" does. No business logic lives here:
 * reading the feed, filtering it to the runs that can actually be resumed, and
 * isolating per-feature failures are all the use case's job.
 *
 * The use case is imported as a **type** and resolved by string token, which is
 * the convention every other action in this directory follows (see the note in
 * `fleet-data.ts`): a value import makes Turbopack bundle core's module graph,
 * whose `.js`-suffixed relative imports the Next build cannot resolve.
 *
 * Errors are returned, not thrown. A thrown server-action rejection surfaces in
 * the browser as an opaque digest, and the drawer needs a string it can toast.
 */

import { resolve } from '@/lib/server-container';
import type {
  RetryFailedFleetFeaturesUseCase as RetryFailedFleetFeatures,
  RetryFailedFleetFeaturesInput,
  RetryFailedFleetFeaturesResult,
} from '@shepai/core/application/use-cases/fleet/retry-failed-fleet-features.use-case';

/** The use case's result plus a transport-level failure the drawer can toast. */
export interface RetryFailedFleetFeaturesResponse extends RetryFailedFleetFeaturesResult {
  /** Set when the batch could not be attempted at all. */
  error?: string;
}

const NOTHING_ATTEMPTED: RetryFailedFleetFeaturesResult = {
  totalAttempted: 0,
  retriedCount: 0,
  retried: [],
  failedCount: 0,
  failures: [],
};

/**
 * Restarts the agents behind the features whose runs failed.
 *
 * @param input Optional scope — specific `featureIds` and/or a repository path.
 *              Omit it to retry every failed run in the feed.
 */
export async function retryFailedFleetFeatures(
  input: RetryFailedFleetFeaturesInput = {}
): Promise<RetryFailedFleetFeaturesResponse> {
  try {
    return await resolve<RetryFailedFleetFeatures>('RetryFailedFleetFeaturesUseCase').execute(
      input
    );
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Failed to retry features';
    return { ...NOTHING_ATTEMPTED, error: message };
  }
}
