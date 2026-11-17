// Data pipeline (sim/bot/data): schema, provenance, validation and importers, on SYNTHETIC fixtures written for
// these tests (tests/bot/fixtures/data). No dataset file is used or present.
import * as fs from 'fs';
import * as path from 'path';
import { describe, expect, it } from 'vitest';
import { parsePhh, parsePokerBenchPostflop, parsePokerNowLog, splitCsvLine } from '../../sim/bot/data/importers';
import { checkManifest, importManifest, Manifest, sha256 } from '../../sim/bot/data/manifest';
import { errorsOf, HandHistory, SourceInfo, usableAsStrategyTarget, usableForBehaviourFrequencies } from '../../sim/bot/data/schema';
import { replayHand, validateExample, validateHand, validateSource } from '../../sim/bot/data/validate';

const DIR = path.join(__dirname, 'fixtures', 'data');
const file = (name: string) => fs.readFileSync(path.join(DIR, name));
const entry = (name: string) => ({ path: name, sha256: sha256(file(name)), bytes: file(name).length });
const read = (rel: string) => (fs.existsSync(path.join(DIR, rel)) ? file(rel) : null);

const synthetic = (id: string, files: string[], over: Partial<SourceInfo> = {}): SourceInfo => ({
  id, name: 'Synthetic test hands', kind: 'synthetic', origin: 'local', licence: 'project licence', licenceNotes: '', access: 'unrestricted',
  retrieved: '2026-11-16', population: 'made up for tests', labelSemantics: 'none', caveats: [], files: files.map(entry), ...over,
});
const external = (over: Partial<SourceInfo> = {}): SourceInfo => synthetic('solver-rows', ['synthetic-postflop.csv'], {
  kind: 'solver-labels', origin: 'https://example.invalid/dataset', licence: 'Apache-2.0', licenceNotes: 'Labels derive from a commercial tool; reuse terms not confirmed.',
  access: 'needs-approval', approvedBy: 'project owner', approvedOn: '2026-11-16', labelSemantics: 'solver-dominant-action', population: 'six-handed, 100 big blinds, heads-up after the flop',
  caveats: ['one action per row; mixed spots removed; classes balanced'], ...over,
});

describe('provenance', () => {
  it('accepts a complete record and names every gap in an incomplete one', () => {
    expect(validateSource(external())).toEqual([]);
    expect(validateSource(synthetic('own-test-data', ['synthetic-hand-1.phh']))).toEqual([]);
    const bad = validateSource(external({ licence: ' ', retrieved: 'yesterday', files: [{ path: '../secret.csv', sha256: 'abc', bytes: 1.5 }] }));
    const text = bad.map((i) => i.message).join(' | ');
    expect(text).toMatch(/licence is required/);
    expect(text).toMatch(/retrieved must be an ISO date/);
    expect(text).toMatch(/must be relative and stay inside the data folder/);
    expect(text).toMatch(/sha256 must be 64 hex digits/);
    expect(text).toMatch(/bytes must be a whole number/);
  });

  it('data from elsewhere cannot be imported without recorded approval and a note on the right to use it', () => {
    expect(validateSource(external({ approvedBy: undefined })).map((i) => i.message).join()).toMatch(/not approved/);
    expect(validateSource(external({ access: 'unrestricted' })).map((i) => i.message).join()).toMatch(/must be marked needs-approval/);
    expect(validateSource(external({ licenceNotes: '' })).map((i) => i.message).join()).toMatch(/licenceNotes must say/);
  });

  it('what a label means is fixed by the kind of source: nobody\'s play can be recorded as solver output', () => {
    const human = external({ id: 'real-hands', kind: 'human-hands', labelSemantics: 'solver-dominant-action' });
    expect(validateSource(human).map((i) => i.message).join()).toMatch(/never as solver output/);
    const elite = external({ id: 'strong-program', kind: 'program-hands', labelSemantics: 'solver-dominant-action' });
    expect(validateSource(elite).map((i) => i.message).join()).toMatch(/still not a solver label/);
    expect(validateSource(external({ id: 'real-hands', kind: 'human-hands', labelSemantics: 'human-action' }))).toEqual([]);
    expect(usableAsStrategyTarget({ labelSemantics: 'solver-dominant-action' })).toBe(true);
    for (const l of ['human-action', 'program-action', 'none'] as const) expect(usableAsStrategyTarget({ labelSemantics: l })).toBe(false);
    expect(usableForBehaviourFrequencies({ labelSemantics: 'human-action', kind: 'human-hands' })).toBe(true);
    expect(usableForBehaviourFrequencies({ labelSemantics: 'solver-dominant-action', kind: 'solver-labels' })).toBe(false);
  });

  it('a file that was changed after its hash was recorded, or is missing, blocks the source', () => {
    const src = external();
    const m: Manifest = { sources: [src], inputs: [{ source: src.id, path: 'synthetic-postflop.csv', format: 'pokerbench-postflop-csv' }] };
    expect(checkManifest(m, read)).toEqual([]);
    const tampered = (rel: string) => { const b = read(rel); return b ? Buffer.concat([b, Buffer.from('x')]) : null; };
    expect(checkManifest(m, tampered).map((i) => i.message).join()).toMatch(/does not match its recorded SHA-256/);
    expect(checkManifest(m, () => null).map((i) => i.message).join()).toMatch(/is missing/);
    expect(importManifest(m, tampered)).toMatchObject({ hands: [], examples: [] });
    const unlisted: Manifest = { sources: [src], inputs: [{ source: src.id, path: 'synthetic-hand-1.phh', format: 'phh' }] };
    expect(checkManifest(unlisted, read).map((i) => i.message).join()).toMatch(/not listed among the source's hashed files/);
  });
});

describe('hand histories (PHH format)', () => {
  it('a three-handed hand is read, replays through the rules engine and ends with the right stacks', () => {
    const { hand, issues } = parsePhh(file('synthetic-hand-1.phh').toString(), 'synthetic-hands', 'h1');
    expect(issues).toEqual([]);
    const h = hand as HandHistory;
    expect(h).toMatchObject({ buttonSeat: 2, smallBlind: 1, bigBlind: 2, ante: 0, board: ['Jc', '3d', '5c', '4h', '9s'], holes: [null, null, ['As', 'Ks']] });
    expect(h.actions.map((a) => `${a.seat}${a.kind}${a.to ?? ''}`)).toEqual(['2raise6', '0fold', '1call', '1check', '2bet8', '1call', '1check', '2check', '1check', '2bet20', '1fold']);
    const r = replayHand(h);
    expect(r.issues).toEqual([]);
    expect(r.state!.phase).toBe('complete');
    expect(r.state!.seats.map((s) => s.stack - s.startStack)).toEqual([-1, -14, 15]);
  });

  it('heads-up: the small blind is the button, and cards shown at showdown are kept', () => {
    const { hand } = parsePhh(file('synthetic-hand-2.phh').toString(), 'synthetic-hands', 'h2');
    const h = hand as HandHistory;
    expect(h).toMatchObject({ buttonSeat: 1, smallBlind: 1, bigBlind: 2, holes: [['Qs', 'Js'], ['Ah', '9h']] });
    const r = replayHand(h);
    expect(errorsOf(r.issues)).toEqual([]);
    expect(r.state!.phase).toBe('showdown');
  });

  it('a hand that breaks the rules is rejected with the reason, not repaired', () => {
    const { hand } = parsePhh(file('synthetic-hand-bad.phh').toString(), 'synthetic-hands', 'bad');
    expect(validateHand(hand as HandHistory).map((i) => i.message).join()).toMatch(/seat 1 acts, but it is seat 2's turn/);
    const dup: HandHistory = { ...(parsePhh(file('synthetic-hand-1.phh').toString(), 's', 'h').hand as HandHistory), board: ['As', '3d', '5c'] };
    expect(validateHand(dup).map((i) => i.message).join()).toMatch(/card As appears twice/);
    expect(parsePhh("variant = 'PO'\nstarting_stacks = [1, 1]\nblinds_or_straddles = [1, 2]\nactions = []", 's', 'x').issues[0].message).toMatch(/not no-limit hold'em/);
    expect(parsePhh("variant = 'NT'\nstarting_stacks = [100, 100, 100]\nblinds_or_straddles = [1, 2, 4]\nactions = []", 's', 'x').issues[0].message).toMatch(/straddles are not supported/);
  });
});

describe('solver-labelled rows (PokerBench postflop layout)', () => {
  const { examples, issues } = parsePokerBenchPostflop(file('synthetic-postflop.csv').toString(), 'solver-rows');

  it('reads the rows it can and reports the one it cannot', () => {
    expect(examples.length).toBe(5);
    expect(issues.map((i) => i.message)).toEqual([expect.stringMatching(/not a postflop street/)]);
    expect(examples[0]).toMatchObject({ street: 'flop', heroCards: ['Ah', 'Kd'], board: ['Ks', '7h', '2d'], pot: 5.5, position: 'IP', label: { kind: 'bet', amount: 4 }, labelSemantics: 'solver-dominant-action', reconstruction: 'partial' });
    expect(examples[1]).toMatchObject({ street: 'turn', board: ['Ks', '7h', '2d', '5c'], legal: [{ kind: 'fold' }, { kind: 'call' }, { kind: 'raise', amount: 27 }], label: { kind: 'fold' } });
    expect(examples[1].raw.postflop_action).toBe('OOP_CHECK/IP_BET_4/OOP_CALL/dealcards/5c/OOP_BET_9');
    expect(splitCsvLine('a,"b, c",d')).toEqual(['a', 'b, c', 'd']);
  });

  it('validation rejects a duplicated card and a label that is not a legal move', () => {
    const verdicts = examples.map((e) => errorsOf(validateExample(e)).map((i) => i.message));
    expect(verdicts.slice(0, 3)).toEqual([[], [], []]);
    expect(verdicts[3].join()).toMatch(/card Ks appears twice/);
    expect(verdicts[4].join()).toMatch(/the label \(call\) is not among the legal moves/);
  });
});

describe('import of a whole manifest', () => {
  it('keeps what passes, counts what does not, and every kept record carries its source', () => {
    const rows = external();
    const hands = synthetic('synthetic-hands', ['synthetic-hand-1.phh', 'synthetic-hand-2.phh', 'synthetic-hand-bad.phh'], { kind: 'human-hands', origin: 'https://example.invalid/hands', licence: 'MIT', licenceNotes: 'Synthetic stand-in for scraped hands.', access: 'needs-approval', approvedBy: 'project owner', approvedOn: '2026-11-16', labelSemantics: 'human-action' });
    const m: Manifest = { sources: [rows, hands], inputs: [
      { source: 'solver-rows', path: 'synthetic-postflop.csv', format: 'pokerbench-postflop-csv' },
      ...['synthetic-hand-1.phh', 'synthetic-hand-2.phh', 'synthetic-hand-bad.phh'].map((p) => ({ source: 'synthetic-hands', path: p, format: 'phh' as const })),
    ] };
    const r = importManifest(m, read);
    expect(r.counts).toEqual({ 'solver-rows': { read: 6, kept: 3, rejected: 3 }, 'synthetic-hands': { read: 3, kept: 2, rejected: 1 } });
    expect(r.examples.every((e) => e.source === 'solver-rows' && e.labelSemantics === 'solver-dominant-action')).toBe(true);
    expect(r.hands.map((h) => h.source)).toEqual(['synthetic-hands', 'synthetic-hands']);
    // An unapproved source contributes nothing, and the other source is unaffected.
    const blocked = importManifest({ ...m, sources: [{ ...rows, approvedBy: '' }, hands] }, read);
    expect(blocked.examples).toEqual([]);
    expect(blocked.hands.length).toBe(2);
  });

  it('own PokerNow logs go through the same schema and replay', () => {
    const log = [
      '-- starting hand #7 (id: h7x)  (No Limit Texas Hold\'em) (dealer: "Ann @ a1") --',
      'Player stacks: #2 "Ann @ a1" (1000) | #5 "Bob @ b2" (1500) | #9 "Cy @ c3" (300)',
      '"Bob @ b2" posts a small blind of 10', '"Cy @ c3" posts a big blind of 20',
      '"Ann @ a1" raises to 60', '"Bob @ b2" folds', '"Cy @ c3" folds',
      'Uncalled bet of 40 returned to "Ann @ a1"', '"Ann @ a1" collected 50 from pot', '-- ending hand #7 --',
    ];
    const { hands, issues } = parsePokerNowLog(log, 'own-logs');
    expect(errorsOf(issues)).toEqual([]);
    expect(hands.length).toBe(1);
    expect(hands[0]).toMatchObject({ source: 'own-logs', buttonSeat: 0, smallBlind: 10, bigBlind: 20, board: [] });
    expect(hands[0].actions).toEqual([{ seat: 0, kind: 'raise', to: 60 }, { seat: 1, kind: 'fold' }, { seat: 2, kind: 'fold' }]);
    expect(validateHand(hands[0])).toEqual([]);
  });
});
