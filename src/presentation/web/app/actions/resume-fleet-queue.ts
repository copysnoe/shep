'use server';

/**
 * Release the parked fleet admission queue from the dashboard (spec 111).
 *
 * Thin server action over `SetFleetQueuePauseUseCase` — the same use case
 * `shep fleet resume` runs — so the status bar's Resume button and the CLI can
 * never disagree about what releasing the queue does (clear the pause,
 * acknowledge the breaker trip, drain whatever now has room). No business logic
 * lives here.
 *
 * It only ever RELEASES. Parking the queue stays with `shep fleet pause` and the
 * circuit breaker; the web surface exists so a web user is never stranded behind
 * a pause they cannot see or clear (`LESSONS.md`, "No CLI-Only Flows in the Web
 * UI").
 *
 * The use case is imported as a **type** and resolved by string token, which is
 * the convention every other action in this directory follows (see the note in
 * `fleet-data.ts`): a value import makes Turbopack bundle core's module graph,
 * whose `.js`-suffixed relative imports the Next build cannot resolve.
 *
 * Errors are returned, not thrown. A thrown server-action rejection surfaces in
 * the browser as an opaque digest, and the bar needs a string it can toast.
 */

import { resolve } from '@/lib/server-container';
import type { SetFleetQueuePauseUseCase as SetFleetQueuePause } from '@shepai/core/application/use-cases/fleet/set-fleet-queue-pause.use-case';

export interface ResumeFleetQueueResponse {
  /** True once the pause is cleared and the queue is draining again. */
  resumed: boolean;
  /** Set when the queue could not be released. */
  error?: string;
}

/** Clears the admission-queue pause, as `shep fleet resume` does. */
export async function resumeFleetQueue(): Promise<ResumeFleetQueueResponse> {
  try {
    await resolve<SetFleetQueuePause>('SetFleetQueuePauseUseCase').execute({ paused: false });
    return { resumed: true };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Failed to resume the fleet queue';
    return { resumed: false, error: message };
  }
}
