// ============================================================
// Guarded action executor.
//
// The strategy code never touches the page: it hands a Decision to this
// executor, which talks to the table only through a TableDriver. Before the
// single click it re-reads the table and confirms, in order:
//
//   1. execution is armed (authorised mode, no emergency stop)
//   2. no other execution is in flight
//   3. this exact decision point (hand, street, event count) was not acted on before
//   4. the reconstructed state is valid and trusted
//   5. same hand, same street, no new events since the decision was computed
//   6. it is Hero's turn according to BOTH the engine and the table
//   7. the action is legal in the rules engine, amount inside the legal window
//   8. the matching control exists on the page and agrees with the engine
//
// The decision point is recorded as used BEFORE clicking, so an unknown outcome
// can never lead to a second click. Afterwards the table is polled to verify
// the action registered.
// ============================================================

import { ActionKind, legalActions, Street, validateAction } from '../table/engine';
import { TableObs } from './observation';
import { TrackerState } from './tracker';

export interface TableDriver {
  click(kind: 'fold' | 'check' | 'call'): Promise<boolean>;
  /**
   * Type a bet / raise-to amount and submit it. Must read the amount back from
   * the page and refuse to submit on a mismatch. `submitted` is true only when
   * the submit control was actually activated.
   */
  betOrRaise(to: number): Promise<{ submitted: boolean; readBack: number | null; detail: string }>;
}

export interface Fresh { obs: TableObs; state: TrackerState }

export interface ExecRequest {
  action: ActionKind;
  to?: number;
  handId: string;
  street: Street;
  eventCount: number;
}

export type ExecStatus = 'accepted' | 'unverified' | 'rejected' | 'failed';
export interface ExecOutcome { status: ExecStatus; reason: string; clicked: boolean; ms: number }

export interface ExecutorOptions {
  minConfidence?: number;
  verifyTimeoutMs?: number;
  pollMs?: number;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  tolerance?: number;
}

export class GuardedExecutor {
  /** Set by the controller: true only in authorised autonomous mode with no emergency stop. */
  armed = false;
  private busy = false;
  private inFlight: Promise<ExecOutcome> | null = null;
  private readonly used = new Set<string>();
  private readonly o: Required<ExecutorOptions>;
  readonly history: (ExecOutcome & { request: ExecRequest; at: number })[] = [];

  constructor(private readonly driver: TableDriver, private readonly refresh: () => Fresh, opts: ExecutorOptions = {}) {
    this.o = {
      minConfidence: opts.minConfidence ?? 0.7, verifyTimeoutMs: opts.verifyTimeoutMs ?? 3000, pollMs: opts.pollMs ?? 100,
      sleep: opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms))), now: opts.now ?? (() => Date.now()), tolerance: opts.tolerance ?? 0.011,
    };
  }

  static signature(r: Pick<ExecRequest, 'handId' | 'street' | 'eventCount'>): string { return `${r.handId}|${r.street}|${r.eventCount}`; }

  /** Disarm immediately (emergency stop). An execution already past its click cannot be recalled. */
  stop(): void { this.armed = false; }

  private check(req: ExecRequest): { ok: true; fresh: Fresh } | { ok: false; reason: string } {
    if (!this.armed) return { ok: false, reason: 'executor is not armed' };
    let fresh: Fresh;
    try { fresh = this.refresh(); } catch (e) { return { ok: false, reason: `table read failed: ${(e as Error).message}` }; }
    const { obs, state } = fresh;
    const h = state.hand;
    if (!h || !state.valid) return { ok: false, reason: 'no valid hand state' };
    if (state.unsupported) return { ok: false, reason: 'unsupported game' };
    if (state.blockers.length) return { ok: false, reason: `state needs reconciliation: ${state.blockers[0]}` };
    if (state.confidence < this.o.minConfidence) return { ok: false, reason: `state confidence ${state.confidence.toFixed(2)} below ${this.o.minConfidence}` };
    if (h.handId !== req.handId) return { ok: false, reason: 'hand changed' };
    if (h.street !== req.street) return { ok: false, reason: 'street changed' };
    if (state.eventCount !== req.eventCount) return { ok: false, reason: 'state advanced since the decision (stale)' };
    if (state.heroSeat === null || h.toAct !== state.heroSeat) return { ok: false, reason: 'engine: not Hero\'s turn' };
    if (!obs.heroToAct) return { ok: false, reason: 'table: not Hero\'s turn' };
    const err = validateAction(h, { seat: state.heroSeat, kind: req.action, to: req.to });
    if (err) return { ok: false, reason: `illegal action: ${err.message}` };
    const la = legalActions(h)!;
    const c = obs.controls, tol = this.o.tolerance;
    switch (req.action) {
      case 'fold': if (!c.fold) return { ok: false, reason: 'no fold control' }; break;
      case 'check': if (!c.check) return { ok: false, reason: 'no check control' }; break;
      case 'call':
        if (c.call === null) return { ok: false, reason: 'no call control' };
        if (Math.abs(c.call - la.callAmount) > tol) return { ok: false, reason: `call control shows ${c.call}, engine ${la.callAmount}` };
        break;
      case 'bet':
      case 'raise': {
        if (!c.raise) return { ok: false, reason: 'no bet/raise control' };
        const to = req.to as number;
        if (!(to >= la.minRaiseTo - tol || Math.abs(to - la.maxRaiseTo) <= tol) || to > la.maxRaiseTo + tol) return { ok: false, reason: `amount ${to} outside ${la.minRaiseTo}-${la.maxRaiseTo}` };
        if (c.maxRaiseTo !== null && to > c.maxRaiseTo + tol) return { ok: false, reason: `amount ${to} above the table maximum ${c.maxRaiseTo}` };
        if (c.minRaiseTo !== null && to < c.minRaiseTo - tol && Math.abs(to - la.maxRaiseTo) > tol) return { ok: false, reason: `amount ${to} below the table minimum ${c.minRaiseTo}` };
        break;
      }
    }
    return { ok: true, fresh };
  }

  /**
   * Execute one decision. Calls are serialised: a call that arrives while another is still
   * verifying waits for it, then runs its own checks against the fresh table state (so a
   * second request for the SAME decision point is rejected as already acted on).
   */
  async execute(req: ExecRequest): Promise<ExecOutcome> {
    while (this.inFlight) { try { await this.inFlight; } catch { /* its caller handles it */ } }
    const p = this.run(req);
    this.inFlight = p;
    try { return await p; } finally { if (this.inFlight === p) this.inFlight = null; }
  }

  private async run(req: ExecRequest): Promise<ExecOutcome> {
    const t0 = this.o.now();
    const finish = (status: ExecStatus, reason: string, clicked: boolean): ExecOutcome => {
      const out = { status, reason, clicked, ms: this.o.now() - t0 };
      this.history.push({ ...out, request: req, at: t0 });
      if (this.history.length > 200) this.history.shift();
      return out;
    };
    if (this.busy) return finish('rejected', 'another execution is in flight', false);
    const sig = GuardedExecutor.signature(req);
    if (this.used.has(sig)) return finish('rejected', 'this decision point was already acted on', false);
    this.busy = true;
    try {
      const pre = this.check(req);
      if (!pre.ok) return finish('rejected', pre.reason, false);
      this.used.add(sig);
      if (this.used.size > 500) this.used.delete(this.used.values().next().value as string);
      let clicked: boolean;
      if (req.action === 'bet' || req.action === 'raise') {
        const r = await this.driver.betOrRaise(req.to as number);
        clicked = r.submitted;
        if (!r.submitted) {
          // Nothing was submitted, so the decision point is still open for a different action.
          this.used.delete(sig);
          return finish('failed', `bet entry failed: ${r.detail}`, false);
        }
      } else {
        clicked = await this.driver.click(req.action);
        if (!clicked) { this.used.delete(sig); return finish('failed', `${req.action} control could not be clicked`, false); }
      }
      // Verify the table registered the action.
      const deadline = this.o.now() + this.o.verifyTimeoutMs;
      while (this.o.now() < deadline) {
        await this.o.sleep(this.o.pollMs);
        let f: Fresh;
        try { f = this.refresh(); } catch { continue; }
        const h = f.state.hand;
        if (!h || h.handId !== req.handId) return finish('accepted', 'hand moved on after the action', true);
        if (f.state.eventCount > req.eventCount) {
          const ev = h.events[req.eventCount];
          if (ev && ev.seat === f.state.heroSeat && (ev.kind === req.action || (ev.kind === 'call' && ev.allIn))) return finish('accepted', `table shows Hero ${ev.kind}${ev.kind === 'bet' || ev.kind === 'raise' ? ` to ${ev.to}` : ''}`, true);
          return finish('unverified', `next recorded event is seat ${ev?.seat} ${ev?.kind}, expected Hero ${req.action}`, true);
        }
        if (!f.obs.heroToAct && h.toAct !== f.state.heroSeat) return finish('accepted', 'turn passed', true);
      }
      return finish('unverified', 'no confirmation from the table before the timeout', true);
    } finally {
      this.busy = false;
    }
  }
}
