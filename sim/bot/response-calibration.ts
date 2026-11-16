// ============================================================
// Does the opponent model predict what the opponents at the table actually do?
//
//   npx tsx sim/bot/response-calibration.ts [--tables hu-tag,hu-re,hu-ra,six-indep,six-mixed] [--hands 3000] [--seed 5100]
//
// The v2 bot plays the measured seat. Every time it bets or raises after the flop, the engine's own
// prediction for that bet (all fold / called / raised) is compared with what then happened. Every time it
// checks with opponents still to act, the predicted chance of a bet behind is compared with what happened.
// Averages over many decisions: if the model were right, "predicted" and "happened" would agree.
//
// This measures the model against the SIMULATED opponents only. The same comparison on real hands needs
// far more recorded decisions than the three debug bundles hold.
// ============================================================

import { playSession } from '../../src/bot/sim/table';
import { botPolicy } from '../../src/bot/sim/policies';
import type { Decision } from '../../src/bot/strategy/types';
import { makePolicy } from './run';
import { TABLES } from './strategy-diag';

const argS = (f: string, d: string) => { const i = process.argv.indexOf(`--${f}`); return i >= 0 ? process.argv[i + 1] : d; };
const pct = (x: number) => `${(100 * x).toFixed(0)}%`;

interface Acc { n: number; pFold: number; pCall: number; pRaise: number; aFold: number; aCall: number; aRaise: number }
interface AccCheck { n: number; pBet: number; aBet: number }
const num = (s: string, re: RegExp): number | null => { const m = re.exec(s); return m ? Number(m[1]) / 100 : null; };

async function table(name: string, hands: number, seed: number): Promise<void> {
  const field = TABLES[name];
  const n = field.length + 1;
  hands = Math.round(hands / n) * n;
  const hero = botPolicy({ samples: 400, seed, name: 'bot' });
  hero.keepDecisions = true;
  const players = [{ playerId: '0', policy: hero }, ...field.map((sp, i) => ({ playerId: `${i + 1}`, policy: makePolicy(sp, 400, seed + i + 1) }))];
  const bets = new Map<string, Acc>(), checks = new Map<string, AccCheck>();
  await playSession({
    players, hands, seed, smallBlind: 10, bigBlind: 20, startStack: 2000, duplicate: true,
    onHand: (r) => {
      const seat = r.h.seats.find((x) => x.playerId === '0');
      const ds: Decision[] = hero.decisions.splice(0);
      if (!seat) return;
      const ev = r.h.events.filter((e) => !e.kind.startsWith('post'));
      const mine = ev.map((e, i) => ({ e, i })).filter((x) => x.e.seat === seat.seat);
      if (mine.length !== ds.length) return;                       // defensive: decisions and actions must line up one to one
      mine.forEach(({ e, i }, k) => {
        const d = ds[k];
        if (e.street === 'preflop') return;
        // What the opponents did between this action and Hero's next action on the same street.
        let raised = false, called = false, bet = false;
        for (let j = i + 1; j < ev.length && ev[j].street === e.street && ev[j].seat !== seat.seat; j++) {
          if (ev[j].kind === 'raise') raised = true; else if (ev[j].kind === 'call') called = true; else if (ev[j].kind === 'bet') bet = true;
        }
        const key = `${e.street}`;
        if (e.kind === 'bet' || e.kind === 'raise') {
          const line = d.basis.find((b) => b.startsWith('modelled responses:'));
          if (!line) return;
          const pF = num(line, /all fold (\d+)%/), pC = num(line, /call (\d+)%/), pR = num(line, /raise (\d+)%/);
          if (pF === null || pC === null || pR === null) return;
          const a = bets.get(key) ?? { n: 0, pFold: 0, pCall: 0, pRaise: 0, aFold: 0, aCall: 0, aRaise: 0 };
          a.n++; a.pFold += pF; a.pCall += pC; a.pRaise += pR;
          if (raised) a.aRaise++; else if (called) a.aCall++; else a.aFold++;
          bets.set(key, a);
        } else if (e.kind === 'check') {
          const line = d.basis.find((b) => b.startsWith('check: an opponent bets behind'));
          const p = line ? num(line, /bets behind in (\d+)%/) : null;
          if (p === null) return;
          const a = checks.get(key) ?? { n: 0, pBet: 0, aBet: 0 };
          a.n++; a.pBet += p; if (bet) a.aBet++;
          checks.set(key, a);
        }
      });
    },
  });
  console.log(`\n### ${name} (${field.join(', ')}), ${hands} hands, seed ${seed}`);
  console.log(`| Street | Hero bets or raises | all fold: predicted / happened | called: predicted / happened | raised: predicted / happened | Hero checks (opponents behind) | bet behind: predicted / happened |`);
  console.log(`|---|---|---|---|---|---|---|`);
  for (const s of ['flop', 'turn', 'river']) {
    const a = bets.get(s), c = checks.get(s);
    const b = a ? `${a.n} | ${pct(a.pFold / a.n)} / ${pct(a.aFold / a.n)} | ${pct(a.pCall / a.n)} / ${pct(a.aCall / a.n)} | ${pct(a.pRaise / a.n)} / ${pct(a.aRaise / a.n)}` : '0 | - | - | -';
    console.log(`| ${s} | ${b} | ${c ? `${c.n} | ${pct(c.pBet / c.n)} / ${pct(c.aBet / c.n)}` : '0 | -'} |`);
  }
}

async function main(): Promise<void> {
  const hands = Number(argS('hands', '3000')), seed = Number(argS('seed', '5100'));
  console.log(`## Opponent-model calibration against simulated opponents (v2 engine in the measured seat)`);
  for (const t of argS('tables', 'hu-tag,hu-re,hu-ra,six-indep,six-mixed').split(',')) await table(t, hands, seed);
}

main().catch((e) => { console.error(e); process.exit(1); });
