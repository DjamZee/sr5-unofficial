/**
 * The offer of a trade: two sides, each with its objects and a sum, and one box for the whole exchange, on the
 * accounts or in cash. Kept free of Foundry globals so the rules can be read, and tested, alone.
 *
 * Every change to an offer raises its version and takes both acceptances back: an "Accept" carries the version it
 * read, so a click on an offer that has just changed accepts nothing.
 */
export const SIDES = ["a", "b"]

export const otherSide = side => side === "a" ? "b" : "a"

/** A new trade, as the gamemaster's register holds it. */
export function newTrade({
  id, a, b, now
}) {
  const side = party => ({
    ...party, items: [], nuyen: 0, accepted: false
  })
  return {
    id, version: 1, state: "open", cash: false, time: now, a: side(a), b: side(b)
  }
}

/** An offer changed: its version moves on and nobody has agreed to it anymore. */
export function changed(trade) {
  trade.version += 1
  for (const side of SIDES) trade[side].accepted = false
  return trade
}

/** A sum of nuyens as it can be offered: a whole number, at least 0. */
export function cleanSum(value) {
  const sum = Math.floor(Number(value))
  return Number.isFinite(sum) && sum > 0 ? sum : 0
}

/** A quantity as it can be offered: a whole number, from 1 to the size of the pile. */
export function cleanQuantity(value, max) {
  const quantity = Math.floor(Number(value))
  return Math.min(Math.max(1, max), Math.max(1, Number.isFinite(quantity) ? quantity : 1))
}

/**
 * The line of an object on the offer. The money of a credstick is written on it as what the other side sees and
 * accepts: `funds` is what that many tubes hold, shared as splitFunds shares it.
 */
export function offerLine(item, quantity, share) {
  return {
    id: item.id, name: item.name, img: item.img, quantity, max: Math.max(1, Math.floor(Number(item.system?.quantity) || 1)),
    isStick: item.system?.isCredstick === true, funds: share,
  }
}

/**
 * The chat card of a done trade, in the dress of the system's cards. Its body stays open: what was traded is read at once,
 * a .SR-CardContent would arrive folded. Both strings are already escaped.
 */
export function tradeCardHtml(title, summary) {
  return `<div class="sr-trade-card"><header class="SR-CardHeader sr-trade-card-header"><i class="fas fa-right-left"></i><span>${title}</span></header><div class="sr-trade-card-content">${summary}</div></div>`
}

/** Whether both have accepted this very version. */
export function bothAccepted(trade) {
  return SIDES.every(side => trade[side].accepted === true)
}

/** Whether an "Accept" may count: the offer is still open, and is still the one the click read. */
export function acceptRefusal(trade, version) {
  if (!trade || trade.state !== "open") return "closed"
  if (Number(version) !== trade.version) return "changed"
  return null
}

/**
 * Why the money of an offer cannot be paid, or null, before anything is planned. A figurant, a vehicle or a bag
 * have no accounts (Argent-et-creditubes): they pay in cash.
 * @param {object} p
 * @param {number} p.nuyen the sum this side offers
 * @param {boolean} p.cash the box of the exchange
 * @param {boolean} p.payerHasAccounts
 * @param {boolean} p.payeeHasAccounts
 * @param {number} p.balance the payer's accounts
 */
export function accountRefusal({
  nuyen, cash, payerHasAccounts, payeeHasAccounts, balance
}) {
  if (!nuyen || cash) return null
  if (!payerHasAccounts || !payeeHasAccounts) return "noAccounts"
  return nuyen > balance ? "accountShort" : null
}

/** The offered sticks' money must be what the offer shows: a stick loaded or spent since is refused, never carried. */
export function fundsMismatch(line, currentShare) {
  return line.isStick && line.funds !== currentShare
}
