'use client';

/**
 * FleetControl (spec 111)
 *
 * Data wiring for the fleet surfaces: renders the pinned status bar and the
 * triage drawer it opens, and keeps both live.
 *
 * The server layout passes `initialData` so the dashboard paints the fleet state
 * on first render; without it the control loads on mount and shows its loading
 * state instead.
 *
 * "Keeps both live" used to be a lie in the header of this file. `load()` ran
 * only when `initialData` was absent, and the dashboard layout always supplies
 * it — so the bar showed the server snapshot forever while the canvas beside it
 * updated from SSE, and the "3 need you" pill visibly disagreed with the nodes
 * next to it. The fix subscribes to the agent event stream that is already
 * open rather than adding a second poll: one SSE connection is shared by every
 * consumer via `AgentEventsProvider`, and a fleet read is cheap next to a
 * dedicated interval that fires whether or not anything happened.
 *
 * The optional context reader is deliberate. The provider wraps the app shell,
 * but this component also renders in Storybook and in unit tests where it is
 * not mounted; `useAgentEventsContext` throws there, `useOptionalAgentEventsContext`
 * returns null and the bar simply stays on whatever snapshot it was given.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { FleetStatusBar, type FleetStatusBarState } from './fleet-status-bar';
import { FleetTriageDrawer } from './fleet-triage-drawer';
import { getFleetData, type FleetData } from '@/app/actions/fleet-data';
import { resumeFleetQueue } from '@/app/actions/resume-fleet-queue';
import { useOptionalAgentEventsContext } from '@/hooks/agent-events-provider';

export interface FleetControlProps {
  /** Fleet snapshot resolved on the server, if the host page provided one. */
  initialData?: FleetData;
  /** Optional repository scope passed through to the server action. */
  repositoryPath?: string;
  className?: string;
}

export function FleetControl({ initialData, repositoryPath, className }: FleetControlProps) {
  const [data, setData] = useState<FleetData | undefined>(initialData);
  const [state, setState] = useState<FleetStatusBarState>(initialData ? 'ready' : 'loading');
  const [error, setError] = useState<string | undefined>(undefined);
  const [refreshing, setRefreshing] = useState(false);
  const [open, setOpen] = useState(false);
  const [resumingQueue, setResumingQueue] = useState(false);

  /** A read is in flight; further triggers collapse into one trailing read. */
  const runningRef = useRef(false);
  const pendingRef = useRef(false);

  const load = useCallback(async (): Promise<void> => {
    // Events arrive in bursts — one busy fleet emits many per second, and an
    // operation-log line is an event like any other. A burst must not become a
    // burst of server actions, so overlapping triggers coalesce into a single
    // trailing read that still reflects whatever arrived while we were busy.
    if (runningRef.current) {
      pendingRef.current = true;
      return;
    }

    runningRef.current = true;
    setRefreshing(true);
    try {
      do {
        pendingRef.current = false;
        try {
          const next = await getFleetData(repositoryPath);
          setData(next);
          setState('ready');
          setError(undefined);
        } catch (err) {
          setState('error');
          setError(err instanceof Error ? err.message : String(err));
        }
      } while (pendingRef.current);
    } finally {
      runningRef.current = false;
      setRefreshing(false);
    }
  }, [repositoryPath]);

  // First client read, only when the server could not supply a snapshot.
  useEffect(() => {
    if (!initialData) {
      void load();
    }
  }, [initialData, load]);

  // The refresh cycle this component always claimed to own: the SSE stream the
  // rest of the dashboard already listens to. `lastEvent` is a freshly parsed
  // object per delivered event, so its identity is the trigger, and `load` is
  // stable for a given `repositoryPath` — together they cannot form a loop.
  const lastEvent = useOptionalAgentEventsContext()?.lastEvent ?? null;
  useEffect(() => {
    if (!lastEvent) return;
    void load();
  }, [lastEvent, load]);

  // Releasing a pause is the web half of `shep fleet resume`. The bar is cleared
  // by the re-read, not optimistically: it must show the pause the server
  // reports, and a refusal leaves the pause exactly where it was.
  const handleResumeQueue = useCallback(async (): Promise<void> => {
    setResumingQueue(true);
    try {
      const result = await resumeFleetQueue();
      if (!result.resumed) {
        toast.error(result.error ?? 'Could not resume the fleet queue');
        return;
      }
      toast.success('Fleet queue resumed — queued features start as slots free up');
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not resume the fleet queue');
    } finally {
      setResumingQueue(false);
    }
  }, [load]);

  return (
    <div className={cn('flex justify-end', className)} data-testid="fleet-control">
      <FleetStatusBar
        counts={data?.overview.counts}
        circuitBreakerTripped={data?.overview.circuitBreakerTripped}
        circuitBreakerReason={data?.overview.circuitBreakerReason}
        queuePause={data?.overview.queuePaused}
        onResumeQueue={() => void handleResumeQueue()}
        resumingQueue={resumingQueue}
        state={state}
        errorMessage={error}
        onOpenTriage={() => setOpen(true)}
        onRetry={() => void load()}
      />
      <FleetTriageDrawer
        items={data?.triageItems ?? []}
        // An empty feed we have not read yet is not an all-clear. Without this
        // the drawer renders "Nothing needs you right now" over a `?? []` that
        // only means the first read has not landed.
        loading={state === 'loading'}
        open={open}
        onOpenChange={setOpen}
        onRefresh={() => void load()}
        refreshing={refreshing}
      />
    </div>
  );
}
