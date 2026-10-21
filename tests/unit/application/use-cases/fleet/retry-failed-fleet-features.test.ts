/**
 * RetryFailedFleetFeaturesUseCase Unit Tests
 *
 * `shep fleet retry --failed` is a projection: it reads the triage feed the
 * operator is already looking at, filters it to the runs that can actually be
 * resumed, and drives each through the EXISTING `ResumeFeatureUseCase`. It
 * invents no second resume path — the whole value is that "restart the 3 that
 * crashed" is one command instead of three.
 *
 * Properties that matter:
 *  - a feature parked at a merge gate is NEVER resumed (the `--ci` bug)
 *  - `ci_failed` alone never selects a feature, whatever its run is doing
 *  - a feature appears ONCE even when the feed lists it more than once
 *  - one failing resume does not strand the rest of the batch
 *  - a parked queue refuses the batch ONCE, before any resume is attempted
 *
 * TDD Phase: RED-GREEN-REFACTOR
 */

import 'reflect-metadata';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { RetryFailedFleetFeaturesUseCase } from '@/application/use-cases/fleet/retry-failed-fleet-features.use-case.js';
import { FleetTriageCategory, FleetTriagePriority } from '@/domain/generated/output.js';
import type { FleetTriageItem } from '@/domain/generated/output.js';

function item(
  featureId: string,
  category: FleetTriageCategory,
  overrides: Partial<FleetTriageItem> = {}
): FleetTriageItem {
  return {
    featureId,
    featureName: `Feature ${featureId}`,
    slug: `feat-${featureId}`,
    priority: FleetTriagePriority.p2,
    category,
    reason: `${category} happened`,
    createdAt: '2026-03-01T12:00:00Z',
    ...overrides,
  };
}

describe('RetryFailedFleetFeaturesUseCase', () => {
  let triage: { execute: ReturnType<typeof vi.fn> };
  let resume: { execute: ReturnType<typeof vi.fn> };
  let capacity: { isPaused: ReturnType<typeof vi.fn> };
  let useCase: RetryFailedFleetFeaturesUseCase;

  beforeEach(() => {
    triage = { execute: vi.fn().mockResolvedValue([]) };
    resume = {
      execute: vi.fn().mockResolvedValue({
        feature: { id: 'f1' },
        newRun: { id: 'r-new' },
      }),
    };
    capacity = { isPaused: vi.fn().mockResolvedValue(false) };
    useCase = new RetryFailedFleetFeaturesUseCase(
      triage as never,
      resume as never,
      capacity as never
    );
  });

  describe('selection', () => {
    /**
     * The regression this whole category filter exists for.
     *
     * `ci_failed` is emitted for any feature with a PR and a red CI run, whatever
     * its agent run is doing — and the usual case is a feature parked at the
     * merge gate. `ResumeFeatureUseCase` reads a missing resume payload as
     * `{ approved: true }`, so a `--ci` retry approved the merge gate of a PR
     * with failing CI, skipping everything `ApproveAgentRunUseCase` records.
     */
    it('never resumes a feature parked at a merge gate, even when its CI is red', async () => {
      triage.execute.mockResolvedValue([
        item('gate-1', FleetTriageCategory.gate, { priority: FleetTriagePriority.p1 }),
        item('gate-1', FleetTriageCategory.ci_failed),
      ]);

      const result = await useCase.execute();

      expect(result.retried).toEqual([]);
      expect(result.totalAttempted).toBe(0);
      expect(resume.execute).not.toHaveBeenCalled();
    });

    it('never selects a feature on ci_failed alone', async () => {
      // The second half of the same bug: for a run that already completed there
      // is nothing to resume at all, so `--ci` reported "could not be restarted"
      // for the most common CI failure.
      triage.execute.mockResolvedValue([item('ci-1', FleetTriageCategory.ci_failed)]);

      const result = await useCase.execute();

      expect(result.retried).toEqual([]);
      expect(resume.execute).not.toHaveBeenCalled();
    });

    it('retries a feature whose CI is red AND whose run failed', async () => {
      // The overlap case is the safe one: the run genuinely failed, so the crash
      // item selects it. That is the only CI-red feature `--failed` ever retried
      // too, which is why dropping `--ci` lost nothing.
      triage.execute.mockResolvedValue([
        item('both-1', FleetTriageCategory.ci_failed),
        item('both-1', FleetTriageCategory.crash),
      ]);

      const result = await useCase.execute();

      expect(result.retried.map((outcome) => outcome.featureId)).toEqual(['both-1']);
      expect(resume.execute).toHaveBeenCalledOnce();
    });

    it('retries crashed runs, with their names', async () => {
      triage.execute.mockResolvedValue([
        item('ci-1', FleetTriageCategory.ci_failed),
        item('crash-1', FleetTriageCategory.crash),
      ]);

      const result = await useCase.execute();

      expect(result.retried).toEqual([{ featureId: 'crash-1', featureName: 'Feature crash-1' }]);
      expect(resume.execute).toHaveBeenCalledWith('crash-1');
    });

    it('never retries a gate, question, conflict or warning', async () => {
      // Gates and questions are decisions for a human — approving them is
      // `fleet approve`, and re-running them would bypass the gate entirely.
      triage.execute.mockResolvedValue([
        item('gate-1', FleetTriageCategory.gate),
        item('question-1', FleetTriageCategory.question),
        item('conflict-1', FleetTriageCategory.conflict),
        item('warn-1', FleetTriageCategory.warning),
      ]);

      const result = await useCase.execute();

      expect(result.retried).toEqual([]);
      expect(resume.execute).not.toHaveBeenCalled();
    });

    it('retries each feature once even when the feed lists it twice', async () => {
      // A feature can hold several triage items at once (a crash AND a failing
      // CI check on its PR). Retrying it twice would spawn two agents in one
      // worktree on one branch — the exact race `claimSlot` exists to prevent.
      triage.execute.mockResolvedValue([
        item('dup-1', FleetTriageCategory.crash),
        item('dup-1', FleetTriageCategory.crash, { reason: 'again' }),
      ]);

      const result = await useCase.execute();

      expect(result.retried.map((outcome) => outcome.featureId)).toEqual(['dup-1']);
      expect(resume.execute).toHaveBeenCalledOnce();
    });

    it('retries nothing when the feed is empty', async () => {
      const result = await useCase.execute();

      expect(result).toMatchObject({
        totalAttempted: 0,
        retriedCount: 0,
        retried: [],
        failedCount: 0,
        failures: [],
      });
      expect(resume.execute).not.toHaveBeenCalled();
    });

    it('passes the repository scope through to the feed', async () => {
      await useCase.execute({ repositoryPath: '/repo/alpha' });

      expect(triage.execute).toHaveBeenCalledWith({ repositoryPath: '/repo/alpha' });
    });

    it('narrows to specific feature ids, which is how the drawer retries one row', async () => {
      triage.execute.mockResolvedValue([
        item('a', FleetTriageCategory.crash),
        item('b', FleetTriageCategory.crash),
      ]);

      const result = await useCase.execute({ featureIds: ['b'] });

      expect(result.retried.map((outcome) => outcome.featureId)).toEqual(['b']);
      expect(resume.execute).toHaveBeenCalledOnce();
      expect(resume.execute).toHaveBeenCalledWith('b');
    });

    it('retries nothing when featureIds is an empty list', async () => {
      // An explicit list is a selection, and an empty selection selects nothing.
      // Reading `[]` as "no filter" turned a caller with nothing rendered — or a
      // stale, emptied list — into "restart every failed agent in the fleet".
      // Omitting `featureIds` is the only way to ask for all of them.
      triage.execute.mockResolvedValue([item('a', FleetTriageCategory.crash)]);

      const result = await useCase.execute({ featureIds: [] });

      expect(result.totalAttempted).toBe(0);
      expect(result.retried).toEqual([]);
      expect(resume.execute).not.toHaveBeenCalled();
    });

    it('retries every failed run when featureIds is omitted', async () => {
      triage.execute.mockResolvedValue([
        item('a', FleetTriageCategory.crash),
        item('b', FleetTriageCategory.crash),
      ]);

      const result = await useCase.execute({});

      expect(result.retried.map((outcome) => outcome.featureId)).toEqual(['a', 'b']);
    });

    it('cannot reach a feature the feed does not list', async () => {
      // `featureIds` narrows the feed's selection, it does not bypass it: a
      // caller cannot name an arbitrary feature and have its agent restarted.
      triage.execute.mockResolvedValue([item('a', FleetTriageCategory.crash)]);

      const result = await useCase.execute({ featureIds: ['not-in-the-feed'] });

      expect(result.retried).toEqual([]);
      expect(resume.execute).not.toHaveBeenCalled();
    });
  });

  describe('isolation', () => {
    it('keeps retrying the rest when one resume throws', async () => {
      triage.execute.mockResolvedValue([
        item('a', FleetTriageCategory.crash),
        item('b', FleetTriageCategory.crash),
        item('c', FleetTriageCategory.crash),
      ]);
      resume.execute
        .mockResolvedValueOnce({ feature: { id: 'a' }, newRun: { id: 'ra' } })
        .mockRejectedValueOnce(new Error('Agent is still running — stop it first before resuming'))
        .mockResolvedValueOnce({ feature: { id: 'c' }, newRun: { id: 'rc' } });

      const result = await useCase.execute();

      expect(result.retried.map((outcome) => outcome.featureId)).toEqual(['a', 'c']);
      expect(result.totalAttempted).toBe(3);
      expect(result.failedCount).toBe(1);
      expect(result.failures).toEqual([
        {
          featureId: 'b',
          featureName: 'Feature b',
          reason: expect.stringContaining('still running'),
        },
      ]);
    });

    it('reports a failure without throwing when every resume fails', async () => {
      triage.execute.mockResolvedValue([item('a', FleetTriageCategory.crash)]);
      resume.execute.mockRejectedValue(new Error('boom'));

      const result = await useCase.execute();

      expect(result.retried).toEqual([]);
      expect(result.retriedCount).toBe(0);
      expect(result.failedCount).toBe(1);
      expect(result.failures).toHaveLength(1);
    });
  });

  describe('a paused admission queue', () => {
    /**
     * While the queue is parked, `claimSlot` refuses every resume, so attempting
     * the batch produced one identical "the queue is paused" failure per feature
     * — twenty lines in the CLI, one enormous toast in the drawer. The pause is a
     * property of the fleet, not of any feature, so it is reported once.
     */
    it('refuses the batch once, without attempting a single resume', async () => {
      capacity.isPaused.mockResolvedValue(true);
      triage.execute.mockResolvedValue([
        item('a', FleetTriageCategory.crash),
        item('b', FleetTriageCategory.crash),
      ]);

      const result = await useCase.execute();

      expect(resume.execute).not.toHaveBeenCalled();
      expect(result).toMatchObject({
        totalAttempted: 2,
        retriedCount: 0,
        retried: [],
        failedCount: 0,
        failures: [],
      });
      expect(result.blockedReason).toContain('paused');
      expect(result.blockedReason).toContain('shep fleet resume');
    });

    it('reports nothing to retry, not a pause, when nothing failed', async () => {
      // "No failed runs" is the true answer; blaming the pause would send the
      // operator to release a queue that is blocking nothing they asked for.
      capacity.isPaused.mockResolvedValue(true);
      triage.execute.mockResolvedValue([item('ci-1', FleetTriageCategory.ci_failed)]);

      const result = await useCase.execute();

      expect(result.totalAttempted).toBe(0);
      expect(result.blockedReason).toBeUndefined();
    });

    it('sets no blockedReason when the queue is admitting', async () => {
      triage.execute.mockResolvedValue([item('a', FleetTriageCategory.crash)]);

      const result = await useCase.execute();

      expect(result.retriedCount).toBe(1);
      expect(result.blockedReason).toBeUndefined();
    });
  });

  it('surfaces the underlying refusal reason verbatim', async () => {
    // The reason `ResumeFeatureUseCase` gives is already the most specific thing
    // known about why a feature could not restart; re-wording it here would
    // throw that away.
    triage.execute.mockResolvedValue([item('a', FleetTriageCategory.crash)]);
    resume.execute.mockRejectedValue(new Error('Feature "a" is missing specPath — cannot resume'));

    const result = await useCase.execute();

    expect(result.failures[0]?.reason).toBe('Feature "a" is missing specPath — cannot resume');
  });
});
