/**
 * Storybook mock for the fleet resume server action.
 *
 * Mirrors the real action's return shape but never touches the DI container.
 * `@shepai/core` is linked under `src/presentation/web/node_modules` only, so
 * this directory cannot resolve it — the response is spelled out inline, as the
 * sibling `fleet-data.ts` mock does.
 */

interface ResumeFleetQueueResponse {
  resumed: boolean;
  error?: string;
}

export async function resumeFleetQueue(): Promise<ResumeFleetQueueResponse> {
  return { resumed: true };
}
