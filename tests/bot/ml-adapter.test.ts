// The offline adapter for the existing PokerBench model (sim/bot/ml-adapter.ts). Experimental: the model is not
// used by the active bot, and these tests also pin that.
import * as fs from 'fs';
import * as path from 'path';
import { describe, expect, it } from 'vitest';
import { randomPolicy } from '../../src/bot/sim/policies';
import { playSession, Policy } from '../../src/bot/sim/table';
import { dealBoard, legalActions, validateAction } from '../../src/bot/table/engine';
import type { Spot } from '../../src/core/ml/features';
import { predictPostflop } from '../../src/core/ml/policy';
import { maskMatchesRules, mlAdvice, mlSpot, shiftReport } from '../../sim/bot/ml-adapter';
import { act, mk } from './helpers';

const holdout = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'fixtures', 'postflop-holdout.json'), 'utf8')) as (Spot & { label: number })[];

describe('model adapter', () => {
  it('the loaded model reproduces its recorded agreement with the held-out rows', () => {
    const names = ['fold', 'check', 'call', 'bet', 'raise'];
    const ok = holdout.filter((r) => predictPostflop(r).action === names[r.label]).length;
    expect(ok / holdout.length).toBeGreaterThan(0.83);
    expect(ok / holdout.length).toBeLessThan(0.87);
  });

  it('does not apply before the flop or with more than two players in the hand', () => {
    const pre = mk(3);
    expect(mlSpot(pre, pre.toAct!, [0, 5], legalActions(pre)!)).toBeNull();
    const three = mk(3);
    act(three, 'call'); act(three, 'call'); act(three, 'check');
    dealBoard(three, [8, 21, 34]);
    expect(mlSpot(three, three.toAct!, [0, 5], legalActions(three)!)).toBeNull();
  });

  it('builds the spot with the training definitions: pot includes this street, the bet faced is the raise-to total', () => {
    const h = mk(6);                                  // seats 0..5, button 0; blinds 10/20
    act(h, 'fold'); act(h, 'fold'); act(h, 'raise', 60); act(h, 'fold'); act(h, 'fold'); act(h, 'call'); // seat 5 raises, big blind (seat 2) calls
    dealBoard(h, [8, 21, 34]);
    const bbSeat = h.toAct!;
    const first = mlSpot(h, bbSeat, [0, 5], legalActions(h)!)!;
    expect(first.outside).toEqual([]);
    expect(first.spot).toMatchObject({ street: 'flop', heroPos: 'OOP', facingBet: false, toCallFrac: 0, canCheck: true, canBet: true, canCall: false, canRaise: false, canFold: false, isPreflopAggressor: false });
    expect(first.spot.offeredSizeFrac).toBeCloseTo(0.75, 6);
    act(h, 'check'); act(h, 'bet', 65);              // the raiser bets half the pot of 130
    const facing = mlSpot(h, bbSeat, [0, 5], legalActions(h)!)!;
    expect(facing.potChips).toBe(195);
    expect(facing.spot).toMatchObject({ heroPos: 'OOP', facingBet: true, canCheck: false, canCall: true, canFold: true, canRaise: true, canBet: false, streetBetCount: 1, facedRaiseThisStreet: false });
    expect(facing.spot.toCallFrac).toBeCloseTo(65 / 195, 6);
    const ip = mlSpot(h, h.seats.find((s) => s.dealtIn && !s.folded && s.seat !== bbSeat)!.seat, [1, 6], { ...legalActions(h)!, seat: 0 })!;
    expect(ip.spot.heroPos).toBe('IP');
    expect(ip.spot.isPreflopAggressor).toBe(true);
  });

  it('on a few hundred simulated spots: the model\'s mask equals the rules engine\'s legal actions and its action is always accepted', async () => {
    let seen = 0, outside = 0;
    const spots: Spot[] = [];
    const inner = randomPolicy();
    const probe: Policy = {
      name: 'probe',
      act(view) {
        const m = mlSpot(view.h, view.seat, view.hole, view.la);
        if (m) {
          seen++;
          if (m.outside.length) outside++;
          spots.push(m.spot);
          expect(maskMatchesRules(m.spot, view.la)).toBe(true);
          const a = mlAdvice(view.h, view.seat, view.hole, view.la)!;
          expect(validateAction(view.h, { seat: view.seat, kind: a.action, to: a.to })).toBeNull();
          expect(Object.values(a.probs).reduce((x, y) => x + y, 0)).toBeCloseTo(1, 5);
        }
        return inner.act(view);
      },
    };
    await playSession({ players: [{ playerId: 'probe', policy: probe }, ...['a', 'b', 'c'].map((k) => ({ playerId: k, policy: randomPolicy() }))], hands: 400, seed: 3, smallBlind: 10, bigBlind: 20, startStack: 2000 });
    expect(seen).toBeGreaterThan(150);
    expect(outside).toBeGreaterThan(0);                       // random players limp and shove: reported, not hidden
    const shift = shiftReport(holdout, spots);
    expect(shift.length).toBe(51);
    expect(shift.find((r) => r.feature === 'facing a bet')).toBeDefined();
    expect(shift.every((r) => r.outOfRange >= 0 && r.outOfRange <= 1)).toBe(true);
  }, 120000);

  it('the active bot does not import the model or the adapter', () => {
    const files: string[] = [];
    const walk = (dir: string) => { for (const f of fs.readdirSync(dir, { withFileTypes: true })) { const p = path.join(dir, f.name); if (f.isDirectory()) walk(p); else if (p.endsWith('.ts')) files.push(p); } };
    walk(path.join(__dirname, '..', '..', 'src', 'bot'));
    const offenders = files.filter((f) => /core\/ml\/|ml-adapter/.test(fs.readFileSync(f, 'utf8')));
    expect(offenders).toEqual([]);
  });
});
