/**
 * Storybook mock for the fleet retry server action.
 *
 * Mirrors the real action's return shape but never touches the DI container.
 * `@shepai/core` is linked under `src/presentation/web/node_modules` only, so
 * this directory cannot resolve it — the result is spelled out inline rather
 * than imported from the use case, as the sibling `fleet-data.ts` mock does.
 */

interface FleetRetryOutcome {
  featureId: string;
  featureName: string;
}

interface RetryFailedFleetFeaturesResponse {
  totalAttempted: number;
  retriedCount: number;
  retried: FleetRetryOutcome[];
  failedCount: number;
  failures: (FleetRetryOutcome & { reason: string })[];
  blockedReason?: string;
  error?: string;
}

export async function retryFailedFleetFeatures(
  input: { featureIds?: string[]; repositoryPath?: string } = {}
): Promise<RetryFailedFleetFeaturesResponse> {
  const retried = (input.featureIds ?? []).map((featureId) => ({
    featureId,
    featureName: featureId,
  }));

  return {
    totalAttempted: retried.length,
    retriedCount: retried.length,
    retried,
    failedCount: 0,
    failures: [],
  };
}
