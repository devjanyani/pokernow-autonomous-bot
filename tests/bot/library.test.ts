import { describe, expect, it } from 'vitest';
import { parseCards } from '../../src/bot/cards';
import { BUILTIN_PACKS, buildDefaultLibrary } from '../../src/bot/strategy/library/builtin';
import { expandToken, importPack, parseRangeList } from '../../src/bot/strategy/library/import';
import { StrategyLibrary } from '../../src/bot/strategy/library/library';
import { PACK_FORMAT, PACK_VERSION, StrategyPack } from '../../src/bot/strategy/library/types';
import { normaliseClass, normaliseCombo, validatePack } from '../../src/bot/strategy/library/validate';
import { BotAgent } from '../../src/bot/agent';
import { act, mk } from './helpers';

const c2 = (s: string) => parseCards(s) as [number, number];
const errors = (p: unknown) => validatePack(p).filter((i) => i.level === 'error').map((i) => i.message);

const TEXT = `
# a made-up pack used only by this test: the numbers mean nothing
@pack id=test-6max name="Test pack" revision=3
@source kind=solver tool="Test solver" license="written for this test" verified=yes
@assume format=cash players=6 stack=80-120 ante=0 open=2.5
@positions UTG MP CO BTN SB BB

@spot rfi hero=UTG
raise: 77+, ATs+, KQs, AQo+, A5s:0.5

@spot vs-open hero=BB villain=BTN
raise: QQ+, AKs, A5s:40%
call:  22-JJ, K9s-K6s, 98s-65s, AhKd:0.5
`;

const pack = (over: Partial<StrategyPack> = {}): StrategyPack => ({
  format: PACK_FORMAT, version: PACK_VERSION, id: 'p1', name: 'P1', revision: '1',
  source: { kind: 'heuristic', verified: false }, assumptions: { format: 'cash', players: 6, stackBB: [80, 120] },
  positions: ['UTG', 'MP', 'CO', 'BTN', 'SB', 'BB'], spots: [{ id: 'UTG-rfi', scenario: 'rfi', hero: 'UTG', hands: { AA: { raise: 1 } } }], ...over,
});

describe('range syntax', () => {
  it('expands the standard range tokens', () => {
    expect(expandToken('TT+')).toEqual(['TT', 'JJ', 'QQ', 'KK', 'AA']);
    expect(expandToken('66-44')).toEqual(['44', '55', '66']);
    expect(expandToken('ATs+')).toEqual(['ATs', 'AJs', 'AQs', 'AKs']);
    expect(expandToken('K9s-K7s')).toEqual(['K7s', 'K8s', 'K9s']);
    expect(expandToken('98s-76s')).toEqual(['76s', '87s', '98s']);
    expect(expandToken('AK')).toEqual(['AKs', 'AKo']);
    expect(expandToken('KhAd')).toEqual(['AdKh']);
  });
  it('rejects what it cannot read instead of ignoring it', () => {
    for (const bad of ['AKx', 'ZZ', 'A', '9Ts-76s', 'T9s-K7s', 'AA+KK']) expect(() => expandToken(bad)).toThrow();
    expect(() => parseRangeList('AA, AA')).toThrow(/twice/);
    expect(() => parseRangeList('AA:1.4')).toThrow(/outside 0-1/);
    expect(parseRangeList('A5s:40%, KK').get('A5s')).toBeCloseTo(0.4);
  });
  it('normalises classes and combos', () => {
    expect(normaliseClass('KAs')).toBe('AKs');
    expect(normaliseClass('AK')).toBeNull();
    expect(normaliseClass('AAs')).toBeNull();
    expect(normaliseCombo('KdAh')).toEqual({ combo: 'AhKd', cls: 'AKo' });
    expect(normaliseCombo('AhAh')).toBeNull();
  });
});

describe('pack validation', () => {
  it('accepts a well-formed pack', () => expect(errors(pack())).toEqual([]));
  it('requires a licence for solver and chart data and a tool for solver data', () => {
    expect(errors(pack({ source: { kind: 'solver', verified: true } })).join(' ')).toMatch(/licence.*solver/s);
    expect(errors(pack({ source: { kind: 'chart', verified: false } })).join(' ')).toMatch(/licence/);
    expect(errors(pack({ source: { kind: 'solver', tool: 'X', license: 'own solve', verified: true } }))).toEqual([]);
  });
  it('warns when the source is not verified', () => {
    expect(validatePack(pack()).some((i) => i.level === 'warning' && /not verified/.test(i.message))).toBe(true);
  });
  it('rejects frequencies above 1, unknown hands, unknown positions and duplicate hands', () => {
    const spot = (hands: Record<string, Record<string, number>>, extra = {}) => pack({ spots: [{ id: 's', scenario: 'rfi', hero: 'UTG', hands, ...extra }] as StrategyPack['spots'] });
    expect(errors(spot({ AA: { raise: 0.7, call: 0.5 } })).join(' ')).toMatch(/more than 1/);
    expect(errors(spot({ AXs: { raise: 1 } })).join(' ')).toMatch(/neither a hand class/);
    expect(errors(spot({ AKs: { raise: 1 }, KAs: { raise: 1 } })).join(' ')).toMatch(/twice/);
    expect(errors(spot({ AA: { shove: 1 } })).join(' ')).toMatch(/unknown action/);
    expect(errors(spot({ AA: { raise: 1 } }, { hero: 'LJ' })).join(' ')).toMatch(/not one of the pack's positions/);
    expect(errors(spot({ AA: { raise: 1 } }, { scenario: 'vs-open' })).join(' ')).toMatch(/needs a villain/);
    expect(errors(pack({ positions: ['UTG', 'BB'] })).join(' ')).toMatch(/one name per player/);
  });
  it('requires postflop references to state their setup and sum to 1', () => {
    expect(errors(pack({ references: [{ scenario: 'x', frequencies: { check: 0.5, 'bet-small': 0.2 }, setup: 'ranges A vs B' }] })).join(' ')).toMatch(/sum to 0.700/);
    expect(errors(pack({ references: [{ scenario: 'x', frequencies: { check: 1 }, setup: '' }] })).join(' ')).toMatch(/setup/);
  });
});

describe('importers', () => {
  it('reads the text format, including weights and exact combos', () => {
    const { pack: p, issues } = importPack(TEXT);
    expect(issues.filter((i) => i.level === 'error')).toEqual([]);
    expect(p.id).toBe('test-6max');
    expect(p.source).toMatchObject({ kind: 'solver', tool: 'Test solver', verified: true });
    expect(p.assumptions).toMatchObject({ players: 6, stackBB: [80, 120], openSizeBB: 2.5 });
    const rfi = p.spots.find((s) => s.scenario === 'rfi')!;
    expect(rfi.hands.A5s).toEqual({ raise: 0.5 });
    expect(Object.keys(rfi.hands)).toContain('77');
    const def = p.spots.find((s) => s.scenario === 'vs-open')!;
    expect(def.villain).toBe('BTN');
    expect(def.hands.A5s).toEqual({ raise: 0.4 });
    expect(def.hands.AhKd).toEqual({ call: 0.5 });
    expect(def.hands['87s']).toEqual({ call: 1 });
  });
  it('reads CSV with the pack header in comment lines', () => {
    const csv = ['#@pack id=csv-pack name="CSV" revision=1', '#@source kind=heuristic verified=no', '#@assume players=3 stack=20-40', '#@positions BTN SB BB',
      'scenario,hero,villain,hand,fold,call,raise,allin', 'rfi,BTN,,AA,0,0,1,0', 'rfi,BTN,,72o,1,0,0,0', 'vs-open,BB,BTN,KQs,0.2,0.5,0.3,'].join('\n');
    const { pack: p, issues } = importPack(csv);
    expect(issues.filter((i) => i.level === 'error')).toEqual([]);
    expect(p.spots).toHaveLength(2);
    expect(p.spots[0].hands.AA).toEqual({ raise: 1 });
    expect(p.spots[0].hands['72o']).toEqual({});
    expect(p.spots[1].hands.KQs).toEqual({ call: 0.5, raise: 0.3 });
  });
  it('reports the line of a bad token and never drops it silently', () => {
    expect(() => importPack(TEXT.replace('KQs, AQo+', 'KQs, AQx+'))).toThrow(/line \d+: cannot read range token/);
    expect(() => importPack('@spot rfi hero=UTG\ncall AA')).toThrow(/expected a directive/);
    expect(() => importPack('raise: AA')).toThrow(/before any @spot/);
    expect(() => importPack('scenario,hero,hand,fold,raise\nrfi,BTN,AA,0.5,0.2')).toThrow(/sum to 0.700/);
  });
  it('round-trips through JSON', () => {
    const { pack: p } = importPack(TEXT);
    const again = importPack(JSON.stringify(p));
    expect(again.pack).toEqual(p);
    expect(again.issues.filter((i) => i.level === 'error')).toEqual([]);
  });
});

describe('library lookup', () => {
  const lib = () => { const l = new StrategyLibrary(); expect(l.register(importPack(TEXT).pack).filter((i) => i.level === 'error')).toEqual([]); return l; };
  const q = { scenario: 'rfi' as const, players: 6, heroBehind: 5, effStackBB: 100, anteBB: 0 };

  it('matches exactly inside the stated assumptions', () => {
    const m = lib().find(q)!;
    expect(m.quality).toBe('exact');
    expect(m.departures).toEqual([]);
    expect(m.basisTag).toBe('solver');
  });
  it('labels every departure from the assumptions instead of hiding it', () => {
    const l = lib();
    expect(l.find({ ...q, players: 9 })!.departures.join(' ')).toMatch(/6-handed data used at a 9-handed table/);
    expect(l.find({ ...q, effStackBB: 40 })!.departures.join(' ')).toMatch(/made for 80-120bb, effective stack is 40bb/);
    expect(l.find({ ...q, anteBB: 0.1 })!.departures.join(' ')).toMatch(/antes/);
    const all = l.find({ ...q, players: 8, effStackBB: 250, anteBB: 0.1 })!;
    expect(all.quality).toBe('approximation');
    expect(all.departures).toHaveLength(3);
    expect(l.cite(all)).toMatch(/APPROXIMATION/);
  });
  it('never answers with a different scenario, seat or villain, and never lends ring data to a heads-up table', () => {
    const l = lib();
    expect(l.find({ ...q, scenario: 'vs-3bet', villainBehind: 2 })).toBeNull();
    expect(l.find({ ...q, heroBehind: 4 })).toBeNull();
    expect(l.find({ ...q, scenario: 'vs-open', heroBehind: 0, villainBehind: 3 })).toBeNull();      // only BB vs BTN exists
    expect(l.find({ ...q, scenario: 'vs-open', heroBehind: 0, villainBehind: 2 })).not.toBeNull();
    expect(l.find({ ...q, players: 2, heroBehind: 1 })).toBeNull();
  });
  it('a combo entry overrides its class and an absent hand folds', () => {
    const l = lib();
    const m = l.find({ scenario: 'vs-open', players: 6, heroBehind: 0, villainBehind: 2, effStackBB: 100 })!;
    expect(l.mixFor(m, c2('Ah Kd'))).toMatchObject({ call: 0.5, raise: 0, fold: 0.5 });
    expect(l.mixFor(m, c2('As Ks'))).toMatchObject({ raise: 1, fold: 0 });
    expect(l.mixFor(m, c2('7c 2d'))).toMatchObject({ fold: 1 });
    expect(l.mixFor(m, c2('As 5s')).raise).toBeCloseTo(0.4);
  });
  it('prefers an exact match and verified solver data over an approximation', () => {
    const l = new StrategyLibrary();
    for (const p of BUILTIN_PACKS) l.register(p);
    l.register(importPack(TEXT).pack);
    expect(l.find(q)!.pack.id).toBe('test-6max');                              // verified solver beats unverified chart
    expect(l.find({ ...q, effStackBB: 140 })!.pack.id).toBe('greenline-6max-100bb'); // exact (60-150bb) beats approximation
  });
  it('refuses a pack with errors and a duplicate id', () => {
    const l = lib();
    expect(l.register(importPack(TEXT).pack)[0].message).toMatch(/already registered/);
    expect(l.register(pack({ id: 'bad', spots: [] as StrategyPack['spots'], positions: [] })).some((i) => i.level === 'error')).toBe(true);
    expect(l.packs).toHaveLength(1);
  });
});

describe('built-in packs and their use in decisions', () => {
  it('both chart packs validate, with an honest unverified source', () => {
    const { library, rejected } = buildDefaultLibrary();
    expect(rejected).toEqual([]);
    expect(library.packs.map((p) => p.id)).toEqual(['greenline-6max-100bb', 'pekarstas-6max-100bb']);
    for (const p of library.packs) { expect(p.source.kind).toBe('chart'); expect(p.source.verified).toBe(false); expect(p.spots.length).toBeGreaterThan(30); }
  });
  it('a six-handed 100bb open cites the chart as an exact match; a nine-handed one says it is an approximation', () => {
    const h6 = mk(6); act(h6, 'fold');
    const d6 = new BotAgent().decideSync(h6, h6.toAct!, c2('Ah Kd'));
    expect(d6.basis.join(' | ')).toMatch(/precomputed-chart: Greenline 6-max chart, MP-RFI \(source not verified\)(?!; APPROX)/);
    const h9 = mk(9);
    while (h9.seats.find((s) => s.seat === h9.toAct)!.pos!.label !== 'CO') act(h9, 'fold');
    const d9 = new BotAgent().decideSync(h9, h9.toAct!, c2('Ah Kd'));
    expect(d9.basis.join(' | ')).toMatch(/CO-RFI.*APPROXIMATION: 6-handed data used at a 9-handed table/);
    expect(d9.action).toBe('raise');
  });
  it('a seat no pack covers falls back to the labelled heuristic', () => {
    const h9 = mk(9);
    const d = new BotAgent().decideSync(h9, h9.toAct!, c2('7h 2c'));
    expect(d.basis.join(' | ')).toMatch(/heuristic: UTG opens top/);
    expect(d.action).toBe('fold');
  });
  it('opponent ranges come from the chart when the line is covered, and say so', () => {
    const h = mk(6);
    act(h, 'fold'); act(h, 'fold'); act(h, 'fold'); act(h, 'raise', 50); act(h, 'fold');    // BTN opens, SB folds, BB to act
    const d = new BotAgent().decideSync(h, h.toAct!, c2('Kh Qh'));
    const r = d.ranges.find((x) => x.line === 'open')!;
    expect(r.basis).toBe('precomputed-chart');
    expect(r.source).toMatch(/BTN-RFI/);
    expect(r.summary).toMatch(/^4\d\.\d% of hands/);
  });
});
