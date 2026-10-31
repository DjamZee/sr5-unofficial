/**
 * The trade window's other half: the offer lives in a hidden world setting, written only by the active gamemaster's
 * browser, so everyone reads the same offer and every change goes through one place, one at a time. The window is
 * only a view of it (trade-window.js). Nothing moves before the end, where it all goes through the transfer journal
 * (item-transfer.js): done in one piece, finished after a reload, undone on a refusal.
 *
 * A comfort of the table, no rule of the book (decisions of DjamZ, 30/10). "Le MJ valide les échanges", unticked by
 * default: no click of the gamemaster, but one has to be connected to write on another's sheet.
 */
import {
  accountRefusal, acceptRefusal, bothAccepted, changed, cleanQuantity, cleanSum, fundsMismatch, newTrade, offerLine,
  otherSide, SIDES, tradeCardHtml
} from "./trade-rules.js"
import {
  mergeStickWrites, planCash, planObject, tradeRefusal
} from "./item-transfer-rules.js"
import {
  documentStore, lineLabel, SR5ItemTransfer
} from "./item-transfer.js"
import {
  SR5Credstick
} from "./credstick.js"
import {
  canLoot
} from "./storage-rules.js"
import {
  pileSize, splitFunds
} from "../rolls/roll-helpers/pickpocket-rules.js"
import {
  updateLedger
} from "../system/gm-ledger.js"
import {
  escape, isActiveGM as isWriter
} from "../system/card-helpers.js"
import {
  formatNumber
} from "../helpers/number-format.js"

export const TRADE_LEDGER = "sr5TradeLedger"
export const TRADE_APPROVAL = "sr5TradeGMApproval"

// An offer nobody touched for a day is an offer forgotten: it holds nothing, the register just lets it go
const STALE_MS = 24 * 3600 * 1000

const newId = () => foundry.utils.randomID()

export class SR5Trade {

  static ledger() {
    try {
      return game.settings.get("sr5", TRADE_LEDGER) ?? {
      }
    } catch {
      return {
      }
    }
  }

  static get(id) {
    return SR5Trade.ledger()[id]
  }

  /* -------------------------------------------- */
  /*  Who is concerned                            */
  /* -------------------------------------------- */

  /** Who answers for an actor: whoever plays it and is here, else the gamemaster's hand. */
  static respondersOf(actor) {
    const here = game.users.filter(u => u.active && !u.isGM && actor?.testUserPermission(u, "OWNER"))
    const players = here.filter(u => u.character?.id === (actor.isToken ? actor.token?.baseActor?.id : actor.id))
    const chosen = players.length ? players : here
    return chosen.length ? chosen.map(u => u.id) : [game.users.activeGM?.id].filter(Boolean)
  }

  static mayAct(user, trade, side) {
    if (user?.isGM) return true
    return !!documentStore.actor(trade[side].actor)?.testUserPermission(user, "OWNER")
  }

  /** Whether this browser shows this trade: a side answered from here. */
  static concerns(trade, user = game.user) {
    // Whoever was asked; and a player back after a reload or a disconnection, for her own character
    return SIDES.some(side => (trade[side].users ?? []).includes(user.id) ||
      (!user.isGM && user.character && documentStore.actor(trade[side].actor)?.id === user.character.id))
  }

  /* -------------------------------------------- */
  /*  From a browser                              */
  /* -------------------------------------------- */

  /** Open a trade from a sheet or the players' list. No gamemaster connected: no window. */
  static async open(actor, other) {
    return SR5ItemTransfer.toActiveGM("tradeOpen", {
      from: actor.uuid, to: other.uuid
    })
  }

  static send(id, op, data = {
  }) {
    return SR5ItemTransfer.toActiveGM(op, {
      id, ...data
    })
  }

  /* -------------------------------------------- */
  /*  The gamemaster's side                       */
  /* -------------------------------------------- */

  static handle(data, senderId) {
    return SR5ItemTransfer.serial(() => SR5Trade.#dispatch(data, senderId))
  }

  static async #dispatch(data, senderId) {
    const requester = game.users.get(senderId)
    if (!requester) return
    if (data.op === "tradeOpen") return SR5Trade.#open(data, requester)
    const trade = foundry.utils.deepClone(SR5Trade.get(String(data.id ?? "")))
    if (!trade) return
    if (!SIDES.some(key => SR5Trade.mayAct(requester, trade, key))) return
    const side = SIDES.includes(data.side) ? data.side : null
    if (!side && !["tradeCash", "tradeCancel"].includes(data.op)) return
    if (side && !SR5Trade.mayAct(requester, trade, side)) return
    switch (data.op) {
      case "tradeAdd": return SR5Trade.#add(trade, side, data, requester)
      case "tradeQuantity": return SR5Trade.#quantity(trade, side, data)
      case "tradeRemove": return SR5Trade.#edit(trade, () => {
        const before = trade[side].items.length
        trade[side].items = trade[side].items.filter(line => line.id !== data.itemId)
        return trade[side].items.length !== before
      })
      case "tradeNuyen": return SR5Trade.#edit(trade, () => {
        const sum = cleanSum(data.value)
        if (sum === trade[side].nuyen) return false
        trade[side].nuyen = sum
        return true
      })
      case "tradeCash": return SR5Trade.#edit(trade, () => {
        if (trade.cash === !!data.value) return false
        trade.cash = !!data.value
        return true
      })
      case "tradeAccept": return SR5Trade.#accept(trade, side, data, requester)
      case "tradeUnaccept": {
        if (trade.state !== "open") return
        trade[side].accepted = false
        return SR5Trade.#write(trade)
      }
      case "tradeCancel": return SR5Trade.#cancel(trade, requester)
    }
  }

  static #write(trade) {
    return updateLedger(TRADE_LEDGER, ledger => ({
      ...ledger, [trade.id]: trade
    }))
  }

  static #forget(id) {
    return updateLedger(TRADE_LEDGER, ledger => {
      delete ledger[id]
      return ledger
    })
  }

  static #tellBoth(trade, level, key, data = {
  }) {
    const users = new Set(SIDES.flatMap(side => trade[side].users ?? []))
    return Promise.all([...users].map(userId => SR5ItemTransfer.notify(userId, level, key, data)))
  }

  static async #open(data, requester) {
    const from = documentStore.actor(String(data.from ?? ""))
    const to = documentStore.actor(String(data.to ?? ""))
    if (!from || !to || from === to || !canLoot(from) || !canLoot(to)) return SR5ItemTransfer.notify(requester.id, "warn", "SR5.WARN_TradeNoPartner")
    if (!requester.isGM && !from.testUserPermission(requester, "OWNER")) return SR5ItemTransfer.notify(requester.id, "warn", "SR5.WARN_TradeNotYours")
    const ledger = SR5Trade.ledger()
    // The same two already at it, or two windows opened at once: one offer. The window opens again if it was closed
    const same = Object.values(ledger).find(t => t.state === "open" &&
      [t.a.actor, t.b.actor].includes(from.uuid) && [t.a.actor, t.b.actor].includes(to.uuid))
    if (same) {
      const side = same.a.actor === from.uuid ? "a" : "b"
      if ((same[side].users ?? []).includes(requester.id)) return SR5ItemTransfer.notify(requester.id, "info", "SR5.TradeAlreadyOpen")
      same[side].users = [...(same[side].users ?? []), requester.id]
      return SR5Trade.#write(foundry.utils.deepClone(same))
    }
    const party = (actor, users) => ({
      actor: actor.uuid, name: actor.token?.name ?? actor.name, img: actor.img, users
    })
    const responders = SR5Trade.respondersOf(to)
    const trade = newTrade({
      id: newId(), now: Date.now(), a: party(from, [requester.id]), b: party(to, responders)
    })
    await SR5Trade.#write(trade)
    await Promise.all(responders.filter(id => id !== requester.id).map(id => SR5ItemTransfer.notify(id, "info", "SR5.TradeIncoming", {
      actor: trade.a.name, other: trade.b.name
    })))
  }

  /** A change of the offer: nothing written when nothing changed. */
  static async #edit(trade, change) {
    if (trade.state !== "open") return
    if (!change()) return
    return SR5Trade.#write(changed(trade))
  }

  static #shareOf(item, quantity) {
    return splitFunds(item, quantity)?.taken ?? 0
  }

  static async #add(trade, side, data, requester) {
    if (trade.state !== "open") return
    const actor = documentStore.actor(trade[side].actor)
    const item = actor?.items.get(String(data.itemId ?? ""))
    if (!item) return SR5ItemTransfer.notify(requester.id, "warn", "SR5.WARN_Transfer_gone", {
      name: ""
    })
    const refusal = tradeRefusal(item, actor.items)
    if (refusal) return SR5ItemTransfer.notify(requester.id, "warn", `SR5.WARN_Transfer_${refusal}`, {
      name: item.name
    })
    return SR5Trade.#edit(trade, () => {
      const quantity = cleanQuantity(data.quantity ?? pileSize(item), pileSize(item))
      const line = offerLine(item, quantity, SR5Trade.#shareOf(item, quantity))
      const known = trade[side].items.findIndex(l => l.id === item.id)
      if (known >= 0) trade[side].items[known] = line
      else trade[side].items.push(line)
      return true
    })
  }

  static #quantity(trade, side, data) {
    return SR5Trade.#edit(trade, () => {
      const line = trade[side].items.find(l => l.id === data.itemId)
      const item = documentStore.actor(trade[side].actor)?.items.get(data.itemId)
      if (!line || !item) return false
      const quantity = cleanQuantity(data.value, pileSize(item))
      if (quantity === line.quantity) return false
      Object.assign(line, offerLine(item, quantity, SR5Trade.#shareOf(item, quantity)))
      return true
    })
  }

  static async #cancel(trade, requester) {
    // What is running finishes: closing a window then changes nothing
    if (trade.state === "running") return
    await SR5Trade.#forget(trade.id)
    const others = SIDES.flatMap(side => trade[side].users ?? []).filter(id => id !== requester.id)
    await Promise.all([...new Set(others)].map(id => SR5ItemTransfer.notify(id, "info", "SR5.TradeCancelled", {
      user: requester.name
    })))
  }

  static async #accept(trade, side, data, requester) {
    const refusal = acceptRefusal(trade, data.version)
    // A second click on a trade already going through asks for nothing, and hears nothing
    if (refusal === "closed") return
    if (refusal) return SR5ItemTransfer.notify(requester.id, "warn", "SR5.WARN_TradeOfferChanged")
    trade[side].accepted = true
    if (!bothAccepted(trade)) return SR5Trade.#write(trade)
    return SR5Trade.#conclude(trade)
  }

  /** Both agreed to the same offer. It is read again against the sheets before anyone is bothered with it. */
  static async #conclude(trade) {
    const plan = await SR5Trade.plan(trade)
    if (plan.refusal) return SR5Trade.#reopen(trade, plan)
    if (game.settings.get("sr5", TRADE_APPROVAL)) {
      trade.state = "approval"
      await SR5Trade.#write(trade)
      return void SR5Trade.#askApproval(trade)
    }
    return SR5Trade.#run(trade)
  }

  /** It cannot be done as it stands: back to the offer, both told why, nothing moved. */
  static async #reopen(trade, plan) {
    trade.state = "open"
    SR5Trade.#refreshLines(trade)
    changed(trade)
    await SR5Trade.#write(trade)
    return SR5Trade.#tellBoth(trade, "warn", `SR5.WARN_Trade_${plan.refusal}`, plan.data ?? {
    })
  }

  // The offer shows the sheets as they are now: what a stick holds today, what is left of a pile, nothing of what left
  static #refreshLines(trade) {
    for (const side of SIDES) {
      const actor = documentStore.actor(trade[side].actor)
      trade[side].items = trade[side].items.flatMap(line => {
        const item = actor?.items.get(line.id)
        if (!item) return []
        const quantity = cleanQuantity(line.quantity, pileSize(item))
        return [offerLine(item, quantity, SR5Trade.#shareOf(item, quantity))]
      })
    }
  }

  static #approving = new Set()

  /** Never awaited by what received the request: a question can wait, and nothing else waits for it. */
  static async #askApproval(trade) {
    if (SR5Trade.#approving.has(trade.id)) return
    SR5Trade.#approving.add(trade.id)
    const accepted = await foundry.applications.api.DialogV2.confirm({
      window: {
        title: game.i18n.localize("SR5.TradeApproveTitle")
      },
      content: SR5Trade.summaryHtml(trade),
      rejectClose: false,
    })
    SR5Trade.#approving.delete(trade.id)
    await SR5ItemTransfer.serial(async () => {
      const now = foundry.utils.deepClone(SR5Trade.get(trade.id))
      if (now?.state !== "approval") return
      if (accepted !== true) {
        now.state = "open"
        changed(now)
        await SR5Trade.#write(now)
        return SR5Trade.#tellBoth(now, "warn", "SR5.WARN_TradeRefusedByGM")
      }
      const plan = await SR5Trade.plan(now)
      if (plan.refusal) return SR5Trade.#reopen(now, plan)
      return SR5Trade.#run(now)
    })
  }

  static async #run(trade) {
    const plan = await SR5Trade.plan(trade)
    if (plan.refusal) return SR5Trade.#reopen(trade, plan)
    trade.state = "running"
    await SR5Trade.#write(trade)
    await SR5ItemTransfer.execute(plan.steps, {
      kind: "trade", tradeId: trade.id, cardId: newId()
    })
  }

  /**
   * The end of a trade's list, on whichever browser finished it. Paid, a trade is over: its card and its closing can be
   * played again, its card once, and nothing reopens it. Undone, the offer is back. Stopped halfway, it is neither: it
   * leaves the register, so that it cannot be paid again, and a gamemaster looks at the sheets.
   */
  static async finishList(after, result) {
    const trade = foundry.utils.deepClone(SR5Trade.get(after.tradeId))
    if (!trade) return
    if (result.ok) {
      if (!game.messages.has(after.cardId)) await foundry.documents.ChatMessage.create({
        _id: after.cardId,
        content: tradeCardHtml(escape(game.i18n.localize("SR5.TradeTitle")), SR5Trade.summaryHtml(trade)),
        whisper: game.users.filter(u => u.isGM || SIDES.some(side => SR5Trade.mayAct(u, trade, side))).map(u => u.id),
      }, {
        keepId: true
      })
      await SR5Trade.#forget(trade.id)
      return SR5Trade.#tellBoth(trade, "info", "SR5.TradeDone")
    }
    if (!result.undone) {
      await SR5Trade.#forget(trade.id)
      return SR5Trade.#tellBoth(trade, "error", "SR5.ERROR_TransferNotUndone")
    }
    trade.state = "open"
    changed(trade)
    await SR5Trade.#write(trade)
    return SR5Trade.#tellBoth(trade, "warn", "SR5.WARN_TradeFailed")
  }

  /** The active gamemaster arrives: the register is cleaned of what cannot go on, and what was waiting is asked again. */
  static async recover() {
    if (!isWriter()) return
    await SR5ItemTransfer.serial(async () => {
      const journal = SR5ItemTransfer.journal()
      const running = new Set(Object.values(journal.runs ?? {
      }).map(run => run.after?.tradeId).filter(Boolean))
      for (const entry of Object.values(SR5Trade.ledger())) {
        const trade = foundry.utils.deepClone(entry)
        if (trade.state === "running") {
          if (running.has(trade.id)) continue
          // Stopped before its list was written, or after it left the journal undone: nothing moved
          trade.state = "open"
          await SR5Trade.#write(changed(trade))
        } else if (Date.now() - (trade.time ?? 0) > STALE_MS) await SR5Trade.#forget(trade.id)
        else if (trade.state === "approval") void SR5Trade.#askApproval(trade)
      }
    })
  }

  /* -------------------------------------------- */
  /*  The list                                    */
  /* -------------------------------------------- */

  /**
   * The list of everything that moves, read on the sheets as they are now. Any refusal stops the whole trade.
   * @returns {Promise<{steps: object[]}|{refusal: string, data?: object}>}
   */
  static async plan(trade) {
    const actors = {
      a: documentStore.actor(trade.a.actor), b: documentStore.actor(trade.b.actor)
    }
    if (!actors.a || !actors.b) return {
      refusal: "partnerGone"
    }
    const steps = []
    for (const side of SIDES) {
      const giver = actors[side]
      const receiver = actors[otherSide(side)]
      const takenIds = new Set(receiver.items.map(i => i.id))
      // What the receiver gives in this same trade joins nothing: its count is about to change
      let toItems = receiver.items.filter(i => !trade[otherSide(side)].items.some(line => line.id === i.id))
      for (const line of trade[side].items) {
        const item = giver.items.get(line.id)
        if (!item) return {
          refusal: "itemGone", data: {
            name: line.name
          }
        }
        const refusal = tradeRefusal(item, giver.items)
        if (refusal) return {
          refusal: "itemRefused", data: {
            name: line.name
          }
        }
        if (line.quantity > pileSize(item)) return {
          refusal: "itemGone", data: {
            name: line.name
          }
        }
        if (fundsMismatch(line, SR5Trade.#shareOf(item, line.quantity))) return {
          refusal: "stickChanged", data: {
            name: line.name
          }
        }
        // Worn or switched on, it leaves the bearer's equipment; how it arrives is the receiving sheet's rule
        const ruled = await receiver.sheet?.dropRules?.(foundry.utils.deepClone(item.toObject()))
        if (!ruled) return {
          refusal: "sheetRefuses", data: {
            name: line.name, actor: receiver.name
          }
        }
        const planned = planObject({
          item, quantity: line.quantity, from: giver.uuid, to: receiver.uuid, fromItems: giver.items, toItems,
          takenIds, newId,
          arrive: data => {
            if (ruled.system.isActive !== undefined) data.system.isActive = ruled.system.isActive
            return data
          },
        })
        if (planned.refused) return {
          refusal: "sheetRefuses", data: {
            name: line.name, actor: receiver.name
          }
        }
        steps.push(...planned.steps)
        // A pile is counted once by the list: the next identical line of the offer makes its own pile
        const joined = planned.steps.find(step => step.op === "update" && step.actor === receiver.uuid)
        if (joined) toItems = toItems.filter(i => i.id !== joined.id)
      }
    }
    const money = SR5Trade.#planMoney(trade, actors)
    if (money.refusal) return money
    steps.push(...money.steps)
    return {
      steps
    }
  }

  static #hasAccounts(actor) {
    return actor.type === "actorPc"
  }

  static #planMoney(trade, actors) {
    const steps = []
    // A stick on the offer neither pays nor receives: what it holds is what the offer shows
    const sticks = {
    }
    for (const side of SIDES) {
      sticks[side] = SR5Credstick.carried(actors[side]).filter(s => !trade[side].items.some(line => line.id === s.id)).map(s => ({
        id: s.id, funds: SR5Credstick.funds(s), room: SR5Credstick.room(s)
      }))
    }
    const writes = {
      a: [], b: []
    }
    for (const side of SIDES) {
      const nuyen = trade[side].nuyen
      if (!nuyen) continue
      const payer = actors[side]
      const payee = actors[otherSide(side)]
      const data = {
        actor: payer.name, other: payee.name, amount: formatNumber(nuyen)
      }
      const refusal = accountRefusal({
        nuyen, cash: trade.cash, payerHasAccounts: SR5Trade.#hasAccounts(payer), payeeHasAccounts: SR5Trade.#hasAccounts(payee),
        balance: SR5Credstick.ledgerBalance(payer),
      })
      if (refusal) return {
        refusal, data
      }
      if (trade.cash) {
        const cash = planCash(nuyen, sticks[side], sticks[otherSide(side)])
        if (cash.refusal) return {
          refusal: cash.refusal, data
        }
        writes[side].push(...cash.debits)
        writes[otherSide(side)].push(...cash.credits)
      } else {
        const line = (type, key, actor, name) => ({
          op: "create", actor: actor.uuid, data: {
            _id: newId(),
            name: game.i18n.format(key, {
              name
            }),
            type: "itemNuyen",
            img: "systems/sr5/assets/img/items/itemNuyen.svg",
            system: {
              amount: nuyen, type, date: new Date().toISOString().slice(0, 10),
            },
          },
        })
        steps.push(line("loss", "SR5.TradeLedgerLoss", payer, payee.name), line("gain", "SR5.TradeLedgerGain", payee, payer.name))
      }
    }
    for (const side of SIDES) steps.push(...mergeStickWrites(actors[side].uuid, writes[side]))
    return {
      steps
    }
  }

  /** What was exchanged, for the card and the gamemaster's question. */
  static summaryHtml(trade) {
    const sideHtml = side => {
      const offer = trade[side]
      const lines = offer.items.map(line => `<li>${escape(lineLabel(line))}</li>`)
      if (offer.nuyen) lines.push(`<li>${escape(game.i18n.format(trade.cash ? "SR5.TradeSumCash" : "SR5.TradeSumAccount", {
        amount: formatNumber(offer.nuyen)
      }))}</li>`)
      const body = lines.length ? `<ul>${lines.join("")}</ul>` : `<p>${escape(game.i18n.localize("SR5.TradeGivesNothing"))}</p>`
      return `<p><strong>${escape(game.i18n.format("SR5.TradeGives", {
        actor: offer.name, other: trade[otherSide(side)].name
      }))}</strong></p>${body}`
    }
    return SIDES.map(sideHtml).join("")
  }

  /* -------------------------------------------- */
  /*  Setting up                                  */
  /* -------------------------------------------- */

  static register() {
    game.settings.register("sr5", TRADE_LEDGER, {
      scope: "world",
      config: false,
      type: Object,
      default: {
      },
      onChange: () => SR5Trade.#changed(),
    })
  }

  static async #changed() {
    const {
      SR5TradeWindow
    } = await import("./trade-window.js")
    SR5TradeWindow.sync()
  }

  /** Once the world is up: the windows left open by a reload, the journal, the register. */
  static async ready() {
    await SR5ItemTransfer.recover()
    await SR5Trade.recover().catch(error => console.error("SR5 | trade", error))
    await SR5Trade.#changed()
  }

  /** A gamemaster left, or arrived: if this browser has just become the one that writes, it picks everything up. */
  static async onUserConnected(user) {
    if (!user?.isGM || !game.ready) return
    await SR5ItemTransfer.recover()
    await SR5Trade.recover().catch(error => console.error("SR5 | trade", error))
  }
}
