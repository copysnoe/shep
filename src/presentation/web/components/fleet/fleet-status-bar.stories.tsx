import type { Meta, StoryObj } from '@storybook/react';
import { FleetStatusBar } from './fleet-status-bar';

/** Stories are inert: a no-op handler keeps the controls clickable without a body. */
const noop = (): void => undefined;

const meta: Meta<typeof FleetStatusBar> = {
  title: 'Fleet/FleetStatusBar',
  component: FleetStatusBar,
  parameters: {
    layout: 'centered',
  },
  tags: ['autodocs'],
};

export default meta;
type Story = StoryObj<typeof meta>;

const HEALTHY = {
  total: 52,
  cruising: 42,
  queued: 5,
  attentionNeeded: 3,
  failed: 2,
  waitingApproval: 3,
  blockedQuestions: 1,
};

export const Default: Story = {
  args: {
    counts: HEALTHY,
    onOpenTriage: noop,
  },
};

/** A fleet with nothing to do still states that, quietly. */
export const AllClear: Story = {
  args: {
    counts: { ...HEALTHY, attentionNeeded: 0, failed: 0, cruising: 47, queued: 5 },
    onOpenTriage: noop,
  },
};

export const CircuitBreakerTripped: Story = {
  args: {
    counts: { ...HEALTHY, attentionNeeded: 7, failed: 6 },
    circuitBreakerTripped: true,
    circuitBreakerReason: 'Consecutive failure threshold reached (4/4 runs failed in the last 15m)',
    onOpenTriage: noop,
  },
};

/**
 * No features in the fleet. This branch was unreachable dead code for as long
 * as `FleetControl` returned `null` at zero; the control now renders through to
 * it, so the bar holds its place instead of disappearing.
 */
export const Empty: Story = {
  args: {
    counts: {
      total: 0,
      cruising: 0,
      queued: 0,
      attentionNeeded: 0,
      failed: 0,
      waitingApproval: 0,
      blockedQuestions: 0,
    },
  },
};

const BREAKER_PAUSE = {
  pausedAt: '2026-10-21T08:00:00.000Z',
  reason: 'Circuit breaker tripped: 4 consecutive feature runs failed',
};

/**
 * A breaker trip parked the admission queue. The bar names the pause — on the
 * web it otherwise reads like a capacity limit — and offers the same release as
 * `shep fleet resume`.
 */
export const QueuePaused: Story = {
  args: {
    counts: { ...HEALTHY, attentionNeeded: 7, failed: 6 },
    circuitBreakerTripped: true,
    circuitBreakerReason: 'Consecutive failure threshold reached (4/4 runs failed in the last 15m)',
    queuePause: BREAKER_PAUSE,
    onResumeQueue: noop,
    onOpenTriage: noop,
  },
};

/** A manual `shep fleet pause` with nothing running: the next start would silently queue. */
export const QueuePausedEmpty: Story = {
  args: {
    counts: {
      total: 0,
      cruising: 0,
      queued: 0,
      attentionNeeded: 0,
      failed: 0,
      waitingApproval: 0,
      blockedQuestions: 0,
    },
    queuePause: { pausedAt: '2026-10-21T08:00:00.000Z', reason: 'Paused for the release freeze' },
    onResumeQueue: noop,
  },
};

/** The release is in flight; Resume is disabled until it settles. */
export const QueueResuming: Story = {
  args: {
    ...QueuePaused.args,
    resumingQueue: true,
  },
};

export const Loading: Story = {
  args: {
    state: 'loading',
  },
};

export const Error: Story = {
  args: {
    state: 'error',
    errorMessage: 'DI container not available. Ensure the CLI bootstrap has initialized it.',
    onRetry: noop,
  },
};
