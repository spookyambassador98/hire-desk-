type HarvestControlState = {
  stopRequested: boolean;
  stopAbort: AbortController | null;
  pauseUntil: number;
  activeRun: Promise<void> | null;
};

const g = globalThis as typeof globalThis & {
  __hireDeskHarvestControl?: HarvestControlState;
};

function state(): HarvestControlState {
  if (!g.__hireDeskHarvestControl) {
    g.__hireDeskHarvestControl = {
      stopRequested: false,
      stopAbort: new AbortController(),
      pauseUntil: 0,
      activeRun: null,
    };
  }
  return g.__hireDeskHarvestControl;
}

const MANUAL_PAUSE_MS = 6 * 60 * 60 * 1000;

export function getStopAbortSignal(): AbortSignal | undefined {
  return state().stopAbort?.signal;
}

export function getActiveRun() {
  return state().activeRun;
}

export function setActiveRun(run: Promise<void> | null) {
  state().activeRun = run;
}

export function isHarvestPaused() {
  return Date.now() < state().pauseUntil;
}

export function pauseRemainingMs() {
  return Math.max(0, state().pauseUntil - Date.now());
}

export function isHarvestStopRequested() {
  return state().stopRequested;
}

export function beginManualRun() {
  const s = state();
  s.stopRequested = false;
  s.pauseUntil = 0;
  try {
    s.stopAbort?.abort();
  } catch {
    /* ignore */
  }
  s.stopAbort = new AbortController();
}

export function requestHarvestStop() {
  const s = state();
  s.stopRequested = true;
  s.pauseUntil = Date.now() + MANUAL_PAUSE_MS;
  try {
    s.stopAbort?.abort();
  } catch {
    /* ignore */
  }
}

/** Next auto-wave after time budget — never clears STOP pause. */
export function beginContinueRun(): boolean {
  const s = state();
  if (Date.now() < s.pauseUntil) return false;
  s.stopRequested = false;
  try {
    s.stopAbort?.abort();
  } catch {
    /* ignore */
  }
  s.stopAbort = new AbortController();
  return true;
}
