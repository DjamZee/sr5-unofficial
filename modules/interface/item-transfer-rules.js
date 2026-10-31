/**
 * An object really changing hands: dropped from one sheet on another, or exchanged in the trade window. No rule of
 * the book: a comfort of the table (decisions of DjamZ, 30/10).
 *
 * The plan is a list of steps written down before the first of them runs. Each step can be run twice with the same
 * result and undone, whatever was reached: a gamemaster's page reloaded halfway finishes the list, and a write
 * refused halfway undoes it. Money is only ever written as "from this value to that one": a value that moved since
 * the plan stops everything, it is never overwritten.
 *
 * Kept free of Foundry globals so the rules can be read, and tested, alone: what reads and writes the documents
 * comes in as a `store`.
 */
import {
  STORABLE_TYPES
} from "./storage-rules.js"
import {
  isLockedAway, pileSize, splitFunds, splitPile
} from "../rolls/roll-helpers/pickpocket-rules.js"

// What can be handed over. A spell, a quality, a program or a SIN is no object: dropped, it stays a copy
export const PHYSICAL_TYPES = [...STORABLE_TYPES, "itemStorage"]

// What moves. A line of the accounts too, between one's own sheets: copied, the money would exist twice
export const LEDGER_TYPES = ["itemNuyen", "itemKarma"]
export const MOVABLE_TYPES = [...PHYSICAL_TYPES, ...LEDGER_TYPES]

/** Whether this is an object one can be given, or take from someone: a line of the accounts or of Karma is not. */
export function isPhysical(item) {
  return movesRatherThanCopies(item) && !LEDGER_TYPES.includes(item.type)
}

/** Whether dropping this item on another sheet moves it, rather than copies it. */
export function movesRatherThanCopies(item) {
  if (!MOVABLE_TYPES.includes(item?.type)) return false
  const data = item.system ?? {
  }
  if (item.type === "itemWeapon" && data.type === "unarmedCombat") return false
  if (item.type === "itemGear" && data.isIntangible) return false
  return true
}

/**
 * Why this object cannot leave its bearer as it is, or null. An implant has to come out first, a fitted accessory
 * follows its host, a deployed vehicle stands on the map, a locked bag keeps what it holds, and a garage or a vendor's
 * counter is no bag.
 */
export function transferRefusal(item) {
  const data = item?.system ?? {
  }
  if (item?.type === "itemAugmentation" && data.isActive) return "implant"
  if (data.isAccessory && data.isPlugged) return "plugged"
  if (item?.type === "itemVehicle" && data.isCreated) return "deployed"
  // Taken, a drug belongs to the body it runs in: its rise or its crash does not pass to whoever gets the object
  if (item?.type === "itemDrug" && (data.phase === "rise" || data.phase === "crash" || data.isActive || data.wirelessTurnedOn)) return "drugActive"
  if (item?.type === "itemStorage" && ["garage", "shop"].includes(data.type)) return "fixture"
  if (isLockedAway(item)) return "locked"
  return null
}

/**
 * What stops this object and all it carries, or null: a bag does not take away a drug still working on its bearer,
 * whose crash it would wipe.
 * @returns {{key: string, name: string}|null} the refusal, with the name of the object it is about
 */
export function bundleRefusal(item, items = []) {
  const own = transferRefusal(item)
  if (own) return {
    key: own, name: item.name
  }
  const drug = bundleOf(item, items).find(carried => carried !== item && transferRefusal(carried) === "drugActive")
  return drug ? {
    key: "drugInBag", name: drug.name
  } : null
}

/** Why this object cannot be offered in a trade, or null: what a bag holds has to show on the offer. */
export function tradeRefusal(item, items = []) {
  if (!isPhysical(item)) return "notAnObject"
  if (item.type === "itemStorage" && Array.from(items).some(i => i.system?.storedIn === item.id)) return "bagNotEmpty"
  return transferRefusal(item)
}

const asList = value => Array.isArray(value) ? value : Object.values(value ?? {
})

/** The ids of the objects this one carries: its fitted accessories, and what a bag holds. */
function carriedIds(item, items) {
  const data = item.system ?? {
  }
  const ids = [...asList(data.accessory), ...asList(data.weaponAccessory?.visionEnhancements)].map(a => a?._id).filter(Boolean)
  if (item.type === "itemStorage") ids.push(...items.filter(i => i.system?.storedIn === item.id).map(i => i.id))
  return ids
}

/** The object and all it carries along: a host keeps its accessories, a bag its contents, whatever their depth. */
export function bundleOf(item, items) {
  const all = Array.from(items)
  const bundle = [item]
  for (let i = 0; i < bundle.length; i++) {
    for (const id of carriedIds(bundle[i], all)) {
      const carried = all.find(other => other.id === id)
      if (carried && !bundle.includes(carried)) bundle.push(carried)
    }
  }
  return bundle
}

/** The line of an object on the interrupted move's card: no sum for what holds no money (ammunition, a bag). */
export function strandLineKey(item, kept = false) {
  if (!kept && item.kind === "money") return "SR5.TransferStrandMoney"
  const holdsMoney = Number(kept ? item.funds : item.amount ?? item.funds) > 0
  return `SR5.TransferStrand${kept ? "Kept" : "Object"}${holdsMoney ? "" : "Plain"}`
}

/** What the source of an object says it holds: the amount a question or an offer has to show. */
export function fundsOf(item) {
  return item?.system?.isCredstick ? Number(item.system.funds?.value) || 0 : 0
}

/** The money a bundle takes along. */
export function bundleFunds(bundle) {
  return bundle.reduce((sum, item) => sum + fundsOf(item), 0)
}

/* -------------------------------------------- */
/*  Planning                                    */
/* -------------------------------------------- */

// What the clock of a drug taken leaves on it (system/drug-clock.js)
const DRUG_CLOCK_FLAGS = ["riseStart", "crashStart", "drugNotified", "crashPartOver", "crashPartNotified"]

/** An object arriving: in hand, out of any network, tied to nothing it left behind. */
export function sanitizeArrival(data, movedIds = []) {
  const system = data.system
  if (system.storedIn !== undefined && !movedIds.includes(system.storedIn)) system.storedIn = ""
  if (system.isSlavedToPan !== undefined) system.isSlavedToPan = false
  if (system.panMaster !== undefined) system.panMaster = ""
  if (system.pan?.content) system.pan.content = []
  if (system.linkedWeapon && !movedIds.includes(system.linkedWeapon)) {
    system.linkedWeapon = ""
    system.linkedWeaponName = ""
  }
  if (system.linkedAdeptPower) {
    system.linkedAdeptPower = ""
    system.linkedAdeptPowerName = ""
  }
  // A slaved vehicle belongs to the network it left
  if (system.slaved !== undefined) system.slaved = false
  if (data.type === "itemDrug") {
    Object.assign(system, {
      phase: "", isActive: false, wirelessTurnedOn: false
    })
    for (const key of DRUG_CLOCK_FLAGS) if (data.flags?.sr5) delete data.flags.sr5[key]
  }
  return data
}

/**
 * The ids an object keeps among the receiver's: the same one when it is free (Foundry's own rule for a drop), a new
 * one otherwise, and everything in the bundle that pointed at the old one follows.
 */
function remapIds(entries, taken, newId) {
  const map = new Map()
  for (const {
    data
  } of entries) {
    const id = taken.has(data._id) ? newId() : data._id
    taken.add(id)
    map.set(data._id, id)
  }
  for (const {
    data
  } of entries) {
    data._id = map.get(data._id)
    const system = data.system
    if (map.has(system.storedIn)) system.storedIn = map.get(system.storedIn)
    if (map.has(system.linkedWeapon)) system.linkedWeapon = map.get(system.linkedWeapon)
    for (const list of [system.accessory, system.weaponAccessory?.visionEnhancements]) {
      for (const entry of asList(list)) if (entry && map.has(entry._id)) entry._id = map.get(entry._id)
    }
  }
}

/**
 * The steps of one object leaving `from` for `to`.
 * @param {object} p
 * @param {object} p.item the object
 * @param {number} p.quantity how many of its pile
 * @param {string} p.from the giver's uuid
 * @param {string} p.to the receiver's uuid
 * @param {Array} p.fromItems what the giver holds
 * @param {Array} p.toItems what the receiver holds
 * @param {Set} p.takenIds the ids taken on the receiver's sheet, this plan's included
 * @param {() => string} p.newId a fresh id
 * @param {(data: object) => object|null} [p.arrive] the receiving sheet's rules: the data as it will be, null if refused
 * @returns {{steps: object[], refused: boolean, label: {name: string, quantity: number, funds: number}}}
 */
export function planObject({
  item, quantity, from, to, fromItems, toItems, takenIds, newId, arrive = data => data
}) {
  const size = pileSize(item)
  const split = splitPile(item, quantity, toItems)
  const whole = split.quantity >= size
  // Only a whole pile takes its accessories or contents along: a part of it is only units
  const bundle = whole ? bundleOf(item, fromItems) : [item]
  const movedIds = bundle.map(i => i.id)
  const money = splitFunds(item, split.quantity)
  const steps = []
  const entries = []
  for (const moved of bundle) {
    const data = sanitizeArrival(moved.toObject(), movedIds)
    if (moved === item) {
      if (data.system.quantity !== undefined) data.system.quantity = split.quantity
      if (money) data.system.funds.value = money.taken
    }
    const ruled = moved === item ? arrive(data) : data
    if (!ruled) return {
      steps: [], refused: true, label: null
    }
    // An implant set aside stays set aside: the rule of a drop would install it
    if (moved.type === "itemAugmentation") ruled.system.isActive = false
    entries.push({
      moved, data: ruled
    })
  }

  // The units join an identical pile of the receiver's, as a lifted pile does (arbitrage de DjamZ, 2026-10-05)
  const mergeInto = whole && bundle.length > 1 ? null : split.mergeInto
  if (mergeInto) {
    const before = pileSize(mergeInto)
    steps.push({
      op: "update", actor: to, id: mergeInto.id,
      set: {
        "system.quantity": before + split.quantity
      },
      was: {
        "system.quantity": before
      },
      source: item.id,
    })
  } else {
    remapIds(entries, takenIds, newId)
    for (const entry of entries) steps.push({
      op: "create", actor: to, data: entry.data, source: entry.moved.id
    })
  }

  if (whole) {
    for (const moved of bundle) steps.push({
      op: "delete", actor: from, id: moved.id, snapshot: moved.toObject(), guard: guardOf(moved)
    })
  } else {
    const set = {
      "system.quantity": split.leftOnGiver
    }
    const was = {
      "system.quantity": size
    }
    if (money) {
      set["system.funds.value"] = money.left
      was["system.funds.value"] = fundsOf(item)
    }
    steps.push({
      op: "update", actor: from, id: item.id, set, was, leaves: true
    })
  }

  return {
    steps, refused: false,
    label: {
      name: item.name, quantity: split.quantity,
      funds: whole ? bundleFunds(bundle) : money?.taken ?? 0,
    },
  }
}

// What must not have moved when an object is taken off its sheet: a stick loaded since would lose its money
function guardOf(item) {
  const guard = {
  }
  if (item.system?.quantity !== undefined) guard["system.quantity"] = item.system.quantity
  if (item.system?.isCredstick) guard["system.funds.value"] = fundsOf(item)
  if (LEDGER_TYPES.includes(item.type)) guard["system.amount"] = item.system.amount
  return guard
}

/**
 * The money of an exchange in cash: taken from the sticks in the order they come, loaded on the receiver's while they
 * have room. Sticks that leave in the same trade are not counted by the caller.
 * @param {number} amount
 * @param {Array<{id: string, funds: number}>} payerSticks changed as they are spent
 * @param {Array<{id: string, funds: number, room: number}>} payeeSticks changed as they are loaded
 * @returns {{debits: Array, credits: Array}|{refusal: string}}
 */
export function planCash(amount, payerSticks, payeeSticks) {
  let toPay = amount
  const debits = []
  for (const stick of payerSticks) {
    if (toPay <= 0) break
    const taken = Math.min(toPay, stick.funds)
    if (taken <= 0) continue
    debits.push({
      id: stick.id, from: stick.funds, to: stick.funds - taken
    })
    stick.funds -= taken
    toPay -= taken
  }
  if (toPay > 0) return {
    refusal: "cashShort"
  }
  let toLoad = amount
  const credits = []
  for (const stick of payeeSticks) {
    if (toLoad <= 0) break
    const loaded = Math.min(toLoad, stick.room)
    if (loaded <= 0) continue
    credits.push({
      id: stick.id, from: stick.funds, to: stick.funds + loaded
    })
    stick.funds += loaded
    stick.room -= loaded
    toLoad -= loaded
  }
  return toLoad > 0 ? {
    refusal: "cashNoRoom"
  } : {
    debits, credits
  }
}

// Several writes on one stick (it pays and receives, or two lines): one step from the first value to the last
export function mergeStickWrites(actor, writes) {
  const byId = new Map()
  for (const write of writes) {
    const known = byId.get(write.id)
    if (known) known.to = write.to
    else byId.set(write.id, {
      ...write
    })
  }
  return [...byId.values()].filter(w => w.to !== w.from).map(w => ({
    op: "update", actor, id: w.id,
    set: {
      "system.funds.value": w.to
    },
    was: {
      "system.funds.value": w.from
    },
    leaves: w.to < w.from,
  }))
}

/**
 * What leaves before what arrives. Cut short, a list has taken money and objects off a sheet, and the journal finishes
 * it; the other way round, a stick would stand on both sheets until then, and could be emptied on either.
 */
export function orderSteps(steps) {
  const leaves = step => step.op === "delete" || step.leaves === true || step.data?.system?.type === "loss"
  return [...steps].sort((x, y) => Number(leaves(y)) - Number(leaves(x)))
}

/* -------------------------------------------- */
/*  Running                                     */
/* -------------------------------------------- */

// Written with the values of an update, in the same write: after a cut, whether a step has run is read here, not guessed
// from the values, which someone may have changed since
const MARK = "flags.sr5.transferStep"
const FUNDS = "system.funds.value"
// Several lists may write one stick between a cut and its resumption: each keeps its own mark, the last few are enough
const MARKS_KEPT = 8

const marksIn = value => String(value ?? "").split("|").filter(Boolean)

/** The field of marks once this one is added: another list's mark is never written over. */
export function withMark(value, mark) {
  return [...marksIn(value), mark].slice(-MARKS_KEPT).join("|")
}

/** Whether this mark is on the field. */
export function hasMark(value, mark) {
  return marksIn(value).includes(mark)
}

function markedDone(step, store, runId, index) {
  if (!runId) return false
  const own = marksIn(store.read(step.actor, step.id, MARK)).filter(mark => mark.startsWith(`${runId}:`)).at(-1)
  return !!own && Number(own.split(":")[1]) >= index
}

/** Whether this update has run. */
function updateDone(step, store, {
  runId, index, known
}) {
  if (known) return true
  if (runId) return markedDone(step, store, runId, index)
  return Object.entries(step.set).every(([path, value]) => store.read(step.actor, step.id, path) === value)
}

/** Whether a stick can still take this: 0 means no ceiling. */
function fitsOnStick(step, store, value) {
  const ceiling = (Number(store.read(step.actor, step.id, "system.funds.max")) || 0) *
    Math.max(1, Math.floor(Number(store.read(step.actor, step.id, "system.quantity")) || 1))
  return !ceiling || value <= ceiling
}

/**
 * One step, once: already done is done. In a list run at once, anything else than what the plan read stops it. In a
 * list resumed after a cut, its two sides agreed and part of it has gone already: what the step moves is applied to what
 * is there now, as long as that holds up.
 */
async function applyStep(step, store, context) {
  if (step.op === "create") {
    if (store.has(step.actor, step.data._id)) return
    await store.create(step.actor, step.data)
    if (!store.has(step.actor, step.data._id)) throw new Error(`refused: ${step.data.name}`)
    return
  }
  if (step.op === "delete") {
    if (!store.has(step.actor, step.id)) return
    // Not gone yet, and no longer what was agreed: it stays
    for (const [path, value] of Object.entries(step.guard ?? {
    })) {
      if (store.read(step.actor, step.id, path) !== value) throw new Error(`moved since the plan: ${path}`)
    }
    await store.remove(step.actor, step.id)
    if (store.has(step.actor, step.id)) throw new Error(`refused: ${step.id}`)
    return
  }
  if (!store.has(step.actor, step.id)) throw new Error(`gone: ${step.id}`)
  if (updateDone(step, store, context)) return
  const pending = {
  }
  for (const [path, value] of Object.entries(step.set)) {
    const now = store.read(step.actor, step.id, path)
    if (context.resuming) {
      const next = now + value - step.was[path]
      if (next < 0) throw new Error(`short: ${path}`)
      if (path === FUNDS && next > now && !fitsOnStick(step, store, next)) throw new Error(`no room: ${path}`)
      pending[path] = next
      continue
    }
    // A list with a journal knows by its mark what it has done: the right value on another step's account is no proof,
    // two piles going to one would lose the second
    if (now === value && !context.runId) continue
    if (now !== step.was[path]) throw new Error(`moved since the plan: ${path}`)
    pending[path] = value
  }
  if (context.runId) pending[MARK] = withMark(store.read(step.actor, step.id, MARK), `${context.runId}:${context.index}`)
  if (Object.keys(pending).length) await store.update(step.actor, step.id, pending)
}

/** What an arrival looks like when nobody touched it: spent or used since, it is its bearer's now. */
function untouched(step, store) {
  return ["system.quantity", FUNDS, "system.amount"].every(path => {
    const planned = path.split(".").reduce((o, k) => o?.[k], step.data)
    return planned === undefined || store.read(step.actor, step.data._id, path) === planned
  })
}

/**
 * Undo what a stopped list has done, in an order that makes nothing twice. What arrived comes first: an arrival spent or
 * used since stays with its new bearer, and then what it came from is not put back; money spent on the way comes off what
 * goes back to the payer. Only then does what left go back.
 *
 * What cannot go back is not forgotten: `stranded` holds the object, its owner and the amount, and goes on the
 * gamemaster's card. `kept` says what stayed with its new bearer.
 * @returns {Promise<{undone: boolean, stranded: object[], kept: object[]}>}
 */
async function rollBack(steps, store, {
  reached, runId
}) {
  const stranded = []
  const kept = []
  const keptSources = new Set()
  let spent = 0
  const knownDone = index => index < reached
  const done = (step, index) => updateDone(step, store, {
    runId, index, known: knownDone(index)
  })
  const back = (step, index, path, value) => ({
    [path]: value, ...(runId ? {
      [MARK]: withMark(store.read(step.actor, step.id, MARK), `${runId}:undone-${index}`)
    } : {
    })
  })

  // What arrived. A failed removal is a kept object: the original then stays away, or it would exist twice
  for (let i = Math.min(reached, steps.length - 1); i >= 0; i--) {
    const step = steps[i]
    if (step.op === "create" && store.has(step.actor, step.data._id)) {
      let removed = false
      if (untouched(step, store)) {
        try {
          await store.remove(step.actor, step.data._id)
          removed = !store.has(step.actor, step.data._id)
        } catch {
          removed = false
        }
      }
      if (!removed) {
        if (step.source) keptSources.add(step.source)
        kept.push({
          actor: step.actor, name: step.data.name, funds: step.data.system?.isCredstick ? store.read(step.actor, step.data._id, FUNDS) : 0
        })
      }
    }
    // What a stick or a pile received
    if (step.op !== "update" || !done(step, i)) continue
    const received = Object.entries(step.set).filter(([path, value]) => value > step.was[path])
    if (!received.length) continue
    if (!store.has(step.actor, step.id)) {
      if (step.source) keptSources.add(step.source)
      for (const [path, value] of received) if (path === FUNDS) spent += value - step.was[path]
      continue
    }
    for (const [path, value] of received) {
      const now = store.read(step.actor, step.id, path)
      const gained = value - step.was[path]
      const taken = Math.min(now, gained)
      if (taken < gained) {
        if (path === FUNDS) spent += gained - taken
        else if (step.source) keptSources.add(step.source)
        kept.push({
          actor: step.actor, name: store.read(step.actor, step.id, "name"), funds: path === FUNDS ? gained - taken : 0
        })
      }
      if (path !== FUNDS && taken < gained) continue
      await store.update(step.actor, step.id, back(step, i, path, now - taken))
    }
  }

  // What left: a part of a pile or money taken off a stick. Money spent on the way does not go back as well
  for (let i = Math.min(reached, steps.length - 1); i >= 0; i--) {
    const step = steps[i]
    if (step.op !== "update" || !done(step, i) || keptSources.has(step.id)) continue
    for (const [path, value] of Object.entries(step.set)) {
      if (value >= step.was[path]) continue
      let owed = step.was[path] - value
      if (path === FUNDS) {
        const off = Math.min(owed, spent)
        spent -= off
        owed -= off
      }
      if (!owed) continue
      if (store.has(step.actor, step.id)) await store.update(step.actor, step.id, back(step, i, path, store.read(step.actor, step.id, path) + owed))
      else if (path === FUNDS) stranded.push({
        kind: "money", actor: step.actor, itemId: step.id, amount: owed
      })
    }
  }

  // What left whole
  for (let i = Math.min(reached, steps.length - 1); i >= 0; i--) {
    const step = steps[i]
    if (step.op !== "delete" || keptSources.has(step.id) || store.has(step.actor, step.id)) continue
    try {
      await store.create(step.actor, step.snapshot)
      if (store.has(step.actor, step.id)) continue
    } catch {
      // Told below
    }
    stranded.push({
      kind: "object", actor: step.actor, snapshot: step.snapshot, name: step.snapshot.name, funds: fundsOfData(step.snapshot)
    })
  }
  return {
    undone: !stranded.length && !kept.length && !spent, stranded, kept
  }
}

function fundsOfData(data) {
  return data?.system?.isCredstick ? Number(data.system.funds?.value) || 0 : 0
}

/**
 * Run the list. A step that fails undoes what was reached, and what cannot be undone comes back in the result.
 *
 * Resuming a list cut short, `from` is the number of steps its journal knows are done: those are not read again, someone
 * may have spent since what they wrote, and a finished list is never undone. The rest is finished on what is there now
 * (applyStep). When that cannot be, what has gone goes back.
 * @param {object[]} steps
 * @param {object} store
 * @param {object} [options]
 * @param {number} [options.from] the steps known to be done
 * @param {boolean} [options.resuming] this list was cut short
 * @param {string} [options.runId] the list's id in the journal: an update then says it has run, in its own write
 * @param {(done: number) => Promise} [options.onStep] told after each step, before the next
 * @returns {Promise<{ok: true}|{ok: false, error: Error, undone: boolean, stranded: object[], kept: object[]}>}
 */
export async function runSteps(steps, store, {
  from = 0, resuming = false, runId = null, onStep = null
} = {
}) {
  let reached = from
  try {
    for (; reached < steps.length; reached++) {
      await applyStep(steps[reached], store, {
        resuming, runId, index: reached, known: false
      })
      await onStep?.(reached + 1)
    }
    return {
      ok: true
    }
  } catch (error) {
    let outcome
    try {
      outcome = await rollBack(steps, store, {
        reached, runId
      })
    } catch {
      // A write refused while going back: what stands on the sheets is for the gamemaster to see, nothing is known gone
      outcome = {
        undone: false, stranded: strandedOf(steps, store, reached), kept: []
      }
    }
    return {
      ok: false, error, ...outcome
    }
  }
}

// What is off its sheet when going back itself failed
function strandedOf(steps, store, reached) {
  return steps.slice(0, reached + 1).filter(step => step.op === "delete" && !store.has(step.actor, step.id)).map(step => ({
    kind: "object", actor: step.actor, snapshot: step.snapshot, name: step.snapshot.name, funds: fundsOfData(step.snapshot)
  }))
}
