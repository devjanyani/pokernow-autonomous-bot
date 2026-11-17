// The simulator's reference evaluator (sim/bot/reference.ts) and the independent benchmark opponents.
import * as fs from 'fs';
import * as path from 'path';
import { describe, expect, it } from 'vitest';
import { CardId, parseCardStrict } from '../../src/bot/cards';
import { evaluateHand } from '../../src/core/equity/hand-eval';
import { INDEPENDENT_FACTORIES } from '../../src/bot/sim/independent';
import { callingStationPolicy, POLICY_FACTORIES } from '../../src/bot/sim/policies';
import { playSession, Policy, PolicyView } from '../../src/bot/sim/table';
import { dealBoard, HandState } from '../../src/bot/table/engine';
import { pairedDiff, referenceValues, RefSpot } from '../../sim/bot/reference';
import { act, mk } from './helpers';

const cards = (s: string): CardId[] => s.split(' ').map((c) => parseCardStrict(c) as CardId);
const pair = (s: string) => cards(s) as [CardId, CardId];

/** Heads-up, blinds 10/20, limped pot of 40, checked to the given street. Seat 1 (big blind) is the measured seat and acts first. */
function limped(board: string): HandState {
  const h = mk(2);
  act(h, 'call'); act(h, 'check');
  const b = cards(board);
  dealBoard(h, b.slice(0, 3));
  for (let i = 3; i < b.length; i++) { act(h, 'check'); act(h, 'check'); dealBoard(h, [b[i]]); }
  return h;
}
const station = callingStationPolicy();
const spot = (h: HandState, hero: string, villain: string, continuation: Policy = station): RefSpot =>
  ({ h, heroSeat: 1, holes: new Map([[1, pair(hero)], [0, pair(villain)]]), policies: new Map([[0, station]]), continuation });

describe('reference evaluator: exact cases', () => {
  it('river against a player who always calls: the value is the pot plus the bet with the best hand, minus the bet with the worst', async () => {
    const h = limped('Ks 7d 2c 9h 3s');
    expect(h.toAct).toBe(1);
    const win = await referenceValues(spot(h, 'Kh Kd', 'Qh Jh'), [{ kind: 'check' }, { kind: 'bet', to: 100 }, { kind: 'bet', to: 400 }], { seed: 1 });
    expect(win.map((v) => [v.mean, v.se, v.chanceExact])).toEqual([[40, 0, true], [140, 0, true], [440, 0, true]]);
    const lose = await referenceValues(spot(h, 'Qh Jh', 'Kh Kd'), [{ kind: 'check' }, { kind: 'bet', to: 100 }], { seed: 1 });
    expect(lose.map((v) => v.mean)).toEqual([0, -100]);
  });

  it('folding is worth exactly zero, and a call is priced from the decision point', async () => {
    const h = limped('Ks 7d 2c 9h 3s');
    act(h, 'check'); // measured seat checks; now make the other seat the bettor by swapping roles
    const g = limped('Ks 7d 2c 9h 3s');
    // Measured seat = 0 here: seat 1 bets 60, seat 0 faces it.
    act(g, 'bet', 60);
    const s: RefSpot = { h: g, heroSeat: 0, holes: new Map([[0, pair('Kh Kd')], [1, pair('Qh Jh')]]), policies: new Map([[1, station]]), continuation: station };
    const v = await referenceValues(s, [{ kind: 'fold' }, { kind: 'call' }], { seed: 3 });
    expect(v.map((x) => x.mean)).toEqual([0, 100]); // call 60, win 40 + 60 + 60
    expect(h.phase).not.toBe('complete');
  });

  it('turn: every remaining river is enumerated and the check-down value equals the brute-force equity', async () => {
    const h = limped('Ks 7d 2c 9h');
    const hero = pair('Ah Qc'), villain = pair('8s 8d');
    const v = await referenceValues(spot(h, 'Ah Qc', '8s 8d'), [{ kind: 'check' }], { seed: 5 });
    expect(v[0].samples.length).toBe(44);
    expect(v[0].chanceExact).toBe(true);
    let total = 0;
    const used = new Set<CardId>([...h.board, ...hero, ...villain]);
    for (let c = 0; c < 52; c++) {
      if (used.has(c as CardId)) continue;
      const b = [...h.board, c as CardId];
      const a = evaluateHand([...hero, ...b]), z = evaluateHand([...villain, ...b]);
      total += a > z ? 40 : a === z ? 20 : 0;
    }
    expect(v[0].mean).toBeCloseTo(total / 44, 9);
  });

  it('flop: every action is valued on the same run-outs, so the difference between a called bet and a check is exactly plus or minus the bet', async () => {
    const h = limped('Ks 7d 2c');
    const v = await referenceValues(spot(h, 'Ah Qc', '8s 8d'), [{ kind: 'check' }, { kind: 'bet', to: 30 }], { seed: 9, flopRunouts: 40 });
    expect(v[0].samples.length).toBe(40);
    expect(v[0].chanceExact).toBe(false);
    for (let i = 0; i < 40; i++) expect([30, -30, 0]).toContain(v[1].samples[i] - v[0].samples[i]);
    const d = pairedDiff(v[1], v[0]);
    expect(d.mean).toBeCloseTo(v[1].mean - v[0].mean, 9);
    expect(d.se).toBeLessThan(v[1].se); // pairing removes most of the noise
    // Same seed, same answer.
    const again = await referenceValues(spot(h, 'Ah Qc', '8s 8d'), [{ kind: 'check' }, { kind: 'bet', to: 30 }], { seed: 9, flopRunouts: 40 });
    expect(again.map((x) => x.mean)).toEqual(v.map((x) => x.mean));
  });

  it('rejects an illegal candidate and a spot that is not the measured seat\'s decision', async () => {
    const h = limped('Ks 7d 2c 9h 3s');
    await expect(referenceValues(spot(h, 'Kh Kd', 'Qh Jh'), [{ kind: 'call' }], { seed: 1 })).rejects.toThrow(/illegal candidate/);
    await expect(referenceValues({ ...spot(h, 'Kh Kd', 'Qh Jh'), heroSeat: 0 }, [{ kind: 'check' }], { seed: 1 })).rejects.toThrow(/not the measured seat/);
  });
});

describe('reference evaluator: hidden information stays in the simulator', () => {
  it('the measured seat\'s continuation policy is only ever shown its own cards', async () => {
    const seen: { seat: number; hole: string }[] = [];
    const spy: Policy = { name: 'spy', act(v: PolicyView) { seen.push({ seat: v.seat, hole: v.hole.join(',') }); return { kind: v.la.canCheck ? 'check' : 'call' }; } };
    const h = limped('Ks 7d 2c');
    const hero = pair('Ah Qc');
    // The opponent bets when checked to, so the measured seat is asked again on every street.
    const bettor: Policy = { name: 'bettor', act: (v) => (v.la.canRaise && v.la.canCheck ? { kind: 'bet', to: v.la.minRaiseTo } : { kind: v.la.canCheck ? 'check' : 'call' }) };
    await referenceValues({ h, heroSeat: 1, holes: new Map([[1, hero], [0, pair('8s 8d')]]), policies: new Map([[0, bettor]]), continuation: spy }, [{ kind: 'check' }], { seed: 2, flopRunouts: 6 });
    expect(seen.length).toBeGreaterThan(6);
    expect(new Set(seen.map((s) => `${s.seat}:${s.hole}`))).toEqual(new Set([`1:${hero.join(',')}`]));
  });

  it('nothing under src/ imports the reference evaluator or anything else from sim/', () => {
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const f of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, f.name);
        if (f.isDirectory()) walk(p);
        else if (/\.ts$/.test(f.name) && /from\s+['"](\.\.\/)+sim\/|sim\/bot\/reference/.test(fs.readFileSync(p, 'utf8'))) offenders.push(p);
      }
    };
    walk(path.join(__dirname, '..', '..', 'src'));
    expect(offenders).toEqual([]);
  });

  it('the extension entry points do not reach the simulator policies either', () => {
    // Follow relative imports from the four bundled entry files; src/bot/sim must not be reachable.
    const root = path.join(__dirname, '..', '..', 'src', 'bot', 'ext');
    const seenFiles = new Set<string>();
    const visit = (file: string) => {
      const f = fs.existsSync(`${file}.ts`) ? `${file}.ts` : fs.existsSync(path.join(file, 'index.ts')) ? path.join(file, 'index.ts') : file;
      if (seenFiles.has(f) || !fs.existsSync(f) || !f.endsWith('.ts')) return;
      seenFiles.add(f);
      for (const m of fs.readFileSync(f, 'utf8').matchAll(/from\s+['"](\.[^'"]+)['"]/g)) visit(path.resolve(path.dirname(f), m[1]));
    };
    for (const e of ['content', 'background', 'popup', 'dashboard']) visit(path.join(root, e));
    expect(seenFiles.size).toBeGreaterThan(20);
    expect([...seenFiles].filter((f) => /[\\/]src[\\/]bot[\\/]sim[\\/]/.test(f))).toEqual([]);
  });
});

describe('independent benchmark opponents', () => {
  it('are registered, and none is built on the bot\'s behaviour models', () => {
    expect(Object.keys(INDEPENDENT_FACTORIES).sort()).toEqual(['adaptive-punisher', 'maniac', 'mdf-defender', 'nit', 'pot-odds-caller', 'trapper']);
    for (const k of Object.keys(INDEPENDENT_FACTORIES)) expect(POLICY_FACTORIES[k]).toBeDefined();
    const src = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'bot', 'sim', 'independent.ts'), 'utf8');
    const imports = [...src.matchAll(/from\s+'([^']+)'/g)].map((m) => m[1]);
    expect(imports.filter((i) => /postflop-model|range-model|preflop-model|villains|strategy|agent/.test(i))).toEqual([]);
  });

  it('play full sessions together with zero illegal actions, reproducibly', async () => {
    const session = (seed: number) => playSession({
      players: Object.entries(INDEPENDENT_FACTORIES).map(([k, f], i) => ({ playerId: `${k}#${i}`, policy: f() })),
      hands: 240, seed, smallBlind: 10, bigBlind: 20, startStack: 2000,
    });
    const a = await session(77), b = await session(77);
    expect(a.illegal).toEqual([]);
    expect(a.hands).toBe(240);
    const nets = (r: typeof a) => [...r.totals.values()].map((t) => t.net);
    expect(nets(a)).toEqual(nets(b));
    expect(nets(a).reduce((x, y) => x + y, 0)).toBeCloseTo(0, 6);
  }, 120000);

  it('differ from each other in the way their names say', async () => {
    const counts = new Map<string, { free: number; bet: number; facing: number; fold: number; raise: number }>();
    const wrap = (name: string, p: Policy): Policy => ({
      name, observe: p.observe?.bind(p),
      async act(v) {
        const c = await p.act(v);
        if (v.h.street !== 'preflop') {
          const k = counts.get(name) ?? { free: 0, bet: 0, facing: 0, fold: 0, raise: 0 };
          if (v.la.canCheck) { k.free++; if (c.kind === 'bet') k.bet++; } else { k.facing++; if (c.kind === 'fold') k.fold++; if (c.kind === 'raise') k.raise++; }
          counts.set(name, k);
        }
        return c;
      },
    });
    await playSession({ players: Object.entries(INDEPENDENT_FACTORIES).map(([k, f], i) => ({ playerId: `${k}#${i}`, policy: wrap(k, f()) })), hands: 600, seed: 5, smallBlind: 10, bigBlind: 20, startStack: 2000 });
    const rate = (k: string) => { const c = counts.get(k)!; return { bet: c.bet / Math.max(1, c.free), fold: c.fold / Math.max(1, c.facing), raise: c.raise / Math.max(1, c.facing) }; };
    expect(rate('maniac').bet).toBeGreaterThan(0.6);
    expect(rate('maniac').bet).toBeGreaterThan(2 * rate('trapper').bet);
    expect(rate('nit').fold).toBeGreaterThan(rate('pot-odds-caller').fold + 0.15);
    expect(rate('trapper').bet).toBeLessThan(0.25);                     // waits for others to bet
    expect(rate('trapper').fold).toBeLessThan(rate('nit').fold);
  }, 120000);
});
