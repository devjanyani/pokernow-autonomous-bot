// ============================================================
// Dashboard (extension page): live monitor, opponent profiles, hand review,
// diagnostics, settings. Reads the extension's own IndexedDB directly and the
// live snapshot from chrome.storage.session. All text from the table (player
// names, log lines) is inserted with textContent, never as HTML.
// ============================================================

import { parseLogCsv, replayLog } from '../adapter/pokernow/log';
import {
  applyHandToProfiles, classify, exploitNotes, PlayerProfile, posterior, SIZE_BUCKETS, StatKey, styleLabel,
} from '../opponents/profile';
import { buildBundle } from '../diag/recorder';
import { DecisionRecord, HandRecord, Indicator, LiveState, sanitizeSettings, Settings, toHandRecord } from './records';
import { BotStorage } from './storage';
import { actorLine, cardView, chips, contextRows, decisionBanner, explanation, playerRows, recentTimeline, statusPill } from './view';

const storage = new BotStorage();
let settings: Settings;
let live: LiveState | null = null;
let activeTab = 'live';

type Child = Node | string | null | undefined | false;
function el<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, string> = {}, ...children: Child[]): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) { if (k === 'class') e.className = v; else e.setAttribute(k, v); }
  for (const c of children) if (c !== null && c !== undefined && c !== false) e.append(c);
  return e;
}
const card = (title: string, ...children: Child[]) => el('div', { class: 'card' }, el('h2', {}, title), ...children);
/** Collapsible diagnostics section; whether it is open survives re-rendering. */
const sectionOpen = new Map<string, boolean>();
function section(key: string, title: string, openByDefault: boolean, ...children: Child[]): HTMLElement {
  const d = el('details', { class: 'card sec', 'data-key': key }, el('summary', {}, title), ...children);
  d.open = sectionOpen.get(key) ?? openByDefault;
  d.addEventListener('toggle', () => sectionOpen.set(key, d.open));
  return d;
}
const dl = (rows: [string, string | Node][]) => { const d = el('dl'); for (const [k, v] of rows) d.append(el('dt', {}, k), el('dd', {}, v)); return d; };
const pct = (x: number | null | undefined, digits = 0) => (x === null || x === undefined || !Number.isFinite(x) ? '–' : `${(100 * x).toFixed(digits)}%`);
const $ = (id: string) => document.getElementById(id) as HTMLElement;
const LEVEL_CLASS: Record<string, string> = { ok: 'good', warn: 'warn', bad: 'bad', na: 'muted' };
const LEVEL_WORD: Record<string, string> = { ok: 'OK', warn: 'CHECK', bad: 'PROBLEM', na: '–' };
const indicator = (i: Indicator) => el('span', {}, el('span', { class: LEVEL_CLASS[i.level] }, LEVEL_WORD[i.level]), i.detail ? ` · ${i.detail}` : '');
function indicatorRows(l: LiveState): [string, Node][] {
  const r = l.readiness;
  return [
    ['Observation health', indicator(r.observation)],
    ['Game-state consistency', indicator(r.consistency)],
    ['Turn', indicator(r.turn)],
    ['Legal actions', indicator(r.legal)],
    ['Decision readiness', indicator(r.decision)],
    ['Strategy uncertainty', indicator(r.strategy)],
  ];
}

// ---- live ---------------------------------------------------------------------

/** A playing card. `null` draws a face-down card. Text only: no images, nothing fetched. */
function playingCard(c: string | null, size: 'lg' | 'md' | 'sm' = 'md', dim = false): HTMLElement {
  if (c === null) return el('span', { class: `pc ${size} back${dim ? ' dim' : ''}`, role: 'img', 'aria-label': dim ? 'card not dealt yet' : 'face-down card' });
  const v = cardView(c);
  return el('span', { class: `pc ${size}${v.red ? ' red' : ''}`, role: 'img', 'aria-label': v.label }, el('span', { class: 'r' }, v.rank), el('span', { class: 's' }, v.suit));
}

const tag = (text: string, tone = 'muted') => el('span', { class: `tag ${tone}` }, text);

function renderLive(): void {
  const root = $('tab-live');
  root.textContent = '';
  const now = Date.now();
  const pill = statusPill(live, now);
  const banner = decisionBanner(live, now);
  const l = live && now - live.ts <= 60000 ? live : null;
  const h = l?.hand ?? null;

  // ---- status line: one compact indicator; the detail lives on the Diagnostics tab ----
  root.append(el('div', { class: 'statusline' },
    el('span', { class: `statuspill ${pill.tone}`, id: 'status-pill' }, pill.label),
    el('span', { class: 'muted' }, pill.detail),
    l ? el('span', { class: 'spacer' }) : null,
    l ? tag(l.estop ? 'Emergency stop on' : l.acting ? 'Autonomous' : l.mode === 'manual' ? 'Manual' : 'Recommend only', l.estop ? 'warn' : 'muted') : null));

  // ---- table: hero and board ----
  const heroCards = h?.heroCards ?? null;
  const hero = el('div', { class: 'hero' },
    el('div', { class: 'cards' }, playingCard(heroCards ? heroCards[0] : null, 'lg', !heroCards), playingCard(heroCards ? heroCards[1] : null, 'lg', !heroCards)),
    el('div', { class: 'heroinfo' },
      el('div', { class: 'label' }, 'Your hand'),
      el('div', { class: 'posline' }, h?.heroPosition ? el('span', { class: 'posbadge' }, h.heroPosition) : null, el('span', {}, heroCards ? heroCards.map((c) => { const v = cardView(c); return `${v.rank}${v.suit}`; }).join(' ') : 'Not dealt in')),
      el('div', { class: 'muted' }, h && h.heroStack !== null ? `Stack ${chips(h.heroStack)}${h.bigBlind ? ` · ${(h.heroStack / h.bigBlind).toFixed(0)} bb` : ''}` : 'Stack –'),
      el('div', { class: 'muted' }, h && h.effectiveStackBB !== null ? `Effective stack ${h.effectiveStackBB.toFixed(1)} bb` : 'Effective stack –')));
  const boardCards = h?.board ?? [];
  const board = el('div', { class: 'boardwrap' },
    el('div', { class: 'label' }, h ? `Board · ${h.phase === 'complete' ? 'hand complete' : h.phase}` : 'Board'),
    el('div', { class: 'cards', id: 'board' }, ...Array.from({ length: 5 }, (_, i) => playingCard(boardCards[i] ?? null, 'md', true))),
    el('div', { class: 'potline' }, h ? `Pot ${chips(h.pot)}` : 'No hand in progress'));
  root.append(el('div', { class: 'card tablecard' }, hero, board));

  // ---- decision: never blank ----
  const dec = el('div', { class: `card decision ${banner.tone}`, id: 'decision' });
  dec.append(el('div', { class: 'label' }, banner.kind === 'action' ? 'Recommended action' : 'Decision'));
  dec.append(el('div', { class: banner.kind === 'action' ? 'big' : 'msg' }, `${banner.provisional ? '… ' : ''}${banner.title}`));
  if (banner.sub) dec.append(el('div', { class: 'sub' }, banner.sub));
  if (l && l.decision && banner.kind === 'action') {
    const d = l.decision;
    const why = explanation(l, true);
    if (why.length) dec.append(el('div', { class: 'label', style: 'margin-top:12px' }, 'Why'), el('ul', { class: 'why' }, ...why.map((w) => el('li', {}, w))));
    const ct = el('table', {}, el('tr', {}, el('th', {}, 'Option'), el('th', { class: 'num' }, 'EV (chips)'), el('th', { class: 'num' }, '± SE'), el('th', { class: 'num' }, 'Play %')));
    const best = Math.max(...d.candidates.map((c) => c.ev ?? -Infinity));
    for (const c of d.candidates) ct.append(el('tr', {}, el('td', {}, c.label), el('td', { class: 'num' }, c.ev === null ? '–' : `${c.ev.toFixed(1)}${c.ev === best ? '' : ` (${(c.ev - best).toFixed(1)})`}`), el('td', { class: 'num' }, c.evSe === null ? '–' : c.evSe.toFixed(1)), el('td', { class: 'num' }, pct(c.freq))));
    const more = el('details', { class: 'more' }, el('summary', {}, 'All options considered, full reasoning and opponent ranges'), ct,
      el('ul', { class: 'why' }, ...explanation(l).map((w) => el('li', {}, w))),
      d.ranges.length ? el('ul', { class: 'why' }, ...d.ranges.map((r) => el('li', {}, `${r.name} [${r.line}]: ${r.summary}`))) : null,
      el('p', { class: 'muted' }, `${d.mode} · ${d.samples} samples · ${d.computeMs.toFixed(0)} ms. EV is shown only where the engine computed one.`));
    more.open = liveMoreOpen;
    more.addEventListener('toggle', () => { liveMoreOpen = more.open; });
    dec.append(more);
  }
  root.append(dec);

  if (!l) return;

  // ---- context, players, timeline ----
  const actor = actorLine(l);
  const ctx = card('Game', el('div', { class: `actor ${actor.tone}`, id: 'actor' }, actor.text, actor.verified ? tag('confirmed', 'good') : null), dl(contextRows(l).map(([k, v]) => [k, v])));
  const rows = playerRows(l);
  const plist = el('div', { class: 'players', id: 'players' }, el('div', { class: 'prow head' }, el('span', {}, 'Player'), el('span', {}, 'Pos'), el('span', { class: 'num' }, 'Stack'), el('span', {}, 'Last action'), el('span', {}, 'Status')));
  for (const p of rows) {
    plist.append(el('div', { class: `prow ${p.kind}${p.isHero ? ' hero' : ''}` },
      el('span', { class: 'pname', title: p.name }, p.name, p.isHero ? tag('you', 'accent') : null),
      el('span', {}, p.position), el('span', { class: 'num' }, p.stack), el('span', { class: 'pact' }, p.lastAction),
      el('span', { class: 'pstatus' }, p.status)));
  }
  const tl = el('div', { class: 'tl', id: 'timeline' });
  for (const e of recentTimeline(l, 14)) {
    if (e.street) tl.append(el('div', { class: 'tlstreet' }, e.street));
    tl.append(el('div', { class: `tlrow${e.uncertain ? ' bad' : ''}` }, e.text, e.deduced ? tag(e.uncertain ? 'deduced, unconfirmed' : 'deduced', e.uncertain ? 'bad' : 'warn') : null));
  }
  root.append(el('div', { class: 'livecols' }, ctx, card('Players', plist), card('Recent actions', l.timeline.length ? tl : el('p', { class: 'muted' }, 'No actions yet.'))));
}
let liveMoreOpen = false;

// ---- opponents ------------------------------------------------------------------

const STAT_COLUMNS: [StatKey, string][] = [['vpip', 'VPIP'], ['pfr', 'PFR'], ['threeBet', '3-bet'], ['foldTo3Bet', 'Fold to 3-bet'], ['cbetFlop', 'C-bet flop'], ['foldToCbetFlop', 'Fold to c-bet'], ['aggFreq', 'Agg freq'], ['wtsd', 'WTSD']];

async function renderOpponents(): Promise<void> {
  const root = $('tab-opponents');
  root.textContent = '';
  const profiles = (await storage.allProfiles()).sort((a, b) => b.hands - a.hands);
  if (!profiles.length) { root.append(card('No profiles yet', el('p', { class: 'muted' }, 'Profiles appear after the first completed hand, or after importing a PokerNow log in Settings.'))); return; }
  const detail = el('div');
  const t = el('table', {}, el('tr', {}, el('th', {}, 'Player'), el('th', { class: 'num' }, 'Hands'), el('th', {}, 'Style'), ...STAT_COLUMNS.map(([, n]) => el('th', { class: 'num' }, n))));
  const show = (p: PlayerProfile, row: HTMLElement) => {
    for (const r of Array.from(t.querySelectorAll('tr.sel'))) r.classList.remove('sel');
    row.classList.add('sel');
    const c = classify(p);
    const notes = exploitNotes(p);
    const all = el('table', {}, el('tr', {}, el('th', {}, 'Statistic'), el('th', { class: 'num' }, 'Did / opportunities'), el('th', { class: 'num' }, 'Raw'), el('th', { class: 'num' }, 'Estimate (90% interval)')));
    for (const k of Object.keys(p.stats) as StatKey[]) {
      const q = posterior(p, k);
      if (q.d === 0) continue;
      all.append(el('tr', {}, el('td', {}, k), el('td', { class: 'num' }, `${q.n} / ${q.d}`), el('td', { class: 'num' }, pct(q.raw)), el('td', { class: 'num' }, `${pct(q.mean)} (${pct(q.lo)}–${pct(q.hi)})`)));
    }
    detail.textContent = '';
    detail.append(el('div', { class: 'grid', style: 'margin-top:12px' },
      card(`${p.name}`, dl([
        ['Identifier', p.playerId], ['Hands observed', String(p.hands)],
        ['Tight-aggressive', pct(c.tightAggressive)], ['Loose-aggressive', pct(c.looseAggressive)], ['Tight-passive', pct(c.tightPassive)], ['Loose-passive', pct(c.loosePassive)], ['Unclassified', pct(c.unclassified)],
      ]), el('p', { class: 'muted' }, 'Style probabilities summarise the statistics; decisions use the statistics, not the label.')),
      card('Behavioural observations',
        notes.length ? el('ul', {}, ...notes.map((n) => el('li', {}, `${n.text}: ${n.evidence}`))) : el('p', { class: 'muted' }, 'Nothing clears the evidence threshold yet.'),
        el('h2', {}, 'Bet sizes (postflop)'), el('div', {}, ...SIZE_BUCKETS.map((b, i) => el('span', { class: 'pill' }, `${b}: ${p.betSizes[i]}${p.shownStrengthN[i] ? ` · shown strength ${pct(p.shownStrengthSum[i] / p.shownStrengthN[i])} (n=${p.shownStrengthN[i]})` : ''}`))),
        el('h2', {}, 'Showdowns'), p.showdowns.length ? el('ul', {}, ...p.showdowns.slice(-8).reverse().map((s) => el('li', {}, `${s.cards} · ${s.line}`))) : el('p', { class: 'muted' }, 'None seen.')),
      card('All statistics', el('div', { class: 'scroll' }, all))));
  };
  for (const p of profiles) {
    const row = el('tr', { class: 'click' }, el('td', {}, p.name), el('td', { class: 'num' }, String(p.hands)), el('td', {}, styleLabel(classify(p))),
      ...STAT_COLUMNS.map(([k]) => { const q = posterior(p, k); return el('td', { class: 'num', title: `${q.n}/${q.d} observed` }, q.d ? `${pct(q.mean)} (${q.d})` : '–'); }));
    row.addEventListener('click', () => show(p, row));
    t.append(row);
  }
  root.append(card('Opponents', el('p', { class: 'muted' }, 'Estimate after shrinkage toward a population prior; the number in brackets is the count of real opportunities. Click a row for detail.'), el('div', { class: 'scroll' }, t)), detail);
}

// ---- hand review ------------------------------------------------------------------

async function renderHands(): Promise<void> {
  const root = $('tab-hands');
  root.textContent = '';
  const hands = await storage.recentHands(300);
  if (!hands.length) { root.append(card('No hands stored yet', el('p', { class: 'muted' }, 'Completed hands are stored locally as they are observed.'))); return; }
  const detail = el('div');
  const t = el('table', {}, el('tr', {}, el('th', {}, 'Time'), el('th', {}, 'Table'), el('th', {}, 'Hero'), el('th', {}, 'Board'), el('th', { class: 'num' }, 'Players'), el('th', { class: 'num' }, 'Hero net (bb)'), el('th', {}, 'Status')));
  const show = async (h: HandRecord, row: HTMLElement) => {
    for (const r of Array.from(t.querySelectorAll('tr.sel'))) r.classList.remove('sel');
    row.classList.add('sel');
    const name = (seat: number) => { const s = h.seats.find((x) => x.seat === seat); return s ? `${s.name}${s.position ? ` (${s.position})` : ''}` : `seat ${seat}`; };
    const decisions: DecisionRecord[] = await storage.decisionsForHand(h.handId);
    const lines = el('ol');
    let street = '';
    for (const e of h.events) {
      if (e.street !== street) { street = e.street; lines.append(el('li', { class: 'muted', style: 'list-style:none;margin-left:-18px' }, `— ${street} —`)); }
      const text = `${name(e.seat)} ${e.kind.replace('post-', 'posts ')}${e.kind === 'bet' || e.kind === 'raise' ? ` to ${e.to}` : e.amount ? ` ${e.amount}` : ''}${e.allIn ? ' (all-in)' : ''}${e.uncertain ? ' [deduced, unconfirmed]' : e.inferred ? ' [deduced]' : ''}`;
      const li = el('li', {}, text);
      // Bot decisions made at this point of the hand.
      for (const d of decisions.filter((x) => x.eventCount === e.seq)) {
        li.append(el('div', { class: 'good' }, `bot: ${d.decision.label}${d.decision.equity ? ` · equity ${pct(d.decision.equity.equity, 1)}` : ''} · ${d.execution ? `${d.execution.status}` : 'shown only'}`),
          el('div', { class: 'muted' }, d.decision.candidates.map((c) => `${c.label}${c.ev !== null ? ` EV ${c.ev.toFixed(1)}` : ''} ${pct(c.freq)}`).join(' · ')),
          el('div', { class: 'muted' }, `${d.decision.basis.join(' | ')} — ${d.decision.uncertainty}`));
      }
      lines.append(li);
    }
    detail.textContent = '';
    detail.append(el('div', { class: 'grid', style: 'margin-top:12px' },
      card('Players', el('ul', {}, ...h.seats.filter((s) => s.dealtIn).map((s) => el('li', {}, `${name(s.seat)}: ${s.startStack} → ${s.endStack}${s.shown ? ` · shows ${s.shown.join(' ')}` : ''}${s.seat === h.heroSeat ? ` · hero ${h.heroCards?.join(' ') ?? ''}` : ''}`)))),
      card(`Action · board ${h.board.join(' ') || '–'}`, lines)));
  };
  for (const h of hands) {
    const row = el('tr', { class: 'click' }, el('td', {}, new Date(h.ts).toLocaleString()), el('td', {}, h.tableId), el('td', {}, h.heroCards?.join(' ') ?? '–'), el('td', {}, h.board.join(' ') || '–'),
      el('td', { class: 'num' }, String(h.seats.filter((s) => s.dealtIn).length)),
      el('td', { class: `num ${h.heroNet === null ? '' : h.heroNet >= 0 ? 'good' : 'bad'}` }, h.heroNet === null ? '–' : (h.heroNet / h.bigBlind).toFixed(1)),
      el('td', { class: h.valid ? 'muted' : 'warn' }, h.valid ? 'complete' : h.observedToEnd ? 'reconstruction invalid' : 'ending not observed'));
    row.addEventListener('click', () => void show(h, row));
    t.append(row);
  }
  const valid = hands.filter((h) => h.valid && h.heroNet !== null);
  const net = valid.reduce((a, h) => a + (h.heroNet as number) / h.bigBlind, 0);
  root.append(card(`Hand review · ${hands.length} most recent`, el('p', { class: 'muted' }, `Hero result over ${valid.length} fully observed hands: ${net.toFixed(1)} bb. Click a hand for the action and the bot's reasoning.`), el('div', { class: 'scroll' }, t)), detail);
}

// ---- diagnostics ------------------------------------------------------------------

async function renderDiag(): Promise<void> {
  const root = $('tab-diag');
  const rows = await storage.recentDiagnostics(300);
  root.textContent = '';
  const t = el('table', {}, el('tr', {}, el('th', {}, 'Time'), el('th', {}, 'Level'), el('th', {}, 'Source'), el('th', {}, 'Message')));
  for (const r of rows) t.append(el('tr', {}, el('td', {}, new Date(r.ts).toLocaleTimeString()), el('td', { class: r.level === 'error' ? 'bad' : r.level === 'warn' ? 'warn' : 'muted' }, r.level), el('td', {}, r.source), el('td', {}, r.message + (r.data ? ` ${JSON.stringify(r.data).slice(0, 300)}` : ''))));
  const health = live ? Object.entries(live.observation.health) : [];
  const fresh = live && Date.now() - live.ts < 20000 ? live : null;
  const grid = el('div', { class: 'stack' });
  if (fresh) {
    const l = fresh;
    const problems = Object.values(l.readiness).filter((i) => i.level === 'bad').length;
    grid.append(el('div', { class: 'statusline' }, el('span', { class: `statuspill ${problems ? 'bad' : l.tracker.warnings.length ? 'warn' : 'good'}` }, problems ? `${problems} check(s) failing` : l.tracker.warnings.length ? `${l.tracker.warnings.length} warning(s)` : 'All checks pass'), el('span', { class: 'muted' }, l.status)));
    const who = (seat: number | null) => { const p = l.participation.find((x) => x.seat === seat); return seat === null ? 'nobody' : p ? `seat ${seat} · ${p.position ?? '–'} · ${p.name}` : `seat ${seat}`; };
    const last = l.timeline[l.timeline.length - 1];
    grid.append(section('checks', 'State checks', true, dl(indicatorRows(l)), el('p', { class: 'muted' }, `Heuristic score used by the click guard: ${l.tracker.confidence.toFixed(2)} (1 minus 0.15 per open warning, 0.3 when blocked; not a probability).`)));
    grid.append(section('turn', 'Turn tracking', true, dl([
      ['Observed actor (table)', who(l.tracker.observedActor)],
      ['Predicted actor (engine)', who(l.tracker.predictedActor)],
      ['Actor verified', l.tracker.turnStatus === 'agree' ? el('span', { class: 'good' }, 'yes: both agree') : l.tracker.turnStatus === 'disagree' ? el('span', { class: 'bad' }, 'NO: they disagree') : l.tracker.turnStatus === 'unobserved' ? el('span', { class: 'warn' }, 'not verified: the table shows no acting seat') : '–'],
      ['Last confirmed action', last ? `${last.text} (${last.name})${last.inferred ? ' [deduced]' : ''}` : '–'],
      ['Hero', l.tracker.heroStatus],
      ['Table settled', l.tracker.settled ? 'yes' : 'still changing'],
    ]), l.tracker.blockers.length ? el('ul', { class: 'bad' }, ...l.tracker.blockers.map((b) => el('li', {}, b))) : null));
    const tl = el('div', { class: 'scroll' });
    let street = '';
    for (const e of l.timeline) {
      if (e.street !== street) { street = e.street; tl.append(el('h2', {}, street.charAt(0).toUpperCase() + street.slice(1))); }
      tl.append(el('div', { class: e.uncertain ? 'bad' : e.inferred ? 'warn' : '' }, `${e.text} · ${e.name}${e.uncertain ? ' · deduced, UNCONFIRMED' : e.inferred ? ' · deduced' : ''}`, e.note ? el('span', { class: 'muted' }, ` (${e.note})`) : null));
    }
    if (l.hand && l.hand.phase !== 'complete') tl.append(el('div', { class: 'muted' }, `Next: ${who(l.tracker.predictedActor)}${l.tracker.turnStatus === 'agree' ? ' (verified)' : l.tracker.turnStatus === 'disagree' ? ` (table shows ${who(l.tracker.observedActor)})` : ' (not verified)'}`));
    grid.append(section('timeline', 'Action timeline (current hand)', true, l.timeline.length ? tl : el('p', { class: 'muted' }, 'No hand is being tracked.'), el('p', { class: 'muted' }, 'Entries marked "deduced" were not displayed by the table: they follow from the rules (see the note). Nothing else is added.')));
    const pt = el('table', {}, el('tr', {}, el('th', {}, 'Seat'), el('th', {}, 'Player'), el('th', {}, 'Pos'), el('th', {}, 'In this hand'), el('th', {}, 'Betting'), el('th', {}, 'Presence'), el('th', { class: 'num' }, 'Stack'), el('th', { class: 'num' }, 'Street'), el('th', { class: 'num' }, 'Hand')));
    for (const p of l.participation) pt.append(el('tr', {}, el('td', {}, String(p.seat)), el('td', {}, p.name + (p.isHero ? ' (hero)' : '')), el('td', {}, p.position ?? ''),
      el('td', {}, p.dealtIn ? (p.folded ? 'folded' : 'contesting') : p.sittingOut ? 'sitting out' : 'waiting for next hand'),
      el('td', {}, !p.dealtIn ? '–' : p.folded ? '–' : p.allIn ? 'all-in' : p.canAct ? 'can act' : '–'),
      el('td', { class: p.left || p.disconnected ? 'warn' : '' }, p.left ? 'no longer visible' : p.disconnected ? 'disconnected' : 'present'),
      el('td', { class: 'num' }, p.stack === null ? '?' : String(p.stack)), el('td', { class: 'num' }, p.streetCommit ? String(p.streetCommit) : ''), el('td', { class: 'num' }, p.totalCommit ? String(p.totalCommit) : '')));
    grid.append(section('participation', 'Player participation (per-seat state)', false, el('div', { class: 'scroll' }, pt)));
    grid.append(section('system', 'System', false, dl([
      ['Mode', l.estop ? 'EMERGENCY STOP' : l.acting ? 'autonomous (acting)' : l.mode],
      ['Engine status', l.status],
      ['Phase', l.tracker.phase],
      ['Hand id', l.hand?.handId ?? '–'],
      ['Decision deadline', l.deadlineMs !== null ? `${(l.deadlineMs / 1000).toFixed(1)}s${l.observation.timeRemainingMs === null ? ' (assumed clock)' : ''}` : '–'],
      ['Last execution', l.lastExecution ? `${l.lastExecution.status}: ${l.lastExecution.action} (${l.lastExecution.reason})` : '–'],
      ['Hands tracked', String(l.tracker.handsSeen)],
      ['Recommendation state', `${l.recommendation.state}${l.recommendation.context ? ` · ${l.recommendation.context.key}` : ''}`],
    ])));
    grid.append(section('issues', `Tracker messages this hand (${l.tracker.issues.length})`, l.tracker.issues.length > 0, l.tracker.issues.length ? el('ul', { class: 'warn' }, ...l.tracker.issues.map((i) => el('li', {}, i))) : el('p', { class: 'muted' }, 'None.')));
    if (l.tracker.discrepancies.length) grid.append(section('discrepancies', `Discrepancies this hand (${l.tracker.discrepancies.length})`, true, el('ul', {}, ...l.tracker.discrepancies.map((x) => el('li', { class: x.blocking ? 'bad' : 'warn' }, `[${x.kind}] ${x.street}, after ${x.eventCount} events: ${x.message}`)))));
  }
  // ---- debug bundle ----
  const scope = el('select', { id: 'bundle-scope' }, el('option', { value: '1' }, 'Most recent hand'), el('option', { value: '5' }, 'Last 5 hands'), el('option', { value: '20' }, 'Last 20 hands'), el('option', { value: 'all' }, 'Everything stored'));
  scope.value = '5';
  const anon = el('input', { type: 'checkbox', id: 'bundle-anon' });
  const recOn = el('input', { type: 'checkbox', id: 'bundle-rec' });
  recOn.checked = settings.recordDiagnostics;
  recOn.addEventListener('change', () => void saveSettings({ recordDiagnostics: recOn.checked }));
  const preview = el('textarea', { id: 'bundle-preview', spellcheck: 'false', style: 'height:220px;display:none' });
  const bundleMsg = el('p', { class: 'muted' });
  const make = async () => {
    const frames = await storage.recentFrames();
    const b = buildBundle(frames, {
      hands: scope.value === 'all' ? 'all' : Number(scope.value), anonymise: anon.checked, extensionVersion: chrome.runtime.getManifest().version, userAgent: navigator.userAgent,
      settings: { mode: settings.mode, minConfidence: settings.minConfidence, selectorOverrides: settings.selectorOverrides, recordDiagnostics: settings.recordDiagnostics },
      framesPruned: await storage.framesPruned(), framesDroppedBeforeStorage: live?.recorder.dropped ?? 0,
      handRecords: await storage.recentHands(300), decisions: await storage.recentDecisions(800), diagnostics: await storage.recentDiagnostics(300),
    });
    bundleMsg.textContent = `${b.hands.length} hand(s), ${b.hands.reduce((a, x) => a + x.frames.length, 0)} frame(s). ${b.dropped.note}`;
    return b;
  };
  const previewBtn = el('button', { class: 'btn', type: 'button' }, 'Review before export');
  previewBtn.addEventListener('click', async () => { preview.value = JSON.stringify(await make(), null, 1); preview.style.display = 'block'; });
  const exportBtn = el('button', { class: 'btn', type: 'button', id: 'bundle-export' }, 'Export Debug Bundle');
  exportBtn.addEventListener('click', async () => {
    // If the reviewed text was edited by hand, export exactly that text.
    const text = preview.style.display !== 'none' && preview.value ? preview.value : JSON.stringify(await make());
    try { JSON.parse(text); } catch { bundleMsg.textContent = 'The edited text is not valid JSON; nothing exported.'; return; }
    const a = el('a', { href: URL.createObjectURL(new Blob([text], { type: 'application/json' })), download: `poker-bot-debug-${new Date().toISOString().replace(/[:.]/g, '-')}.json` });
    a.click();
    URL.revokeObjectURL(a.href);
  });
  const clearFrames = el('button', { class: 'btn', type: 'button' }, 'Delete recorded frames');
  clearFrames.addEventListener('click', async () => { await storage.clear(['frames', 'meta']); bundleMsg.textContent = 'Recorded frames deleted.'; });
  grid.append(section('bundle', 'Debug bundle (record, export)', true,
    el('p', { class: 'muted' }, 'A local recording of what the table showed (seats, names, stacks, bets, board, your own cards, buttons) and what the reconstruction made of it, one frame per change. It is stored in this browser only and leaves it only when you export the file yourself. It contains no passwords, cookies or tokens, and no opponent cards other than those shown at showdown.'),
    el('label', {}, recOn, ` Record while a table is open${fresh ? ` (${fresh.recorder.recorded} frames this session, ${fresh.recorder.dropped} dropped)` : ''}`),
    el('label', { for: 'bundle-scope' }, 'What to export'), scope,
    el('label', {}, anon, ' Replace player names and the table id with placeholders'),
    el('div', { style: 'display:flex;gap:8px;flex-wrap:wrap;margin-top:8px' }, previewBtn, exportBtn, clearFrames), bundleMsg, preview));
  root.append(grid, el('div', { class: 'stack', style: 'margin-top:12px' },
    section('elements', 'Page elements (last read)', false, health.length ? el('div', {}, ...health.map(([k, ok]) => el('span', { class: `pill ${ok ? 'good' : 'bad'}` }, `${k}: ${ok ? 'found' : 'MISSING'}`))) : el('p', { class: 'muted' }, 'No live table.'),
      el('p', { class: 'muted' }, 'A missing element usually means PokerNow changed its markup. Selectors can be overridden in Settings without rebuilding.'),
      live?.observation.problems.length ? el('ul', { class: 'warn' }, ...live.observation.problems.map((p) => el('li', {}, p))) : null)),
  section('log', `Log · ${rows.length} most recent`, false, rows.length ? el('div', { class: 'scroll' }, t) : el('p', { class: 'muted' }, 'Empty.')));
}

// ---- settings ------------------------------------------------------------------

async function saveSettings(patch: Partial<Settings>): Promise<void> {
  settings = sanitizeSettings({ ...settings, ...patch });
  await chrome.storage.local.set({ settings });
  renderStop();
}

function renderSettings(): void {
  const root = $('tab-settings');
  root.textContent = '';
  const numField = (label: string, key: 'exploitWeight' | 'minThinkMs' | 'maxThinkMs' | 'assumedClockMs' | 'minConfidence', step: string) => {
    const i = el('input', { type: 'number', step, value: String(settings[key]), id: `set-${key}` });
    i.addEventListener('change', () => void saveSettings({ [key]: Number(i.value) }).then(() => { i.value = String(settings[key]); }));
    return el('div', {}, el('label', { for: `set-${key}` }, label), i);
  };
  const timeout = el('select', { id: 'set-timeout' }, el('option', { value: 'check-fold' }, 'Check, or fold if a check is not possible'), el('option', { value: 'nothing' }, 'Do nothing (let the site time the seat out)'));
  timeout.value = settings.timeoutAction;
  timeout.addEventListener('change', () => void saveSettings({ timeoutAction: timeout.value as Settings['timeoutAction'] }));
  const panel = el('input', { type: 'checkbox', id: 'set-panel' });
  panel.checked = settings.showPanel;
  panel.addEventListener('change', () => void saveSettings({ showPanel: panel.checked }));
  const sel = el('textarea', { id: 'set-selectors', spellcheck: 'false' });
  sel.value = JSON.stringify(settings.selectorOverrides, null, 2);
  const selMsg = el('span', { class: 'muted' });
  const selBtn = el('button', { class: 'btn', type: 'button' }, 'Save selector overrides');
  selBtn.addEventListener('click', () => {
    try { void saveSettings({ selectorOverrides: JSON.parse(sel.value || '{}') }).then(() => { sel.value = JSON.stringify(settings.selectorOverrides, null, 2); selMsg.textContent = ' Saved.'; }); }
    catch { selMsg.textContent = ' Not valid JSON.'; }
  });
  const file = el('input', { type: 'file', accept: '.csv,.txt', id: 'import-file' });
  const importMsg = el('p', { class: 'muted' });
  file.addEventListener('change', async () => {
    const f = file.files?.[0];
    if (!f) return;
    const text = await f.text();
    const lines = /^\uFEFF?entry,at,order/.test(text) ? parseLogCsv(text) : text.split(/\r?\n/);
    const res = replayLog(lines, `log-${f.name.replace(/\W+/g, '-')}`);
    const profiles = new Map<string, PlayerProfile>();
    for (const p of await storage.allProfiles()) profiles.set(p.playerId, p);
    let stored = 0;
    for (const h of res.hands) {
      if (!h.valid) continue;
      const ids = applyHandToProfiles(profiles, h.hand, h.reveals, Date.now());
      if (await storage.saveHand(toHandRecord(h, 'imported-log', Date.now()), ids.map((i) => profiles.get(i)!))) stored++;
    }
    importMsg.textContent = `${res.hands.length} Hold'em hands read, ${res.hands.filter((h) => h.valid).length} replayed cleanly, ${stored} newly stored, ${res.unsupportedHands} other-variant hands skipped, ${res.unknownLines.length} unrecognised lines.`;
  });
  const exportBtn = el('button', { class: 'btn', type: 'button' }, 'Export all local data (JSON)');
  exportBtn.addEventListener('click', async () => {
    const blob = new Blob([JSON.stringify(await storage.exportAll())], { type: 'application/json' });
    const a = el('a', { href: URL.createObjectURL(blob), download: 'poker-bot-data.json' });
    a.click();
    URL.revokeObjectURL(a.href);
  });
  const clearBtn = el('button', { class: 'btn', type: 'button' }, 'Delete all profiles, hands and logs');
  clearBtn.addEventListener('click', async () => {
    if (!confirm('Delete every stored opponent profile, hand, decision and diagnostic entry? This cannot be undone.')) return;
    await storage.clear(['profiles', 'hands', 'decisions', 'diagnostics', 'frames', 'meta']);
    importMsg.textContent = 'Local data deleted.';
  });
  root.append(el('div', { class: 'grid' },
    card('Play', el('p', { class: 'muted' }, 'Mode and table authorisation are set in the toolbar popup.'),
      numField('Opponent-adjustment weight (0 = baseline only, 1 = full)', 'exploitWeight', '0.1'),
      numField('Minimum state score to act (0.4–1; heuristic, 0.15 is lost per open warning)', 'minConfidence', '0.05'),
      numField('Think time before acting, minimum (ms)', 'minThinkMs', '100'),
      numField('Think time before acting, maximum (ms)', 'maxThinkMs', '100'),
      numField('Action clock to assume when the page shows none (ms)', 'assumedClockMs', '1000'),
      el('label', { for: 'set-timeout' }, 'When the clock is nearly out and the state is not trusted'), timeout,
      el('label', {}, panel, ' Show the in-page panel')),
    card('PokerNow selectors', el('p', { class: 'muted' }, 'JSON object of selector overrides, e.g. {"foldBtn": "button.fold"}. Keys are the names in src/bot/adapter/pokernow/dom.ts.'), sel, el('div', { style: 'margin-top:8px' }, selBtn, selMsg)),
    card('Data', el('p', { class: 'muted' }, 'Everything is stored in this browser profile only. Nothing is uploaded.'),
      el('label', { for: 'import-file' }, 'Import a PokerNow log (CSV download) into profiles and hand review'), file, importMsg,
      el('div', { style: 'display:flex;gap:8px;flex-wrap:wrap;margin-top:8px' }, exportBtn, clearBtn))));
}

// ---- shell ------------------------------------------------------------------------

function renderStop(): void {
  const b = $('estop');
  b.textContent = settings.estop ? 'Stopped. Click to clear' : 'EMERGENCY STOP';
  b.className = settings.estop ? 'clear' : '';
}

function renderTab(): void {
  if (activeTab === 'live') renderLive();
  else if (activeTab === 'opponents') void renderOpponents();
  else if (activeTab === 'hands') void renderHands();
  else if (activeTab === 'diag') void renderDiag();
  else renderSettings();
}

async function init(): Promise<void> {
  settings = sanitizeSettings((await chrome.storage.local.get('settings')).settings);
  live = ((await chrome.storage.session.get('live')).live as LiveState | undefined) ?? null;
  for (const b of Array.from(document.querySelectorAll<HTMLButtonElement>('nav button'))) {
    b.addEventListener('click', () => {
      activeTab = b.dataset.tab as string;
      for (const o of Array.from(document.querySelectorAll('nav button'))) o.setAttribute('aria-selected', String(o === b));
      for (const s of Array.from(document.querySelectorAll('main section'))) (s as HTMLElement).hidden = s.id !== `tab-${activeTab}`;
      renderTab();
    });
  }
  $('estop').addEventListener('click', () => void saveSettings({ estop: !settings.estop }));
  chrome.storage.onChanged.addListener((c, area) => {
    if (area === 'session' && c.live) {
      const prev = live;
      live = c.live.newValue as LiveState;
      if (activeTab === 'live') renderLive();
      // The diagnostics tab is redrawn only when the reconstruction changed, so its controls stay usable.
      else if (activeTab === 'diag' && live && (!prev || prev.timeline.length !== live.timeline.length || prev.hand?.handId !== live.hand?.handId || prev.tracker.turnStatus !== live.tracker.turnStatus || prev.tracker.blockers.join() !== live.tracker.blockers.join()) && !document.getElementById('bundle-preview')?.matches(':focus') && (document.getElementById('bundle-preview') as HTMLElement | null)?.style.display === 'none') void renderDiag();
    }
    if (area === 'local' && c.settings) { settings = sanitizeSettings(c.settings.newValue); renderStop(); }
  });
  setInterval(() => { if (activeTab === 'live') renderLive(); }, 2000);
  renderStop();
  renderTab();
}
void init();
