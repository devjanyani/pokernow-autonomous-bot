// ============================================================
// Small DOM helpers shared by the dashboard tabs. All text that comes from the
// table (names, ids, log lines) is inserted as text nodes, never as HTML.
// ============================================================

import { cardView } from '../view';
import type { Page, SortDir } from '../viewmodel';

export type Child = Node | string | null | undefined | false;
export function el<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, string> = {}, ...children: Child[]): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) { if (k === 'class') e.className = v; else e.setAttribute(k, v); }
  for (const c of children) if (c !== null && c !== undefined && c !== false) e.append(c);
  return e;
}
export const $ = (id: string) => document.getElementById(id) as HTMLElement;
export const card = (title: string | null, ...children: Child[]) => el('div', { class: 'card' }, title ? el('h2', {}, title) : null, ...children);
export const tag = (text: string, tone = 'muted', title = '') => el('span', { class: `tag ${tone}`, ...(title ? { title } : {}) }, text);
export const dl = (rows: [string, string | Node][]) => { const d = el('dl'); for (const [k, v] of rows) d.append(el('dt', {}, k), el('dd', {}, v)); return d; };
export const empty = (title: string, text: string) => el('div', { class: 'empty' }, el('div', { class: 'empty-title' }, title), el('div', { class: 'muted' }, text));

/** A playing card. `null` draws a face-down card. Text only: no images, nothing fetched. */
export function playingCard(c: string | null, size: 'lg' | 'md' | 'sm' | 'xs' = 'md', dim = false): HTMLElement {
  if (c === null) return el('span', { class: `pc ${size} back${dim ? ' dim' : ''}`, role: 'img', 'aria-label': dim ? 'card not dealt yet' : 'face-down card' });
  const v = cardView(c);
  return el('span', { class: `pc ${size}${v.red ? ' red' : ''}`, role: 'img', 'aria-label': v.label }, el('span', { class: 'r' }, v.rank), el('span', { class: 's' }, v.suit));
}
export const cardRow = (cards: readonly string[] | null | undefined, size: 'md' | 'sm' | 'xs' = 'xs') =>
  cards && cards.length ? el('span', { class: 'cards tight' }, ...cards.map((c) => playingCard(c, size))) : el('span', { class: 'muted' }, '–');

export function button(label: string, onClick: () => void | Promise<void>, opts: { tone?: 'danger' | 'primary' | 'quiet'; id?: string; title?: string; disabled?: boolean } = {}): HTMLButtonElement {
  const b = el('button', { class: `btn${opts.tone ? ` ${opts.tone}` : ''}`, type: 'button', ...(opts.id ? { id: opts.id } : {}), ...(opts.title ? { title: opts.title } : {}) }, label);
  b.disabled = !!opts.disabled;
  b.addEventListener('click', () => { void onClick(); });
  return b;
}

export function searchBox(value: string, placeholder: string, onInput: (v: string) => void, id?: string): HTMLInputElement {
  const i = el('input', { type: 'search', class: 'search', placeholder, 'aria-label': placeholder, ...(id ? { id } : {}) });
  i.value = value;
  let t = 0;
  i.addEventListener('input', () => { clearTimeout(t); t = window.setTimeout(() => onInput(i.value), 140); });
  return i;
}
export function select<T extends string>(value: T, options: [T, string][], onChange: (v: T) => void, label: string): HTMLSelectElement {
  const s = el('select', { 'aria-label': label }, ...options.map(([v, text]) => el('option', { value: v }, text)));
  s.value = value;
  s.addEventListener('change', () => onChange(s.value as T));
  return s;
}

/** Column header that sorts when clicked. */
export function sortHeader<K extends string>(label: string, key: K, cur: { key: K; dir: SortDir }, onSort: (key: K) => void, cls = '', title = ''): HTMLElement {
  const active = cur.key === key;
  const b = el('button', { class: 'sortbtn', type: 'button' }, label, el('span', { class: 'arrow', 'aria-hidden': 'true' }, active ? (cur.dir === 'asc' ? '▲' : '▼') : ''));
  b.addEventListener('click', () => onSort(key));
  return el('th', { class: `${cls}${active ? ' sorted' : ''}`, 'aria-sort': active ? (cur.dir === 'asc' ? 'ascending' : 'descending') : 'none', ...(title ? { title } : {}) }, b);
}
export function nextSort<K extends string>(cur: { key: K; dir: SortDir }, key: K, firstDir: SortDir = 'desc'): { key: K; dir: SortDir } {
  return cur.key === key ? { key, dir: cur.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: firstDir };
}

export function pager(p: Page<unknown>, onPage: (page: number) => void, noun: string): HTMLElement {
  const prev = button('‹ Previous', () => onPage(p.page - 1), { tone: 'quiet', disabled: p.page <= 1 });
  const next = button('Next ›', () => onPage(p.page + 1), { tone: 'quiet', disabled: p.page >= p.pages });
  return el('div', { class: 'pager' }, el('span', { class: 'muted' }, p.total ? `${p.from}–${p.to} of ${p.total} ${noun}` : `0 ${noun}`), el('span', { class: 'spacer' }), prev, el('span', { class: 'muted' }, `Page ${p.page} of ${p.pages}`), next);
}

/** Checkbox bound to a Set of selected keys. */
export function check(selected: Set<string>, key: string, onChange: () => void, label: string, disabled = false): HTMLInputElement {
  const c = el('input', { type: 'checkbox', 'aria-label': label });
  c.checked = selected.has(key);
  c.disabled = disabled;
  c.addEventListener('click', (e) => e.stopPropagation());
  c.addEventListener('change', () => { if (c.checked) selected.add(key); else selected.delete(key); onChange(); });
  return c;
}
export function checkAll(selected: Set<string>, keys: readonly string[], onChange: () => void): HTMLInputElement {
  const c = el('input', { type: 'checkbox', 'aria-label': 'Select all rows shown' });
  const on = keys.filter((k) => selected.has(k)).length;
  c.checked = keys.length > 0 && on === keys.length;
  c.indeterminate = on > 0 && on < keys.length;
  c.addEventListener('change', () => { for (const k of keys) { if (c.checked) selected.add(k); else selected.delete(k); } onChange(); });
  return c;
}

export function toast(text: string, tone: 'good' | 'warn' | 'bad' = 'good'): void {
  let host = document.getElementById('toasts');
  if (!host) { host = el('div', { id: 'toasts', role: 'status', 'aria-live': 'polite' }); document.body.append(host); }
  const t = el('div', { class: `toast ${tone}` }, text);
  host.append(t);
  setTimeout(() => t.remove(), 6000);
}

export function download(name: string, text: string, type = 'application/json'): void {
  const a = el('a', { href: URL.createObjectURL(new Blob([text], { type })), download: name });
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
export const stamp = () => new Date().toISOString().replace(/[:.]/g, '-');

export interface ConfirmOptions {
  title: string;
  /** What will happen, one statement per line. */
  lines: string[];
  /** What will NOT happen (shown separately so the scope is explicit). */
  keeps?: string[];
  confirmLabel: string;
  danger?: boolean;
  /** Extra choices shown as checkboxes; their state is returned. */
  options?: { id: string; label: string; checked?: boolean }[];
  /** When set, the confirm button stays disabled until this word is typed. */
  typeToConfirm?: string;
}
/** Modal confirmation. Resolves with the option states, or null when cancelled. Nothing happens on Escape or Cancel. */
export function confirmDialog(o: ConfirmOptions): Promise<Record<string, boolean> | null> {
  return new Promise((resolve) => {
    const d = el('dialog', { class: 'confirm', 'aria-labelledby': 'confirm-title' });
    const boxes = (o.options ?? []).map((x) => { const c = el('input', { type: 'checkbox', id: `confirm-opt-${x.id}` }); c.checked = !!x.checked; return { x, c }; });
    const ok = el('button', { class: `btn ${o.danger ? 'danger' : 'primary'}`, type: 'button', id: 'confirm-ok' }, o.confirmLabel);
    const cancel = el('button', { class: 'btn', type: 'button', id: 'confirm-cancel' }, 'Cancel');
    let typed: HTMLInputElement | null = null;
    if (o.typeToConfirm) {
      typed = el('input', { type: 'text', id: 'confirm-typed', autocomplete: 'off', 'aria-label': `Type ${o.typeToConfirm} to confirm` });
      ok.disabled = true;
      typed.addEventListener('input', () => { ok.disabled = typed!.value.trim().toLowerCase() !== o.typeToConfirm!.toLowerCase(); });
    }
    const parts: Child[] = [
      el('h3', { id: 'confirm-title' }, o.title),
      el('ul', { class: 'confirm-lines' }, ...o.lines.map((l) => el('li', {}, l))),
      o.keeps?.length ? el('div', { class: 'confirm-keeps' }, el('div', { class: 'label' }, 'Not affected'), el('ul', {}, ...o.keeps.map((l) => el('li', {}, l)))) : null,
      ...boxes.map(({ x, c }) => el('label', { class: 'checkline' }, c, el('span', {}, x.label))),
      typed ? el('label', { class: 'typeline' }, `Type "${o.typeToConfirm}" to confirm`, typed) : null,
      el('div', { class: 'confirm-actions' }, cancel, ok)];
    for (const c of parts) if (c) d.append(c);
    const close = (result: Record<string, boolean> | null) => { d.close(); d.remove(); resolve(result); };
    cancel.addEventListener('click', () => close(null));
    d.addEventListener('cancel', (e) => { e.preventDefault(); close(null); });
    ok.addEventListener('click', () => close(Object.fromEntries(boxes.map(({ x, c }) => [x.id, c.checked]))));
    document.body.append(d);
    d.showModal();
    cancel.focus();
  });
}
