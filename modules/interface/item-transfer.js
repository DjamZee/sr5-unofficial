/**
 * Dropping an object from one sheet on another moves it, instead of copying it (decision of DjamZ, 30/10). The
 * player's browser cannot write on someone else's sheet: the request goes to the active gamemaster, who reads
 * everything again on his side and is the only one to write, one transfer at a time.
 *
 * Before the first write, the list of steps goes in his journal, a hidden world setting. His page reloaded halfway,
 * or another gamemaster taking over, runs the list again from its start; each step knows when it is done already, so
 * nothing moves twice (item-transfer-rules.js). A write refused halfway undoes the list.
 */
import {
  bundleFunds, bundleOf, bundleRefusal, hasMark, isPhysical, LEDGER_TYPES, movesRatherThanCopies, orderSteps, strandLineKey, planObject, runSteps, withMark
} from "./item-transfer-rules.js"
import {
  pileSize, splitFunds
} from "../rolls/roll-helpers/pickpocket-rules.js"
import {
  isStorable
} from "./storage-rules.js"
import {
  isLocked
} from "./storage-lock.js"
import {
  updateLedger
} from "../system/gm-ledger.js"
import {
  escape, isActiveGM as isWriter
} from "../system/card-helpers.js"
import {
  formatNumber
} from "../helpers/number-format.js"
import {
  SR5_SystemHelpers
} from "../system/utilitySystem.js"

export const TRANSFER_JOURNAL = "sr5TransferJournal"

const newId = () => foundry.utils.randomID()

// How long a request waits for a list another gamemaster has still running: a list is a few writes
const BUSY_MS = 15000
const BUSY_STEP_MS = 200

class TransferBusy extends Error {}

/** What the rules read and write, on the documents. Always the source: a prepared value is not what is written. */
export const documentStore = {
  actor(uuid) {
    return fromUuidSync(uuid)
  },
  has(uuid, id) {
    return !!this.actor(uuid)?.items.has(id)
  },
  read(uuid, id, path) {
    return foundry.utils.getProperty(this.actor(uuid)?.items.get(id)?._source ?? {
    }, path)
  },
  create(uuid, data) {
    return this.actor(uuid).createEmbeddedDocuments("Item", [data], {
      keepId: true
    })
  },
  update(uuid, id, changes) {
    return this.actor(uuid).items.get(id).update(changes)
  },
  remove(uuid, id) {
    return this.actor(uuid).deleteEmbeddedDocuments("Item", [id])
  },
}

/** How a line reads in a question, a card or a notice: "Balles ×20", "Créditube (3 000 ¥)". */
export function lineLabel({
  name, quantity, funds
}) {
  const count = quantity > 1 ? ` ×${quantity}` : ""
  const money = funds > 0 ? ` (${formatNumber(funds)} ¥)` : ""
  return `${name}${count}${money}`
}

export class SR5ItemTransfer {

  /* -------------------------------------------- */
  /*  The journal                                 */
  /* -------------------------------------------- */

  static journal() {
    try {
      return game.settings.get("sr5", TRANSFER_JOURNAL) ?? {
      }
    } catch {
      return {
      }
    }
  }

  static #queue = Promise.resolve()

  // The lists this page is running, or has taken over: nobody here starts them a second time
  static #mine = new Set()

  static #enqueue(job) {
    const run = SR5ItemTransfer.#queue.then(job)
    SR5ItemTransfer.#queue = run.catch(() => {})
    return run
  }

  /**
   * One transfer at a time on the gamemaster's browser: two read at once would both see the same balance. A list another
   * gamemaster has still running is his to finish, this one becoming the active gamemaster meanwhile changes nothing:
   * nothing here reads or writes the sheets until he is done. A list nobody runs any more comes before any new request:
   * written over by a newer list, the stick it was cut on could no longer tell what it did.
   */
  static serial(job) {
    return SR5ItemTransfer.#enqueue(async () => {
      await SR5ItemTransfer.#othersDone()
      await SR5ItemTransfer.#takeLists()
      return job()
    })
  }

  /** The lists left in the journal that fall to this browser, run to their end. To be called in turn. */
  static async #takeLists() {
    for (const id of Object.keys(SR5ItemTransfer.journal().runs ?? {
    })) {
      const run = foundry.utils.deepClone(SR5ItemTransfer.journal().runs?.[id])
      if (!run || SR5ItemTransfer.#mine.has(id)) continue
      const mine = run.owner === game.user.id
      if (!mine && (!isWriter() || game.users.get(run.owner)?.active)) continue
      SR5ItemTransfer.#mine.add(id)
      if (!mine) await SR5ItemTransfer.#journalRun(id, known => known && {
        ...known, owner: game.user.id
      })
      await SR5ItemTransfer.#drive(id, run, true)
    }
  }

  static async #othersDone() {
    const running = () => Object.values(SR5ItemTransfer.journal().runs ?? {
    }).some(run => run.owner !== game.user.id && game.users.get(run.owner)?.active)
    // By the clock: a page in the background runs its timers late
    const start = Date.now()
    while (running()) {
      if (Date.now() - start >= BUSY_MS) throw new TransferBusy()
      await new Promise(resolve => setTimeout(resolve, BUSY_STEP_MS))
    }
  }

  /**
   * Run a list of steps, written in the journal first when a gamemaster runs it, with who runs it and how far it has come.
   * A player alone with two of her own sheets has no journal to write in: a write refused still undoes the list, a page
   * closed halfway does not (see the wiki).
   * @param {object[]} steps
   * @param {object} [after] what to do once done, kept in the journal for whoever finishes the list
   * @returns {Promise<{ok: boolean, error?: Error, undone?: boolean}>}
   */
  static async execute(steps, after = null) {
    const ordered = orderSteps(steps)
    if (!game.user.isGM) {
      const result = await runSteps(ordered, documentStore)
      await SR5ItemTransfer.#settle(after, result)
      return result
    }
    const id = newId()
    SR5ItemTransfer.#mine.add(id)
    await SR5ItemTransfer.#journalRun(id, () => ({
      owner: game.user.id, steps: ordered, after, reached: 0
    }))
    return SR5ItemTransfer.#drive(id, {
      steps: ordered, after, reached: 0
    }, false)
  }

  static #journalRun(id, change) {
    return updateLedger(TRANSFER_JOURNAL, journal => {
      const next = change(journal.runs?.[id])
      journal.runs = {
        ...journal.runs
      }
      if (next) journal.runs[id] = next
      else delete journal.runs[id]
      return journal
    })
  }

  /**
   * Take a list to its end. Finished, it says so before anything is told: from then on nothing runs its steps again or
   * reopens what it paid, and what is left (the card, the closing of a trade) can be played again. It leaves the journal
   * last.
   */
  static async #drive(id, run, resuming) {
    let result = {
      ok: true
    }
    if (!run.finished) {
      result = await runSteps(run.steps, documentStore, {
        from: run.reached ?? 0, resuming, runId: id,
        onStep: done => SR5ItemTransfer.#journalRun(id, known => known && {
          ...known, reached: done
        }),
      })
      if (result.ok) await SR5ItemTransfer.#journalRun(id, known => known && {
        ...known, finished: true
      })
    }
    try {
      if (!result.ok) {
        // Out of the journal first, what follows reopens an offer whose list must not be run again; and in the same
        // write, what could not go back: nothing leaves the journal before it has a home
        await SR5ItemTransfer.#strand(id, result)
        SR5ItemTransfer.#report(result)
      }
      await SR5ItemTransfer.#settle(run.after, result)
      if (result.ok) await SR5ItemTransfer.#journalRun(id, () => null)
    } finally {
      SR5ItemTransfer.#mine.delete(id)
    }
    return result
  }

  /** The list leaves the journal, and what could not go back or stayed elsewhere is kept there until a gamemaster acts. */
  static async #strand(id, result) {
    const named = result.stranded?.length || result.kept?.length
    const entry = named ? {
      cardId: newId(), items: result.stranded ?? [], kept: result.kept ?? []
    } : null
    await updateLedger(TRANSFER_JOURNAL, journal => {
      if (journal.runs) delete journal.runs[id]
      if (entry) journal.strands = {
        ...journal.strands, [id]: entry
      }
      return journal
    })
    if (entry) {
      await SR5ItemTransfer.#strandCard(id, entry)
      await SR5ItemTransfer.#dropIfTold(id, entry)
    }
  }

  // Once told, what only stayed with its new bearer has nothing left to give back
  static async #dropIfTold(id, entry) {
    if (entry.items.length || !game.messages.has(entry.cardId)) return
    await updateLedger(TRANSFER_JOURNAL, journal => {
      if (journal.strands) delete journal.strands[id]
      return journal
    })
  }

  // Who an uuid in a card is, when he still exists
  static #nameOf(uuid) {
    return documentStore.actor(uuid)?.name ?? game.i18n.localize("SR5.TransferOwnerGone")
  }

  static #strandHtml(id, entry) {
    const line = item => game.i18n.format(strandLineKey(item), {
      actor: SR5ItemTransfer.#nameOf(item.actor), name: item.name ?? "",
      amount: formatNumber(item.amount ?? item.funds ?? 0),
    })
    const stranded = entry.items.map((item, index) => `<li>${escape(line(item))}
      <button type="button" class="sr-transfer-restore" data-strand="${id}" data-index="${index}" ${item.restored ? "disabled" : ""}>
      ${escape(game.i18n.localize(item.restored ? "SR5.TransferRestored" : "SR5.TransferRestore"))}</button></li>`).join("")
    const kept = entry.kept.map(item => `<li>${escape(game.i18n.format(strandLineKey(item, true), {
      actor: SR5ItemTransfer.#nameOf(item.actor), name: item.name ?? "", amount: formatNumber(item.funds ?? 0),
    }))}</li>`).join("")
    return `<div class="sr-transfer-strand"><p><strong>${escape(game.i18n.localize("SR5.TransferStrandTitle"))}</strong></p>
      ${stranded ? `<p>${escape(game.i18n.localize("SR5.TransferStrandLost"))}</p><ul>${stranded}</ul>` : ""}
      ${kept ? `<p>${escape(game.i18n.localize("SR5.TransferStrandStayed"))}</p><ul>${kept}</ul>` : ""}</div>`
  }

  /** For the gamemasters only; its id is known before it exists, so that a reload writes it once. */
  static async #strandCard(id, entry) {
    if (game.messages.has(entry.cardId)) return
    await foundry.documents.ChatMessage.create({
      _id: entry.cardId,
      content: SR5ItemTransfer.#strandHtml(id, entry),
      whisper: game.users.filter(user => user.isGM).map(user => user.id),
    }, {
      keepId: true
    })
  }

  /** The button of the card: a gamemaster's click, carried out by the active gamemaster. */
  static onRenderChatMessage(message, html) {
    if (!game.user.isGM) return
    for (const button of html.querySelectorAll?.(".sr-transfer-restore") ?? []) button.addEventListener("click", event => {
      event.preventDefault()
      button.disabled = true
      SR5ItemTransfer.toActiveGM("strandRestore", {
        strand: button.dataset.strand, index: Number(button.dataset.index)
      })
    })
  }

  /**
   * Give back what stayed in the journal. Marked given back in the same turn as the write it follows, and the write can
   * be played twice: an object knows its id, a ledger line its id, a stick the mark of this very restitution.
   */
  static async #onRestore(data, senderId) {
    if (!game.users.get(senderId)?.isGM) return
    return SR5ItemTransfer.serial(async () => {
      const id = String(data.strand ?? "")
      const entry = foundry.utils.deepClone(SR5ItemTransfer.journal().strands?.[id])
      const item = entry?.items?.[data.index]
      if (!item || item.restored) return
      const owner = documentStore.actor(item.actor)
      const refused = key => SR5ItemTransfer.notify(senderId, "warn", key, {
        name: item.name ?? formatNumber(item.amount ?? 0)
      })
      if (!owner) return refused("SR5.WARN_TransferRestoreNoOwner")
      if (item.kind === "object") {
        if (!owner.items.has(item.snapshot._id)) await documentStore.create(item.actor, item.snapshot)
        if (!owner.items.has(item.snapshot._id)) return refused("SR5.WARN_TransferRestoreRefused")
      } else {
        const stick = owner.items.get(item.itemId)
        const mark = `strand-${id}-${data.index}`
        if (stick) {
          const marks = foundry.utils.getProperty(stick._source, "flags.sr5.transferStep")
          if (!hasMark(marks, mark)) await stick.update({
            "system.funds.value": (Number(stick._source.system.funds?.value) || 0) + item.amount, "flags.sr5.transferStep": withMark(marks, mark)
          })
        } else {
          if (owner.type !== "actorPc") return refused("SR5.WARN_TransferRestoreNoAccounts")
          // Its id is noted before the line exists: a click played again finds it, and makes no second one
          if (!item.lineId) {
            item.lineId = newId()
            await updateLedger(TRANSFER_JOURNAL, journal => {
              journal.strands = {
                ...journal.strands, [id]: entry
              }
              return journal
            })
          }
          if (!owner.items.has(item.lineId)) await documentStore.create(item.actor, {
            _id: item.lineId, name: game.i18n.localize("SR5.TransferRestoredLine"), type: "itemNuyen",
            img: "systems/sr5/assets/img/items/itemNuyen.svg",
            system: {
              amount: item.amount, type: "gain", date: new Date().toISOString().slice(0, 10),
            },
          })
        }
      }
      item.restored = true
      await updateLedger(TRANSFER_JOURNAL, journal => {
        if (entry.items.every(known => known.restored)) {
          if (journal.strands) delete journal.strands[id]
        } else journal.strands = {
          ...journal.strands, [id]: entry
        }
        return journal
      })
      await game.messages.get(entry.cardId)?.update({
        content: SR5ItemTransfer.#strandHtml(id, entry)
      })
    })
  }

  /** What a list ends with, however it ended and whoever finished it. */
  static async #settle(after, result) {
    if (after?.kind === "trade") {
      const {
        SR5Trade
      } = await import("./trade.js")
      return SR5Trade.finishList(after, result)
    }
    if (after?.kind !== "move") return
    if (result.ok) {
      await SR5ItemTransfer.notify(after.userId, "info", "SR5.TransferDone", {
        name: after.label, actor: after.to
      })
      return SR5ItemTransfer.#announce(after)
    }
    return SR5ItemTransfer.notify(after.userId, "warn", result.undone ? "SR5.WARN_TransferFailed" : "SR5.ERROR_TransferNotUndone", {
      name: after.label
    })
  }

  // A list that could not be undone is the one case where the sheets have to be looked at
  static #report(result) {
    SR5_SystemHelpers.srLog(1, `Transfer stopped: ${result.error?.message}`, result)
    if (!result.undone) ui.notifications.error(game.i18n.localize("SR5.ERROR_TransferNotUndone"), {
      permanent: true
    })
  }

  /**
   * A gamemaster arrives (his page reloaded, or the previous one left). A list stays with the gamemaster who runs it while
   * he is here; one nobody runs goes to the active gamemaster. The journal is read in turn, at the moment of taking each
   * list, and the sheets are read again by the steps themselves. The questions left waiting are asked again.
   */
  static async recover() {
    if (!game.user.isGM) return
    await SR5ItemTransfer.#enqueue(() => SR5ItemTransfer.#takeLists())
    if (!isWriter()) return
    // A card lost with a page reloaded just after the list stopped
    for (const [id, entry] of Object.entries(SR5ItemTransfer.journal().strands ?? {
    })) {
      await SR5ItemTransfer.#strandCard(id, entry)
      await SR5ItemTransfer.#dropIfTold(id, entry)
    }
    for (const [askId, ask] of Object.entries(SR5ItemTransfer.journal().asks ?? {
    })) SR5ItemTransfer.#ask(askId, ask)
  }

  /* -------------------------------------------- */
  /*  Talking to the gamemaster                   */
  /* -------------------------------------------- */

  /**
   * Send a request to the active gamemaster. A player goes through emitForGM; another gamemaster, whom emitForGM turns
   * away, is addressed to him directly (shop-retry.js toActiveGM).
   * @returns {Promise<boolean>} false when nobody can answer: the user was told
   */
  static async toActiveGM(op, data) {
    const active = game.users.activeGM
    if (!active) {
      ui.notifications.warn(game.i18n.localize("SR5.WARN_TransferNoGM"))
      return false
    }
    const {
      SR5_SocketHandler
    } = await import("../socket.js")
    const payload = {
      op, ...data
    }
    if (isWriter()) await SR5ItemTransfer.handle(payload, game.user.id)
    else if (game.user.isGM) await SR5_SocketHandler.emitForPlayer("itemTransfer", payload, active.id)
    else await SR5_SocketHandler.emitForGM("itemTransfer", payload)
    return true
  }

  /** The server stamps `senderId`; only the active gamemaster acts on a request. */
  static async _socket(message, senderId) {
    if (!isWriter()) return
    return SR5ItemTransfer.handle(message?.data ?? {
    }, senderId)
  }

  static async handle(data, senderId) {
    try {
      if (data.op === "move") return await SR5ItemTransfer.#onMoveRequest(data, senderId)
      if (data.op === "strandRestore") return await SR5ItemTransfer.#onRestore(data, senderId)
      const {
        SR5Trade
      } = await import("./trade.js")
      return await SR5Trade.handle(data, senderId)
    } catch (error) {
      if (!(error instanceof TransferBusy)) throw error
      return SR5ItemTransfer.notify(senderId, "warn", "SR5.WARN_TransferBusy")
    }
  }

  /** Say something to whoever asked, on their screen. */
  static async notify(userId, level, key, data = {
  }) {
    if (!userId || userId === game.user.id) return ui.notifications[level](game.i18n.format(key, data))
    const {
      SR5_SocketHandler
    } = await import("../socket.js")
    return SR5_SocketHandler.emitForPlayer("shopVendorNotice", {
      level, key, data
    }, userId)
  }

  /* -------------------------------------------- */
  /*  The drop                                    */
  /* -------------------------------------------- */

  /**
   * Whether this drop is a move. An item with no bearer (the sidebar), one from a compendium, and what is no object
   * (a spell, a quality) stay copies; a gamemaster's Ctrl+drop too, his tool to fill a sheet from another.
   */
  static isMove(item, event) {
    const origin = item?.parent
    if (!origin || item.pack || origin.pack) return false
    if (!movesRatherThanCopies(item)) return false
    // A line of the accounts on a sheet that is not hers has no question to go through: refused as what is no object
    if (!isPhysical(item) && SR5ItemTransfer.foreign(item)) return false
    return !(event?.ctrlKey && game.user.isGM)
  }

  /** Whether this item sits on a sheet the user does not own, and may therefore not be copied from it. */
  static foreign(item) {
    const origin = item?.parent
    return !!origin && !origin.pack && !item.pack && !origin.isOwner && !game.user?.isGM
  }

  /** The drop, on the browser of whoever dropped: what can be refused here is refused here. */
  static async drop(sheet, item) {
    const origin = item.parent
    const target = sheet.actor
    const refusal = SR5ItemTransfer.refusal(item, origin, target, game.user)
    if (refusal) {
      ui.notifications.warn(game.i18n.format(`SR5.WARN_Transfer_${refusal.key}`, {
        name: refusal.name
      }))
      return null
    }
    // Nobody to write on someone else's sheet: refused at once, before asking how many
    const alone = !game.users.activeGM
    if (alone && (!origin.isOwner || !target.isOwner)) {
      ui.notifications.warn(game.i18n.localize("SR5.WARN_TransferNoGM"))
      return null
    }
    const data = item.toObject()
    data.system.storedIn = ""
    if (!await sheet.dropRules(data)) return null

    const quantity = await SR5ItemTransfer.#askQuantity(item)
    if (!quantity) return null

    if (alone) {
      const plan = await SR5ItemTransfer.#plan(origin, item.id, target, quantity)
      if (plan.refusal) {
        ui.notifications.warn(game.i18n.format(`SR5.WARN_Transfer_${plan.refusal}`, {
          name: plan.name ?? item.name
        }))
        return null
      }
      await SR5ItemTransfer.execute(plan.steps, SR5ItemTransfer.#afterMove({
        userId: game.user.id, from: origin.uuid, to: target.uuid
      }, origin, target, plan))
      return null
    }
    await SR5ItemTransfer.toActiveGM("move", {
      from: origin.uuid, itemId: item.id, to: target.uuid, quantity
    })
    return null
  }

  /** How many of a pile: the whole of it by default. A single object asks nothing. */
  static async #askQuantity(item) {
    const size = pileSize(item)
    if (size <= 1) return 1
    const asked = await foundry.applications.api.DialogV2.prompt({
      window: {
        title: game.i18n.format("SR5.TransferQuantityTitle", {
          name: item.name
        })
      },
      content: `<div class="form-group"><label>${escape(game.i18n.localize("SR5.TransferQuantity"))}</label>
        <input type="number" name="quantity" min="1" max="${size}" step="1" value="${size}" autofocus></div>`,
      ok: {
        label: game.i18n.localize("SR5.TransferQuantityOk"),
        callback: (event, button) => Number(button.form.elements.quantity.value) || 0
      },
      rejectClose: false,
    })
    return asked > 0 ? Math.min(size, Math.floor(asked)) : 0
  }

  /** Why this move cannot be, read the same way on both browsers: the object's own state, and a storage shut. */
  static refusal(item, origin, target, user) {
    const own = bundleRefusal(item, origin.items)
    if (own) return own
    const named = key => ({
      key, name: item.name
    })
    // Nothing but an object leaves a sheet that is not hers; a line of the accounts goes between her own sheets, and
    // to a sheet that keeps accounts (Argent-et-creditubes)
    if (LEDGER_TYPES.includes(item.type)) {
      if (target.type !== "actorPc") return named("noLedger")
      if (!user.isGM && !(origin.testUserPermission(user, "OWNER") && target.testUserPermission(user, "OWNER"))) return named("ledgerOwnSheets")
    } else if (!user.isGM && !isPhysical(item) && !origin.testUserPermission(user, "OWNER")) return named("notYours")
    // A garage or a vendor's counter holds a vehicle, a box does not (storage-rules.js)
    if (item.type === "itemVehicle" && target.type === "actorStorage" && !isStorable(item, target)) return named("vehicleInBox")
    if (!user.isGM) {
      if (origin.type === "actorStorage" && isLocked(storageBase(origin))) return named("storageLocked")
      if (target.type === "actorStorage" && isLocked(storageBase(target))) return named("storageLocked")
    }
    return null
  }

  /* -------------------------------------------- */
  /*  The gamemaster's side                       */
  /* -------------------------------------------- */

  static async #onMoveRequest(data, senderId) {
    const requester = game.users.get(senderId)
    if (!requester) return
    const origin = documentStore.actor(String(data.from ?? ""))
    const target = documentStore.actor(String(data.to ?? ""))
    const item = origin?.items?.get(String(data.itemId ?? ""))
    if (!item || !target?.items) return SR5ItemTransfer.notify(senderId, "warn", "SR5.WARN_Transfer_gone", {
      name: item?.name ?? ""
    })
    const refusal = SR5ItemTransfer.refusal(item, origin, target, requester)
    if (refusal) return SR5ItemTransfer.notify(senderId, "warn", `SR5.WARN_Transfer_${refusal.key}`, {
      name: refusal.name
    })
    const move = {
      from: origin.uuid, itemId: item.id, to: target.uuid, quantity: Math.max(1, Math.floor(Number(data.quantity) || 1)),
      userId: senderId,
    }
    // Her own sheet: moved. Anyone else's, a body or an NPC's: the gamemaster says so first
    if (requester.isGM || origin.testUserPermission(requester, "OWNER")) return SR5ItemTransfer.#runMove(move)

    // In turn: two drops of one object in a row reach this browser before the first question is written
    const askId = await SR5ItemTransfer.serial(async () => {
      const pending = Object.values(SR5ItemTransfer.journal().asks ?? {
      }).some(ask => ask.from === move.from && ask.itemId === move.itemId)
      if (pending) return null
      const id = newId()
      await updateLedger(TRANSFER_JOURNAL, journal => {
        journal.asks = {
          ...journal.asks, [id]: move
        }
        return journal
      })
      return id
    })
    await SR5ItemTransfer.notify(senderId, "info", askId ? "SR5.TransferAsked" : "SR5.TransferAlreadyAsked", {
      name: item.name
    })
    if (askId) SR5ItemTransfer.#ask(askId, move)
  }

  // The questions on screen: asked again only when this browser did not ask it yet
  static #asking = new Set()

  /** Never awaited by what received the request: a question can wait for hours, and nothing else waits for it. */
  static async #ask(askId, move) {
    if (SR5ItemTransfer.#asking.has(askId)) return
    SR5ItemTransfer.#asking.add(askId)
    const origin = documentStore.actor(move.from)
    const item = origin?.items.get(move.itemId)
    const target = documentStore.actor(move.to)
    const requester = game.users.get(move.userId)
    let accepted = false
    if (item && target) accepted = await foundry.applications.api.DialogV2.confirm({
      window: {
        title: game.i18n.localize("SR5.TransferAskTitle")
      },
      content: `<p>${game.i18n.format("SR5.TransferAskText", {
        user: escape(requester?.name ?? "?"), actor: escape(target.name), origin: escape(origin.name),
        item: escape(lineLabel(SR5ItemTransfer.#preview(item, origin, move.quantity))),
      })}</p>`,
      rejectClose: false,
    })
    SR5ItemTransfer.#asking.delete(askId)
    try {
      await SR5ItemTransfer.serial(() => updateLedger(TRANSFER_JOURNAL, journal => {
        if (journal.asks) delete journal.asks[askId]
        return journal
      }))
    } catch (error) {
      if (!(error instanceof TransferBusy)) throw error
      return SR5ItemTransfer.notify(move.userId, "warn", "SR5.WARN_TransferBusy")
    }
    // Gone while nobody could answer (a page reloaded): nobody refused anything
    if (!item || !target) return SR5ItemTransfer.notify(move.userId, "warn", "SR5.WARN_Transfer_gone", {
      name: item?.name ?? ""
    })
    if (accepted !== true) return SR5ItemTransfer.notify(move.userId, "warn", "SR5.TransferAskRefused", {
      name: item.name
    })
    // Whoever is the active gamemaster now writes: another may have taken over during the question
    if (isWriter()) return SR5ItemTransfer.#runMove(move).catch(error => {
      if (!(error instanceof TransferBusy)) throw error
      return SR5ItemTransfer.notify(move.userId, "warn", "SR5.WARN_TransferBusy")
    })
    return SR5ItemTransfer.notify(move.userId, "warn", "SR5.WARN_RelayLost", {
      gm: game.user.name, kind: game.i18n.localize("SR5.RelayKindAction")
    })
  }

  /** What the question shows: the money a whole object takes along, or the share of a pile. */
  static #preview(item, origin, quantity) {
    const size = pileSize(item)
    const taken = Math.min(size, quantity)
    const funds = taken >= size ? bundleFunds(bundleOf(item, origin.items)) : splitFunds(item, taken)?.taken ?? 0
    return {
      name: item.name, quantity: taken, funds
    }
  }

  /**
   * The list of a move, read on this browser just before it runs. The receiving sheet's rules say how the object
   * arrives (switched off when one of its kind is on, djamz.12).
   */
  static async #plan(origin, itemId, target, quantity) {
    const item = origin?.items.get(itemId)
    if (!item || !target) return {
      refusal: "gone"
    }
    const refusal = bundleRefusal(item, origin.items)
    if (refusal) return {
      refusal: refusal.key, name: refusal.name
    }
    // The sheet's rules are awaited outside the plan, which is synchronous
    const ruled = await target.sheet.dropRules(foundry.utils.deepClone(item.toObject()))
    if (!ruled) return {
      refusal: "sheet"
    }
    const planned = planObject({
      item, quantity, from: origin.uuid, to: target.uuid, fromItems: origin.items, toItems: target.items,
      takenIds: new Set(target.items.map(i => i.id)), newId,
      arrive: data => {
        if (ruled.system.isActive !== undefined) data.system.isActive = ruled.system.isActive
        return data
      },
    })
    return planned.refused ? {
      refusal: "sheet"
    } : planned
  }

  static #runMove(move) {
    return SR5ItemTransfer.serial(async () => {
      const origin = documentStore.actor(move.from)
      const target = documentStore.actor(move.to)
      const plan = await SR5ItemTransfer.#plan(origin, move.itemId, target, move.quantity)
      if (plan.refusal) return SR5ItemTransfer.notify(move.userId, "warn", `SR5.WARN_Transfer_${plan.refusal}`, {
        name: plan.name ?? origin?.items.get(move.itemId)?.name ?? ""
      })
      await SR5ItemTransfer.execute(plan.steps, SR5ItemTransfer.#afterMove(move, origin, target, plan))
    })
  }

  // What the end of a move needs, kept in the journal: its card has its id before it exists, and is written once
  static #afterMove({
    userId, from, to
  }, origin, target, plan) {
    return {
      kind: "move", userId, from: origin.name, fromUuid: from, to: target.name, toUuid: to, label: lineLabel(plan.label), cardId: newId(),
    }
  }

  /**
   * A line in the chat when an object changes hands between two people; a user moving between her own sheets is told
   * on her screen, and that is enough.
   */
  static async #announce({
    userId, from, fromUuid, to, toUuid, label, cardId
  }) {
    if (game.messages.has(cardId)) return
    const origin = documentStore.actor(fromUuid)
    const target = documentStore.actor(toUuid)
    const user = game.users.get(userId)
    if (user && origin && target && origin.testUserPermission(user, "OWNER") && target.testUserPermission(user, "OWNER")) return
    const whisper = game.users.filter(u => u.isGM || u.id === userId || origin?.testUserPermission(u, "OWNER") ||
      target?.testUserPermission(u, "OWNER")).map(u => u.id)
    await foundry.documents.ChatMessage.create({
      _id: cardId,
      content: `<p>${escape(game.i18n.format("SR5.TransferChat", {
        from, to, item: label
      }))}</p>`,
      whisper,
    }, {
      keepId: true
    })
  }

  static register() {
    game.settings.register("sr5", TRANSFER_JOURNAL, {
      scope: "world",
      config: false,
      type: Object,
      default: {
      },
    })
  }
}

// A storage on the map: its lock lives on its base actor (storage-lock-actions.js)
function storageBase(actor) {
  return actor?.isToken ? (actor.token?.baseActor ?? actor) : actor
}
