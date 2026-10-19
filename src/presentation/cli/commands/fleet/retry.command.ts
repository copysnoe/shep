/**
 * shep fleet retry
 *
 * Restarts the agents behind failures the triage feed already surfaced, in one
 * command: `shep fleet retry --failed`.
 *
 * Scope is required, exactly as it is for `fleet approve`: a bare `shep fleet
 * retry` must never be able to restart the whole fleet by accident.
 *
 * `--failed` covers runs that crashed, failed, **or were stopped by the user** —
 * `StopAgentRunUseCase` writes `interrupted`, the same status a crash
 * reconciliation writes, and nothing in the run record reliably separates them.
 * The help text says so rather than pretending a deliberate stop is a crash.
 *
 * There is no `--ci`. See `RetryFailedFleetFeaturesUseCase` for why: the
 * `ci_failed` feed category cannot be resumed safely, and the flag would have
 * approved a merge gate with failing CI.
 */

import { Command } from 'commander';
import { container } from '@/infrastructure/di/container.js';
import { RetryFailedFleetFeaturesUseCase } from '@/application/use-cases/fleet/retry-failed-fleet-features.use-case.js';
import { colors, fmt, messages, symbols } from '../../ui/index.js';

export function createRetryCommand(): Command {
  return new Command('retry')
    .description('Restart the agents behind failed runs')
    .option('--failed', 'Confirm the scope: runs that crashed, failed or were stopped')
    .option('--repo <path>', 'Restrict the batch to a specific repository path')
    .action(async (options: { failed?: boolean; repo?: string }) => {
      try {
        if (!options.failed) {
          messages.error(
            'Specify --failed to confirm the retry scope — restarting every failed run is destructive, so it is never implicit.'
          );
          process.exitCode = 1;
          return;
        }

        const useCase = container.resolve(RetryFailedFleetFeaturesUseCase);
        const result = await useCase.execute(options.repo ? { repositoryPath: options.repo } : {});

        messages.newline();

        if (result.totalAttempted === 0) {
          messages.info('No failed runs — nothing to retry.');
          messages.newline();
          return;
        }

        const summary = `Retried ${result.retriedCount} of ${result.totalAttempted} failed features.`;
        if (result.retriedCount === 0) {
          // Every candidate refused. A success tick here reads as "done" and is
          // exactly how a batch silently fails.
          messages.warning(summary);
        } else if (result.failedCount === 0) {
          messages.success(summary);
        } else {
          messages.warning(summary);
        }

        // Names, not ids: the operator recognises the name in the feed, and the
        // failure list below has always used names.
        for (const feature of result.retried) {
          console.log(`  ${colors.success(symbols.success)} ${fmt.bold(feature.featureName)}`);
        }

        if (result.failures.length > 0) {
          messages.newline();
          console.log(
            `  ${colors.warning(symbols.warning)} ${result.failures.length} could not be restarted:`
          );
          for (const failure of result.failures) {
            console.log(`    ${fmt.bold(failure.featureName)}: ${colors.muted(failure.reason)}`);
          }
        }

        messages.newline();
      } catch (error) {
        const err = error instanceof Error ? error : new Error(String(error));
        messages.error('Failed to retry fleet features', err);
        process.exitCode = 1;
      }
    });
}
