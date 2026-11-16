// Benchmark-only engine selection per street (AgentOptions.preflopEngine / postflopEngine): each half must be
// exactly the corresponding whole engine on its streets, otherwise the factorial comparison measures nothing.
import { describe, expect, it } from 'vitest';
import { BotAgent, AgentOptions } from '../../src/bot/agent';
import { buildSpot } from '../../sim/bot/scenarios';

const PRE = { players: 8, hero: 'CO', cards: 'Ah Jd', lines: ['UTG f, UTG+1 f, MP r2.5, HJ f'] };
const POST = { players: 6, hero: 'BB', cards: '5c 4c', lines: ['UTG f, HJ f, CO f, BTN r2.5, SB f, BB c', 'Kh 9d 5s:'] };

function decide(spot: typeof PRE, opts: AgentOptions) {
  const b = buildSpot(spot);
  const d = new BotAgent({ seed: 5, ...opts }).decideSync(b.h, b.heroSeat, b.heroCards, 800);
  return { label: d.label, candidates: d.candidates.map((c) => [c.label, c.ev, c.freq]), basis: d.basis, engine: d.engine };
}

describe('per-street engine selection for the factorial benchmark', () => {
  it('defaults are unchanged: no option means v2 on every street, engine v1 means v1 on every street', () => {
    expect(decide(PRE, {})).toEqual(decide(PRE, { preflopEngine: 'v2', postflopEngine: 'v2' }));
    expect(decide(POST, {})).toEqual(decide(POST, { preflopEngine: 'v2', postflopEngine: 'v2' }));
    expect(decide(PRE, { engine: 'v1' })).toEqual(decide(PRE, { preflopEngine: 'v1', postflopEngine: 'v1' }));
    expect(decide(POST, { engine: 'v1' })).toEqual(decide(POST, { preflopEngine: 'v1', postflopEngine: 'v1' }));
  });

  it('v1 preflop with v2 postflop: preflop decisions are v1\'s, postflop decisions are v2\'s', () => {
    const mixed = { preflopEngine: 'v1', postflopEngine: 'v2' } as const;
    expect(decide(PRE, mixed)).toEqual(decide(PRE, { engine: 'v1' }));
    expect(decide(POST, mixed)).toEqual(decide(POST, { engine: 'v2' }));
  });

  it('v2 preflop with v1 postflop: the reverse', () => {
    const mixed = { preflopEngine: 'v2', postflopEngine: 'v1' } as const;
    expect(decide(PRE, mixed)).toEqual(decide(PRE, { engine: 'v2' }));
    expect(decide(POST, mixed)).toEqual(decide(POST, { engine: 'v1' }));
  });

  it('the two engines really differ on these spots, so the checks above can fail', () => {
    expect(decide(PRE, { engine: 'v1' }).basis).not.toEqual(decide(PRE, { engine: 'v2' }).basis);
    expect(decide(POST, { engine: 'v1' }).candidates).not.toEqual(decide(POST, { engine: 'v2' }).candidates);
  });
});
