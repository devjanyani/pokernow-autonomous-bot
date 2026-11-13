// ============================================================
// Classification of PokerNow's action buttons.
//
// A button is classified by its LABEL, never by its CSS class or position.
// Recorded on a real table (2026-11-13): when a check is free PokerNow shows
//
//     [Bet 5] [Bet] [Check] [Fold]
//
// and the "Bet 5" shortcut carries the SAME class as the call button
// (`button-1 action-button call with-tip call green`). Reading it by class
// turned a minimum-bet shortcut into "Call 5" and blocked every free-check
// decision after the flop. "Bet 5" is a wager Hero may make; "Call 5" is an
// outstanding bet Hero faces. They are different actions with the same number.
//
// Pure functions: no DOM access here, so recorded button texts can be
// re-classified offline (regression fixtures, replay).
// ============================================================

import type { ControlsObs } from '../observation';

export type ControlKind =
  | 'fold' | 'check' | 'call' | 'bet' | 'raise' | 'all-in'
  /** A pre-selection made before Hero's turn ("Check or Fold", "Call Any"). Never a current action. */
  | 'pre-action'
  /** Anything else in the control area (time bank, back, size helpers, card buttons). */
  | 'other';

/** One button exactly as the page showed it, plus what it means. */
export interface ActionControl {
  kind: ControlKind;
  /**
   * Amount on the label, or null when the label has none.
   *   call   -> additional chips needed to call
   *   bet    -> total wager of that shortcut ("Bet 5": a bet of 5)
   *   raise  -> total the shortcut raises to
   *   all-in -> amount when shown
   */
  amount: number | null;
  /** True for a sizing shortcut ("Bet 5", "Min Raise", "1/2 Pot", "Pot", "All In" inside the bet form). */
  preset: boolean;
  /** Label text as displayed (trimmed, shortened). */
  text: string;
  /** Class list as displayed (shortened). Diagnostics only: never used to decide the kind. */
  cls: string;
  visible: boolean;
  /** Not disabled and not a suspended (pre-turn) control. */
  enabled: boolean;
}

export interface RawControl { text: string; cls: string; visible: boolean; disabled: boolean }

const PRE_ACTION_RE = /check\s*(or|\/)\s*fold|fold\s*(to)?\s*any|call\s*any|check\s*\/\s*fold/i;
const AMOUNT_RE = /(\d[\d,]*(?:\.\d+)?)\s*([kmb])?/i;
const SIZE_HELPER_RE = /^(min(imum)?\s*(raise|bet)|max|\d+\s*\/\s*\d+\s*pot|\d+(\.\d+)?\s*x(\s*pot)?|\d+\s*%(\s*pot)?|pot|\d+(\.\d+)?\s*bb)$/i;

/** "1,250" / "12.50" / "1.2k" -> number; null when the text is not a chip amount. */
export function parseChipText(text: string | null | undefined): number | null {
  if (!text) return null;
  const t = text.replace(/[\s,$€£]/g, '').toLowerCase();
  const m = t.match(/^(\d+(?:\.\d+)?)([kmb])?$/);
  if (!m) return null;
  const mult = m[2] === 'k' ? 1e3 : m[2] === 'm' ? 1e6 : m[2] === 'b' ? 1e9 : 1;
  return Math.round(Number(m[1]) * mult * 100) / 100;
}

/**
 * The action word of a label. The whole word must be present: a one-letter keyboard hint ("C", "F",
 * "R") in front of or behind the label is not an action, and neither is a class name.
 */
function actionWord(text: string): { kind: 'fold' | 'check' | 'call' | 'bet' | 'raise' | 'all-in'; rest: string } | null {
  let best: { kind: 'fold' | 'check' | 'call' | 'bet' | 'raise' | 'all-in'; index: number; end: number } | null = null;
  const words: [RegExp, 'fold' | 'check' | 'call' | 'bet' | 'raise' | 'all-in'][] = [
    [/all[\s-]?in/i, 'all-in'], [/\bfold\b/i, 'fold'], [/\bcheck\b/i, 'check'], [/\bcall\b/i, 'call'], [/\bre-?raise\b|\braise\b/i, 'raise'], [/\bbet\b/i, 'bet'],
  ];
  for (const [re, kind] of words) {
    const m = re.exec(text);
    if (m && (best === null || m.index < best.index)) best = { kind, index: m.index, end: m.index + m[0].length };
  }
  return best ? { kind: best.kind, rest: text.slice(best.end) } : null;
}

export function classifyControl(raw: RawControl): ActionControl {
  const text = raw.text.replace(/\s+/g, ' ').trim();
  const suspended = /(^|\s)suspended-action(\s|$)/.test(raw.cls);
  const base = { text: text.slice(0, 40), cls: raw.cls.replace(/\s+/g, ' ').trim().slice(0, 80), visible: raw.visible, enabled: raw.visible && !raw.disabled && !suspended };
  if (!text) return { kind: 'other', amount: null, preset: false, ...base };
  if (PRE_ACTION_RE.test(text)) return { kind: 'pre-action', amount: null, preset: false, ...base, enabled: false };
  // Sizing helpers of the bet form ("Min Raise", "1/2 Pot", "Pot"): they fill the amount box, they are not actions.
  if (SIZE_HELPER_RE.test(text)) return { kind: 'other', amount: null, preset: true, ...base };
  if (/extra time|time bank|^back$|show|^[-+]$/i.test(text)) return { kind: 'other', amount: null, preset: false, ...base };
  const w = actionWord(text);
  if (!w) return { kind: 'other', amount: null, preset: false, ...base };
  // The amount is the number that FOLLOWS the action word ("Call 5", "Raise to 24", "Bet 1,250").
  const m = AMOUNT_RE.exec(w.rest);
  const amount = m ? parseChipText(m[1] + (m[2] ?? '')) : null;
  // "Bet 5" / "Raise 24": a one-click shortcut for that size. Plain "Bet" / "Raise" opens the amount box.
  const preset = (w.kind === 'bet' || w.kind === 'raise') && amount !== null;
  return { kind: w.kind, amount, preset, ...base };
}

/** The normalised controls observation from the buttons on the page. Only visible, enabled controls count as available. */
export function controlsFromButtons(raws: readonly RawControl[]): ControlsObs {
  return controlsFromActions(raws.map(classifyControl));
}

export function controlsFromActions(actions: ActionControl[]): ControlsObs {
  const live = actions.filter((a) => a.enabled);
  const first = (k: ControlKind) => live.find((a) => a.kind === k);
  const call = first('call');
  const wager = live.filter((a) => a.kind === 'bet' || a.kind === 'raise');
  const presets = wager.filter((a) => a.preset).map((a) => a.amount as number);
  const hasBet = wager.some((a) => a.kind === 'bet'), hasRaise = wager.some((a) => a.kind === 'raise');
  return {
    fold: !!first('fold'),
    check: !!first('check'),
    // Only a button that SAYS "Call" is a call. No amount on it: unknown (NaN), never zero.
    call: call ? (call.amount ?? Number.NaN) : null,
    raise: wager.length > 0 || !!first('all-in'),
    minRaiseTo: null, maxRaiseTo: null,
    wagerKind: hasBet && !hasRaise ? 'bet' : hasRaise && !hasBet ? 'raise' : hasBet && hasRaise ? 'mixed' : null,
    presets,
    allIn: !!first('all-in'),
    actions,
  };
}

/** Re-classify the raw "class|text" strings stored in a debug bundle (recorded while visible). */
export function controlsFromRawStrings(buttons: readonly string[]): ControlsObs {
  return controlsFromButtons(buttons.map((b) => { const i = b.indexOf('|'); return { cls: i >= 0 ? b.slice(0, i) : '', text: i >= 0 ? b.slice(i + 1) : b, visible: true, disabled: false }; }));
}

/** One line per control for diagnostics: `bet 5 preset "Bet 5" [visible, enabled]`. */
export function describeControls(c: ControlsObs): string[] {
  return (c.actions ?? []).filter((a) => a.kind !== 'other').map((a) => `${a.kind}${a.amount !== null ? ` ${a.amount}` : ''}${a.preset ? ' (size shortcut)' : ''} "${a.text}" [${a.visible ? 'visible' : 'hidden'}, ${a.enabled ? 'enabled' : 'disabled'}]`);
}
