import type { Meta, StoryObj } from '@storybook/react';
import { FleetControl } from './fleet-control';
import {
  FleetTriageCategory,
  FleetTriagePriority,
  type FleetOverview,
  type FleetTriageItem,
} from '@shepai/core/domain/generated/output';

const meta: Meta<typeof FleetControl> = {
  title: 'Fleet/FleetControl',
  component: FleetControl,
  parameters: {
    layout: 'padded',
  },
  tags: ['autodocs'],
};

export default meta;
type Story = StoryObj<typeof meta>;

const NOW = '2026-09-11T12:00:00.000Z';

const OVERVIEW: FleetOverview = {
  counts: {
    total: 52,
    cruising: 42,
    queued: 5,
    attentionNeeded: 3,
    failed: 2,
    waitingApproval: 3,
    blockedQuestions: 1,
  },
  circuitBreakerTripped: false,
  activeTriageCount: 2,
  consecutiveFailures: 0,
  timestamp: NOW,
};

const ITEMS: FleetTriageItem[] = [
  {
    featureId: 'feat-1',
    featureName: 'Needs Plan Approval',
    slug: 'needs-plan',
    priority: FleetTriagePriority.p1,
    category: FleetTriageCategory.gate,
    reason: 'Waiting on the plan approval gate',
    runId: 'run-1',
    gateType: 'plan',
    createdAt: NOW,
  },
  {
    featureId: 'feat-3',
    featureName: 'CSV Export',
    slug: 'csv-export',
    priority: FleetTriagePriority.p2,
    category: FleetTriageCategory.ci_failed,
    reason: 'CI is failing on the pull request',
    runId: 'run-3',
    createdAt: NOW,
  },
];

/** Server-rendered snapshot: the bar paints immediately, the drawer opens on click. */
export const Default: Story = {
  args: {
    initialData: { overview: OVERVIEW, triageItems: ITEMS },
  },
};

export const CircuitBreakerTripped: Story = {
  args: {
    initialData: {
      overview: {
        ...OVERVIEW,
        counts: { ...OVERVIEW.counts, failed: 6, attentionNeeded: 7 },
        circuitBreakerTripped: true,
        circuitBreakerReason:
          'Consecutive failure threshold reached (4/4 runs failed in the last 15m)',
      },
      triageItems: ITEMS,
    },
  },
};

/**
 * An empty fleet keeps its seat and says so.
 *
 * It used to return `null` here, which meant the bar vanished on the operator's
 * first visit and did not come back when they created their first feature —
 * only a reload brought it back. The quiet "No active features" pill is the
 * honest state, and it is already live, so the counts appear the moment the
 * first run starts.
 */
export const EmptyFleet: Story = {
  args: {
    initialData: {
      overview: {
        ...OVERVIEW,
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
      triageItems: [],
    },
  },
};

/**
 * The admission queue is parked. Resume calls the mocked action, then re-reads
 * the mocked fleet — which reports no pause — so the badge clears the way it does
 * against a real server.
 */
export const QueuePaused: Story = {
  args: {
    initialData: {
      overview: {
        ...OVERVIEW,
        queuePaused: {
          pausedAt: '2026-10-21T08:00:00.000Z',
          reason: 'Circuit breaker tripped: 4 consecutive feature runs failed',
        },
      },
      triageItems: ITEMS,
    },
  },
};
