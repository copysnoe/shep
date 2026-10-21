/**
 * FleetControl — unit tests (spec 111).
 *
 * The container owns four behaviours that are easy to get wrong: stay live off
 * the shared SSE stream rather than the snapshot it was handed, keep a seat on
 * the dashboard when the fleet is empty so it comes back the moment work
 * exists, fall back to loading on the client when the server could not supply a
 * snapshot, and surface a retry instead of a blank corner when the read fails.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { toast } from 'sonner';
import { FleetControl } from '@/components/fleet/fleet-control';
import { AgentEventsContext } from '@/hooks/agent-events-provider';
import type { UseAgentEventsResult } from '@/hooks/use-agent-events';
import {
  FleetTriageCategory,
  FleetTriagePriority,
  NotificationEventType,
  type FleetOverview,
  type FleetTriageItem,
  type NotificationEvent,
} from '@shepai/core/domain/generated/output';

const getFleetData = vi.fn();

vi.mock('@/app/actions/fleet-data', () => ({
  getFleetData: (...args: unknown[]) => getFleetData(...args),
}));

const resumeFleetQueue = vi.fn();

vi.mock('@/app/actions/resume-fleet-queue', () => ({
  resumeFleetQueue: (...args: unknown[]) => resumeFleetQueue(...args),
}));

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

const NOW = '2026-09-11T12:00:00.000Z';

const OVERVIEW: FleetOverview = {
  counts: {
    total: 52,
    cruising: 42,
    queued: 5,
    attentionNeeded: 2,
    failed: 1,
    waitingApproval: 2,
    blockedQuestions: 0,
  },
  circuitBreakerTripped: false,
  activeTriageCount: 1,
  consecutiveFailures: 0,
  timestamp: NOW,
};

const EMPTY_OVERVIEW: FleetOverview = {
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
  activeTriageCount: 0,
};

const PAUSED_OVERVIEW: FleetOverview = {
  ...OVERVIEW,
  queuePaused: {
    pausedAt: '2026-10-21T08:00:00.000Z',
    reason: 'Circuit breaker tripped: 4 consecutive failures',
  },
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
];

/**
 * A minimal SSE context. Only `lastEvent` matters to the fleet bar; the rest of
 * `UseAgentEventsResult` is filled in so the shape stays honest as the hook grows.
 */
function eventsContext(lastEvent: NotificationEvent | null): UseAgentEventsResult {
  return {
    events: lastEvent ? [lastEvent] : [],
    lastEvent,
    agentMessages: [],
    lastAgentMessage: null,
    agentQuestions: [],
    lastAgentQuestion: null,
    supervisorDecisions: [],
    lastSupervisorDecision: null,
    connectionStatus: 'connected',
  };
}

/** A fresh object per call — the hook re-parses each frame, so identity moves. */
function notification(): NotificationEvent {
  return {
    eventType: NotificationEventType.ApplicationUpdated,
    timestamp: NOW,
  } as NotificationEvent;
}

describe('FleetControl', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getFleetData.mockReset();
    getFleetData.mockResolvedValue({ overview: OVERVIEW, triageItems: ITEMS });
    resumeFleetQueue.mockReset();
    resumeFleetQueue.mockResolvedValue({ resumed: true });
  });

  it('paints the server snapshot without calling the action', () => {
    render(<FleetControl initialData={{ overview: OVERVIEW, triageItems: ITEMS }} />);

    expect(screen.getByTestId('fleet-status-bar')).toHaveAttribute('data-state', 'ready');
    expect(screen.getByTestId('fleet-count-attention')).toHaveTextContent('2');
    expect(getFleetData).not.toHaveBeenCalled();
  });

  it('loads on the client when the server supplied no snapshot', async () => {
    render(<FleetControl />);

    expect(screen.getByTestId('fleet-status-bar')).toHaveAttribute('data-state', 'loading');
    await waitFor(() =>
      expect(screen.getByTestId('fleet-status-bar')).toHaveAttribute('data-state', 'ready')
    );
    expect(getFleetData).toHaveBeenCalledTimes(1);
  });

  it('shows a retryable error instead of a blank corner when the read fails', async () => {
    getFleetData.mockReset();
    getFleetData.mockRejectedValueOnce(new Error('container unavailable'));
    getFleetData.mockResolvedValueOnce({ overview: OVERVIEW, triageItems: ITEMS });

    render(<FleetControl />);

    await waitFor(() =>
      expect(screen.getByTestId('fleet-status-bar')).toHaveAttribute('data-state', 'error')
    );
    expect(screen.getByText(/container unavailable/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await waitFor(() =>
      expect(screen.getByTestId('fleet-status-bar')).toHaveAttribute('data-state', 'ready')
    );
  });

  it('opens the triage drawer from the bar', async () => {
    render(<FleetControl initialData={{ overview: OVERVIEW, triageItems: ITEMS }} />);

    fireEvent.click(screen.getByTestId('fleet-open-triage'));

    await waitFor(() =>
      expect(screen.getByText('Waiting on the plan approval gate')).toBeInTheDocument()
    );
  });

  /* ---------------------------------------------------------------- */
  /*  Live — the bar must not disagree with the canvas beside it       */
  /* ---------------------------------------------------------------- */

  describe('live refresh', () => {
    it('re-reads the fleet when a new agent event arrives', async () => {
      const { rerender } = render(
        <AgentEventsContext.Provider value={eventsContext(null)}>
          <FleetControl initialData={{ overview: OVERVIEW, triageItems: ITEMS }} />
        </AgentEventsContext.Provider>
      );

      expect(getFleetData).not.toHaveBeenCalled();

      getFleetData.mockResolvedValue({
        overview: { ...OVERVIEW, counts: { ...OVERVIEW.counts, attentionNeeded: 5 } },
        triageItems: ITEMS,
      });
      rerender(
        <AgentEventsContext.Provider value={eventsContext(notification())}>
          <FleetControl initialData={{ overview: OVERVIEW, triageItems: ITEMS }} />
        </AgentEventsContext.Provider>
      );

      await waitFor(() => expect(getFleetData).toHaveBeenCalledTimes(1));
      await waitFor(() =>
        expect(screen.getByTestId('fleet-count-attention')).toHaveTextContent('5')
      );
    });

    it('re-reads again on each subsequent event', async () => {
      const first = notification();
      const { rerender } = render(
        <AgentEventsContext.Provider value={eventsContext(first)}>
          <FleetControl initialData={{ overview: OVERVIEW, triageItems: ITEMS }} />
        </AgentEventsContext.Provider>
      );
      await waitFor(() => expect(getFleetData).toHaveBeenCalledTimes(1));

      rerender(
        <AgentEventsContext.Provider value={eventsContext(notification())}>
          <FleetControl initialData={{ overview: OVERVIEW, triageItems: ITEMS }} />
        </AgentEventsContext.Provider>
      );

      await waitFor(() => expect(getFleetData).toHaveBeenCalledTimes(2));
    });

    it('does not re-read when nothing on the stream changed', async () => {
      const ctx = eventsContext(notification());
      const { rerender } = render(
        <AgentEventsContext.Provider value={ctx}>
          <FleetControl initialData={{ overview: OVERVIEW, triageItems: ITEMS }} />
        </AgentEventsContext.Provider>
      );
      await waitFor(() => expect(getFleetData).toHaveBeenCalledTimes(1));

      // Three unrelated re-renders with the same event: `load` is stable, so
      // the subscription must not fire again (and must not loop).
      for (let i = 0; i < 3; i += 1) {
        rerender(
          <AgentEventsContext.Provider value={ctx}>
            <FleetControl initialData={{ overview: OVERVIEW, triageItems: ITEMS }} />
          </AgentEventsContext.Provider>
        );
      }

      await new Promise((r) => setTimeout(r, 20));
      expect(getFleetData).toHaveBeenCalledTimes(1);
    });

    it('renders bare, with no SSE provider mounted, instead of throwing', () => {
      expect(() =>
        render(<FleetControl initialData={{ overview: OVERVIEW, triageItems: ITEMS }} />)
      ).not.toThrow();
      expect(screen.getByTestId('fleet-status-bar')).toHaveAttribute('data-state', 'ready');
    });
  });

  /* ---------------------------------------------------------------- */
  /*  Zero state — the bar keeps its seat and comes back               */
  /* ---------------------------------------------------------------- */

  describe('when the fleet is empty', () => {
    it('keeps its seat and says so rather than vanishing', () => {
      render(<FleetControl initialData={{ overview: EMPTY_OVERVIEW, triageItems: [] }} />);

      const bar = screen.getByTestId('fleet-status-bar');
      expect(bar).toHaveAttribute('data-state', 'empty');
      expect(bar).toHaveTextContent('No active features');
    });

    it('comes back with counts as soon as the first feature exists', async () => {
      const { rerender } = render(
        <AgentEventsContext.Provider value={eventsContext(null)}>
          <FleetControl initialData={{ overview: EMPTY_OVERVIEW, triageItems: [] }} />
        </AgentEventsContext.Provider>
      );

      expect(screen.getByTestId('fleet-status-bar')).toHaveAttribute('data-state', 'empty');

      rerender(
        <AgentEventsContext.Provider value={eventsContext(notification())}>
          <FleetControl initialData={{ overview: EMPTY_OVERVIEW, triageItems: [] }} />
        </AgentEventsContext.Provider>
      );

      await waitFor(() =>
        expect(screen.getByTestId('fleet-status-bar')).toHaveAttribute('data-state', 'ready')
      );
      expect(screen.getByTestId('fleet-count-attention')).toHaveTextContent('2');
    });
  });

  /* ---------------------------------------------------------------- */
  /*  Paused queue — a web user must be able to see it and release it  */
  /* ---------------------------------------------------------------- */

  describe('when the admission queue is paused', () => {
    it('shows the pause from the server snapshot', () => {
      render(<FleetControl initialData={{ overview: PAUSED_OVERVIEW, triageItems: ITEMS }} />);

      expect(screen.getByTestId('fleet-queue-paused')).toBeInTheDocument();
      expect(screen.getByTestId('fleet-resume-queue')).toBeInTheDocument();
    });

    it('releases the queue, says so, and re-reads the fleet', async () => {
      // The re-read is what clears the badge: the bar shows the pause the
      // server reports, never an optimistic guess about it.
      getFleetData.mockResolvedValue({ overview: OVERVIEW, triageItems: ITEMS });
      render(<FleetControl initialData={{ overview: PAUSED_OVERVIEW, triageItems: ITEMS }} />);

      fireEvent.click(screen.getByTestId('fleet-resume-queue'));

      await waitFor(() => expect(resumeFleetQueue).toHaveBeenCalledTimes(1));
      await waitFor(() => expect(toast.success).toHaveBeenCalled());
      await waitFor(() =>
        expect(screen.queryByTestId('fleet-queue-paused')).not.toBeInTheDocument()
      );
      expect(getFleetData).toHaveBeenCalled();
    });

    it('toasts the refusal and keeps showing the pause', async () => {
      resumeFleetQueue.mockResolvedValue({
        resumed: false,
        error: 'Settings not found. Please run initialization first.',
      });
      getFleetData.mockResolvedValue({ overview: PAUSED_OVERVIEW, triageItems: ITEMS });
      render(<FleetControl initialData={{ overview: PAUSED_OVERVIEW, triageItems: ITEMS }} />);

      fireEvent.click(screen.getByTestId('fleet-resume-queue'));

      await waitFor(() =>
        expect(toast.error).toHaveBeenCalledWith(
          'Settings not found. Please run initialization first.'
        )
      );
      expect(toast.success).not.toHaveBeenCalled();
      expect(screen.getByTestId('fleet-queue-paused')).toBeInTheDocument();
    });

    it('re-enables Resume once the release settles', async () => {
      let settle: (value: { resumed: boolean }) => void = () => undefined;
      resumeFleetQueue.mockReturnValue(
        new Promise((resolve) => {
          settle = resolve;
        })
      );
      getFleetData.mockResolvedValue({ overview: PAUSED_OVERVIEW, triageItems: ITEMS });
      render(<FleetControl initialData={{ overview: PAUSED_OVERVIEW, triageItems: ITEMS }} />);

      fireEvent.click(screen.getByTestId('fleet-resume-queue'));
      await waitFor(() => expect(screen.getByTestId('fleet-resume-queue')).toBeDisabled());

      settle({ resumed: true });
      await waitFor(() => expect(screen.getByTestId('fleet-resume-queue')).not.toBeDisabled());
    });
  });
});
