/**
 * The trade window: two columns, read from the gamemaster's register (trade.js). This browser only says what it wants
 * changed; what it shows is what the register answers, so both windows always show the same offer.
 */
import {
  SR5Trade
} from "./trade.js"
import {
  SIDES
} from "./trade-rules.js"
import {
  canLoot
} from "./storage-rules.js"
import {
  bundleFunds, bundleOf, isPhysical
} from "./item-transfer-rules.js"
import {
  escape
} from "../system/card-helpers.js"
import {
  formatNumber
} from "../helpers/number-format.js"

export class SR5TradeWindow extends foundry.applications.api.HandlebarsApplicationMixin(
  foundry.applications.api.ApplicationV2
) {

  static DEFAULT_OPTIONS = {
    classes: ["sr5", "sr-application", "sr-trade"],
    position: {
      width: 720, height: "auto"
    },
    window: {
      title: "SR5.TradeTitle", icon: "fas fa-right-left", resizable: true
    },
    actions: {
      accept: SR5TradeWindow.#accept,
      unaccept: SR5TradeWindow.#unaccept,
      remove: SR5TradeWindow.#remove,
      cancelTrade: SR5TradeWindow.#cancel,
    },
  }

  static PARTS = {
    body: {
      template: "systems/sr5/templates/interface/trade-window.hbs"
    }
  }

  static #windows = new Map()

  // A window that closes because the register let the trade go has nothing to say back
  #closedByRegister = false

  constructor(tradeId, options = {
  }) {
    super({
      id: `sr5-trade-${tradeId}`, ...options
    })
    this.tradeId = tradeId
  }

  /** The register changed: windows open for what concerns this browser, drawn again, or closed with what ended. */
  static sync() {
    const ledger = SR5Trade.ledger()
    for (const [id, app] of SR5TradeWindow.#windows) {
      if (ledger[id]) {
        app.render()
        continue
      }
      app.#closedByRegister = true
      SR5TradeWindow.#windows.delete(id)
      app.close()
    }
    for (const trade of Object.values(ledger)) {
      if (SR5TradeWindow.#windows.has(trade.id) || !SR5Trade.concerns(trade)) continue
      const app = new SR5TradeWindow(trade.id)
      SR5TradeWindow.#windows.set(trade.id, app)
      app.render({
        force: true
      })
    }
  }

  get trade() {
    return SR5Trade.get(this.tradeId)
  }

  async _prepareContext() {
    const trade = this.trade
    if (!trade) return {
    }
    const side = key => {
      const offer = trade[key]
      const canEdit = SR5Trade.mayAct(game.user, trade, key) && trade.state === "open" && SR5TradeWindow.#answersFor(trade, key)
      return {
        key, canEdit,
        name: offer.name, img: offer.img, accepted: offer.accepted, nuyen: offer.nuyen,
        items: offer.items.map(line => ({
          ...line, isPile: line.max > 1, fundsLabel: line.funds > 0 ? `${formatNumber(line.funds)} ¥` : "",
        })),
      }
    }
    return {
      sides: SIDES.map(side),
      cash: trade.cash,
      canEditCash: trade.state === "open" && SIDES.some(key => SR5Trade.mayAct(game.user, trade, key)),
      version: trade.version,
      waitingGM: trade.state === "approval",
      running: trade.state === "running",
    }
  }

  // A user who owns both ends plays both; a gamemaster only the side he answers for, unless he asked for this trade
  static #answersFor(trade, key) {
    return !game.user.isGM || (trade[key].users ?? []).includes(game.user.id)
  }

  _onRender(context, options) {
    super._onRender?.(context, options)
    const html = this.element
    for (const zone of html.querySelectorAll("[data-trade-drop]")) {
      zone.addEventListener("dragover", event => event.preventDefault())
      zone.addEventListener("drop", event => this.#onDrop(event, zone.dataset.tradeDrop))
    }
    html.querySelectorAll("[name=tradeQuantity]").forEach(input => input.addEventListener("change", () => {
      SR5Trade.send(this.tradeId, "tradeQuantity", {
        side: input.dataset.side, itemId: input.dataset.itemId, value: input.value
      })
    }))
    html.querySelectorAll("[name=tradeNuyen]").forEach(input => input.addEventListener("change", () => {
      SR5Trade.send(this.tradeId, "tradeNuyen", {
        side: input.dataset.side, value: input.value
      })
    }))
    html.querySelector("[name=tradeCash]")?.addEventListener("change", event => {
      SR5Trade.send(this.tradeId, "tradeCash", {
        value: event.currentTarget.checked
      })
    })
  }

  /** An object of her own dropped in her own column. A stick says what it holds, and leaves only if that is wanted. */
  async #onDrop(event, side) {
    event.preventDefault()
    event.stopPropagation()
    const trade = this.trade
    if (!side || !trade || trade.state !== "open" || !SR5Trade.mayAct(game.user, trade, side)) return
    let data
    try {
      data = JSON.parse(event.dataTransfer.getData("text/plain"))
    } catch {
      return
    }
    if (data?.type !== "Item" || !data.uuid) return
    const item = await fromUuid(data.uuid)
    if (!item) return
    if (item.parent?.uuid !== trade[side].actor) {
      return ui.notifications.warn(game.i18n.format("SR5.WARN_TradeNotInThisColumn", {
        actor: trade[side].name
      }))
    }
    if (!isPhysical(item)) return ui.notifications.warn(game.i18n.format("SR5.WARN_Transfer_notAnObject", {
      name: item.name
    }))
    const funds = bundleFunds(bundleOf(item, item.parent.items))
    if (funds > 0) {
      const wanted = await foundry.applications.api.DialogV2.confirm({
        window: {
          title: game.i18n.localize("SR5.TradeStickTitle")
        },
        content: `<p>${game.i18n.format("SR5.TradeStickText", {
          name: escape(item.name), amount: formatNumber(funds)
        })}</p>`,
        rejectClose: false,
      })
      if (wanted !== true) return
    }
    SR5Trade.send(this.tradeId, "tradeAdd", {
      side, itemId: item.id
    })
  }

  static #accept(event, target) {
    SR5Trade.send(this.tradeId, "tradeAccept", {
      side: target.dataset.side, version: Number(target.dataset.version)
    })
  }

  static #unaccept(event, target) {
    SR5Trade.send(this.tradeId, "tradeUnaccept", {
      side: target.dataset.side
    })
  }

  static #remove(event, target) {
    SR5Trade.send(this.tradeId, "tradeRemove", {
      side: target.dataset.side, itemId: target.dataset.itemId
    })
  }

  static #cancel() {
    this.close()
  }

  async close(options = {
  }) {
    // Escape only puts the window away, the offer stands: the trade button or any change of the offer brings it back.
    // Giving up, for both, takes the button or the cross
    if (options.closeKey && !this.#closedByRegister) {
      SR5TradeWindow.#windows.delete(this.tradeId)
      return super.close(options)
    }
    const closing = super.close(options)
    if (this.#closedByRegister) return closing
    // Closing is giving up, for both; the other window closes when the register lets the trade go
    SR5TradeWindow.#windows.delete(this.tradeId)
    if (this.trade) await SR5Trade.send(this.tradeId, "tradeCancel")
    return closing
  }

  /* -------------------------------------------- */
  /*  Choosing who with                           */
  /* -------------------------------------------- */

  /** Everyone this browser may trade with: the characters of the players, what it can see, what stands on the scene. */
  static partners(exclude) {
    const found = new Map()
    const add = (actor, label) => {
      if (!actor || !canLoot(actor) || actor.uuid === exclude?.uuid || found.has(actor.uuid)) return
      found.set(actor.uuid, {
        uuid: actor.uuid, name: label ?? actor.name
      })
    }
    for (const user of game.users) add(user.character)
    for (const token of canvas?.scene?.tokens ?? []) if (game.user.isGM || !token.hidden) add(token.actor, token.name)
    for (const actor of game.actors) if (actor.visible) add(actor)
    return [...found.values()].sort((a, b) => a.name.localeCompare(b.name))
  }

  /** What this browser plays: to answer "who gives" when the players' list opens the window. */
  static ownCharacters() {
    const owned = game.actors.filter(a => a.isOwner && canLoot(a) && (game.user.isGM ? a.type === "actorPc" : true))
    const main = game.user.character
    return main ? [main, ...owned.filter(a => a !== main)] : owned
  }

  /**
   * The little question before a trade opens: who with, and, from the players' list, as who.
   * @param {object} [p]
   * @param {Actor} [p.actor] the character trading, when known
   * @param {Actor} [p.other] the partner, when known
   */
  static async start({
    actor = null, other = null
  } = {
  }) {
    // A trade put away with Escape: the button brings it back
    if (Object.values(SR5Trade.ledger()).some(trade => SR5Trade.concerns(trade) && !SR5TradeWindow.#windows.has(trade.id))) return SR5TradeWindow.sync()
    if (!game.users.activeGM) return ui.notifications.warn(game.i18n.localize("SR5.WARN_TransferNoGM"))
    const mine = actor ? [] : SR5TradeWindow.ownCharacters().filter(a => a.uuid !== other?.uuid)
    if (!actor && mine.length === 1) actor = mine[0]
    const partners = other ? [] : SR5TradeWindow.partners(actor)
    if (actor && other) return SR5Trade.open(actor, other)
    if (!actor && !mine.length) return ui.notifications.warn(game.i18n.localize("SR5.WARN_TradeNoCharacter"))
    if (!other && !partners.length) return ui.notifications.warn(game.i18n.localize("SR5.WARN_TradeNoPartner"))
    const select = (name, label, list) => `<div class="form-group"><label>${escape(game.i18n.localize(label))}</label>
      <select name="${name}">${list.map(a => `<option value="${a.uuid}">${escape(a.name)}</option>`).join("")}</select></div>`
    const chosen = await foundry.applications.api.DialogV2.prompt({
      window: {
        title: game.i18n.localize("SR5.TradeTitle")
      },
      content: `${actor ? "" : select("mine", "SR5.TradeAs", mine)}${other ? "" : select("other", "SR5.TradeWith", partners)}`,
      ok: {
        label: game.i18n.localize("SR5.TradeOpen"),
        callback: (event, button) => ({
          mine: button.form.elements.mine?.value, other: button.form.elements.other?.value
        })
      },
      rejectClose: false,
    })
    if (!chosen) return
    const giver = actor ?? fromUuidSync(chosen.mine)
    const partner = other ?? fromUuidSync(chosen.other)
    if (giver && partner) return SR5Trade.open(giver, partner)
  }

  /** The players' list: a button beside each other player, whose character is the partner; beside oneself, the question. */
  static decoratePlayers() {
    const rows = document.querySelectorAll("#players-active .player[data-user-id], #players-inactive .player[data-user-id]")
    for (const row of rows) {
      if (row.querySelector(".sr-trade-player")) continue
      const user = game.users.get(row.dataset.userId)
      if (!user || (user.isGM && user.id !== game.user.id) || (user.id !== game.user.id && !user.character)) continue
      const button = document.createElement("a")
      button.className = "sr-trade-player fas fa-right-left"
      button.dataset.tooltip = game.i18n.localize("SR5.TradeOpen")
      button.addEventListener("click", event => {
        event.preventDefault()
        event.stopPropagation()
        SR5TradeWindow.start({
          other: user.id === game.user.id ? null : user.character
        })
      })
      row.append(button)
    }
  }
}
