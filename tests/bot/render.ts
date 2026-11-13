// Test double for the table: turns a rules-engine hand into the observation a
// player in `heroSeat` would see (and into PokerNow-shaped HTML for DOM tests).
import { CardId, RANK_CHARS, rankOf, suitOf } from '../../src/bot/cards';
import { HandState, legalActions, potTotal } from '../../src/bot/table/engine';
import { emptyControls, TableObs } from '../../src/bot/adapter/observation';

export function render(h: HandState, heroSeat: number, holes: Map<number, [CardId, CardId]>, ts: number): TableObs {
  const showdown = h.phase === 'showdown' || (h.phase === 'complete' && h.wentToShowdown);
  const la = h.toAct === heroSeat ? legalActions(h) : null;
  const controls = emptyControls();
  if (la) {
    controls.fold = true; controls.check = la.canCheck; controls.call = la.canCall ? la.callAmount : null; controls.raise = la.canRaise;
    controls.minRaiseTo = la.canRaise ? la.minRaiseTo : null; controls.maxRaiseTo = la.canRaise ? la.maxRaiseTo : null;
  }
  return {
    ts, tableId: 'test', gameType: 'NLH', handLabel: null,
    seats: h.seats.map((s) => ({
      seat: s.seat, name: s.name, playerId: s.playerId, stack: s.stack, bet: h.phase === 'complete' ? 0 : s.streetCommit,
      folded: s.folded, sittingOut: !s.dealtIn, isHero: s.seat === heroSeat, hasCards: s.dealtIn && (!s.folded || s.seat === heroSeat),
      shownCards: showdown && s.dealtIn && !s.folded && s.seat !== heroSeat ? [...holes.get(s.seat)!] : null,
    })),
    dealerSeat: h.buttonSeat, board: h.board.slice(), heroCards: holes.get(heroSeat) ?? null,
    pot: h.phase === 'complete' ? 0 : potTotal(h), smallBlind: h.smallBlind, bigBlind: h.bigBlind, ante: h.ante || null,
    toActSeat: h.toAct, heroToAct: h.toAct === heroSeat, controls, timeRemainingMs: null, problems: [],
  };
}

const SUIT_SYMBOL = ['♥', '♦', '♣', '♠'];
const cardHtml = (c: CardId | null) => (c === null
  ? '<div class="card-container"><div class="card"></div></div>'
  : `<div class="card-container flipped"><div class="card"><span class="value">${RANK_CHARS[rankOf(c)] === 'T' ? '10' : RANK_CHARS[rankOf(c)]}</span><span class="suit">${SUIT_SYMBOL[suitOf(c)]}</span></div></div>`);

/** PokerNow-shaped markup for an observation (seat numbers are 1-based on the site). */
export function toHtml(o: TableObs, opts: { gameType?: string; heroCardCount?: number } = {}): string {
  const seats = o.seats.map((s) => {
    const cls = ['table-player', `table-player-${s.seat}`, s.isHero ? 'you-player' : '', s.folded ? 'fold' : '', s.sittingOut ? 'sitting-out' : '', o.toActSeat === s.seat ? 'decision-current' : ''].filter(Boolean).join(' ');
    let cards = '';
    if (s.hasCards) {
      const ids: (CardId | null)[] = s.isHero ? (o.heroCards ? [...o.heroCards] : [null, null]) : s.shownCards ? [...s.shownCards] : [null, null];
      if (s.isHero && opts.heroCardCount) while (ids.length < opts.heroCardCount) ids.push((ids[0] as number + 7 * ids.length) % 52);
      cards = ids.map(cardHtml).join('');
    }
    return `<div class="${cls}"><div class="table-player-cards">${cards}</div><div class="table-player-infos-ctn"><a class="table-player-name">${s.name}</a>`
      + `<div class="table-player-stack"><span class="chips-value">${s.stack?.toLocaleString('en-US') ?? ''}</span></div></div>`
      + (s.bet > 0 ? `<div class="table-player-bet-value"><span class="chips-value">${s.bet.toLocaleString('en-US')}</span></div>` : '') + '</div>';
  }).join('\n');
  const c = o.controls;
  const buttons = o.heroToAct
    ? `<div class="game-decisions-ctn"><div class="action-signal">Your Turn</div>`
      + (c.call !== null ? `<button class="button-1 call" type="button">Call ${c.call.toLocaleString('en-US')}</button>` : '')
      + (c.raise ? `<button class="button-1 raise" type="button">${c.call !== null ? 'Raise' : 'Bet'}</button>` : '')
      + (c.check ? '<button class="button-1 check" type="button">Check</button>' : '')
      + (c.fold ? '<button class="button-1 fold" type="button">Fold</button>' : '')
      + (c.raise ? `<form class="raise-controller-form" style="display:none"><input class="value" type="text" value=""><input type="range" min="${c.minRaiseTo}" max="${c.maxRaiseTo}"><input type="submit" value="Bet"></form>` : '')
      + '</div>'
    : '<div class="game-decisions-ctn"><button class="button-1 check-fold" type="button">Check or Fold</button></div>';
  return `<div class="table">
  <div class="blind-value-ctn"><span class="game-type">${opts.gameType ?? 'NLH'}</span><span class="chips-value">${o.smallBlind}</span> / <span class="chips-value">${o.bigBlind}</span></div>
  <div class="dealer-button-ctn dealer-position-${o.dealerSeat}"></div>
  <div class="table-pot-size"><span class="add-on"><span class="chips-value">${o.pot?.toLocaleString('en-US') ?? ''}</span></span></div>
  <div class="table-cards">${o.board.map(cardHtml).join('')}</div>
  ${seats}
  ${buttons}
</div>`;
}
