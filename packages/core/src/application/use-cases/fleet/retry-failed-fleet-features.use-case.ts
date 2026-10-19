/**
 * RetryFailedFleetFeaturesUseCase
 *
 * Backs `shep fleet retry --failed` and the triage drawer's Retry action:
 * "restart the 3 that crashed" as one command instead of three.
 *
 * This is deliberately a PROJECTION, not new machinery. It reads the triage feed
 * the operator is already looking at, filters it to the runs that can actually be
 * resumed, and drives each through the existing `ResumeFeatureUseCase` — the same
 * path the web Resume button and `shep feat resume` take. Inventing a second
 * resume path would mean a second place to keep agent identity, worktree sync and
 * capacity accounting correct, and the last time a spawn path was duplicated it
 * silently ran the wrong agent (`LESSONS.md`).
 *
 * ## Why there is no `--ci`
 *
 * The first version offered `--ci`, filtering the feed to `ci_failed`. That
 * category is emitted for **any** feature with a PR and a red CI run, whatever its
 * agent run is doing — and the two states that produces are the two this use case
 * must never touch:
 *
 * - a run parked at the merge gate (`waiting_approval`) is resumed with no
 *   payload, which the worker reads as `{ approved: true }` — a silent approval
 *   of a merge with failing CI, skipping everything `ApproveAgentRunUseCase`
 *   records;
 * - a run that already finished (`completed`) cannot be resumed at all, so the
 *   most common CI failure — agent finished, PR opened, CI went red afterwards —
 *   was reported as "could not be restarted".
 *
 * The only CI-failed features that *were* resumable are those whose run had
 * already failed, which the `crash` category covers. `--ci` could therefore never
 * do anything `--failed` does not already do correctly, so it is gone rather than
 * left as a flag that silently approves gates.
 *
 * Following Clean Architecture:
 * - Application layer use case
 * - Port dependencies via existing use cases: ListFleetTriageItemsUseCase,
 *   ResumeFeatureUseCase
 */

import { injectable, inject } from 'tsyringe';
import type { FleetTriageItem } from '../../../domain/generated/output.js';
import { FleetTriageCategory } from '../../../domain/generated/output.js';
import { ListFleetTriageItemsUseCase } from './list-fleet-triage-items.use-case.js';
import { ResumeFeatureUseCase } from '../features/resume-feature.use-case.js';

/**
 * The one category this retries.
 *
 * Deliberately absent: `gate` and `question` are decisions for a human (approving
 * them is `fleet approve`, and re-running them would bypass the gate entirely),
 * `ci_failed` needs the CI fix loop rather than a resumed agent (see above),
 * `conflict` needs the branch resolved, and `warning` is advisory.
 */
const RETRYABLE_CATEGORY = FleetTriageCategory.crash;

export interface RetryFailedFleetFeaturesInput {
  /** When supplied, only these feature IDs are considered. */
  featureIds?: string[];
  /** Restrict the batch to one repository, matching `fleet triage --repo`. */
  repositoryPath?: string;
}

/** A feature the batch acted on, named the way the operator sees it in the feed. */
export interface FleetRetryOutcome {
  featureId: string;
  featureName: string;
}

export interface FleetRetryFailure extends FleetRetryOutcome {
  /** The refusal reason, verbatim from the resume path. */
  reason: string;
}

export interface RetryFailedFleetFeaturesResult {
  /** How many distinct features the filters selected. */
  totalAttempted: number;
  retriedCount: number;
  /** Features whose agent was restarted, in feed order. */
  retried: FleetRetryOutcome[];
  failedCount: number;
  failures: FleetRetryFailure[];
}

@injectable()
export class RetryFailedFleetFeaturesUseCase {
  constructor(
    @inject(ListFleetTriageItemsUseCase)
    private readonly triage: ListFleetTriageItemsUseCase,
    @inject(ResumeFeatureUseCase)
    private readonly resumeFeature: ResumeFeatureUseCase
  ) {}

  async execute(
    input: RetryFailedFleetFeaturesInput = {}
  ): Promise<RetryFailedFleetFeaturesResult> {
    const items = await this.triage.execute(
      input.repositoryPath === undefined ? {} : { repositoryPath: input.repositoryPath }
    );

    let selected = dedupeByFeature(items.filter((item) => item.category === RETRYABLE_CATEGORY));

    if (input.featureIds && input.featureIds.length > 0) {
      const allowed = new Set(input.featureIds);
      selected = selected.filter((item) => allowed.has(item.featureId));
    }

    const retried: FleetRetryOutcome[] = [];
    const failures: FleetRetryFailure[] = [];

    for (const item of selected) {
      try {
        await this.resumeFeature.execute(item.featureId);
        retried.push({ featureId: item.featureId, featureName: item.featureName });
      } catch (error) {
        // Isolate per feature: one refusal must not strand the rest of the
        // batch, exactly as `fleet approve` isolates per-feature failures.
        failures.push({
          featureId: item.featureId,
          featureName: item.featureName,
          reason: error instanceof Error ? error.message : String(error),
        });
      }
    }

    return {
      totalAttempted: selected.length,
      retriedCount: retried.length,
      retried,
      failedCount: failures.length,
      failures,
    };
  }
}

/**
 * One entry per feature, keeping the first (the feed is already priority-ordered).
 *
 * A feature can hold several triage items at once — a crashed run AND a failing
 * CI check on its PR, for instance. Retrying it twice would put two agents in one
 * worktree on one branch, sharing an agent run and a log file, which is the race
 * `claimSlot` exists to prevent.
 */
function dedupeByFeature(items: FleetTriageItem[]): FleetTriageItem[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    if (seen.has(item.featureId)) return false;
    seen.add(item.featureId);
    return true;
  });
}
