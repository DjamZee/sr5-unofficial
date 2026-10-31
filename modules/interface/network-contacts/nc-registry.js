import {
  withAccess, withDiscovery, withShopDiscovered, shopKey, answerIntroduction, pruneIntroductions,
  mergeLandingRegisters, shareFromLanding, tradeFromLanding, cleanFavorites
} from "./nc-rules.js"
import {
  normalizeRun, withRun, nextCode, toggleInterest, mergeLandingRuns
} from "./nc-runs-rules.js"
import {
  updateLedger
} from "../../system/gm-ledger.js"
import {
  MATRIX_HOOKS
} from "../../system/matrix-hooks.js"
import {
  SR5_EntityHelpers
} from "../../entities/helpers.js"

// Network and Contacts (taken out of landing-metroplexes-sr5 1.8.0, DjamZ's request of 28/10). This file is the only
// one loaded at start: the world settings, the registers' reads and writes (the active GM's, through gm-ledger.js),
// the access found when a character marks a host, the migration of Landing's data and the two buttons of the token
// controls. The windows (nc-window.js, nc-network.js, nc-contacts.js) are imported when one is opened, and their
// listeners go with them when they close: nothing is kept in memory in between.

export const NC_SETTINGS = {
  enabled: "ncEnabled",
  shopsOpen: "ncShopsOpen",
  accesses: "ncAccesses",
  shops: "ncShopsDiscovered",
  revealed: "ncRevealedFactions",
  introductions: "ncIntroductions",
  runs: "ncRuns",
  runAdvance: "ncRunAdvance",
  migration: "ncLandingMigration",
}
// The hook every view listens to while it is open
export const NC_CHANGED = "sr5.networkContactsChanged"
export const LANDING_ID = "landing-metroplexes-sr5"
// The first Landing that leaves Network and Contacts to the system; before it, Landing keeps its own copy
export const LANDING_DELEGATES = "1.9.0"

const changed = () => Hooks.callAll(NC_CHANGED)

/**
 * The modules' parts of the network (landing-metroplexes-sr5: its places and its latest announcements), registered at
 * their "ready". Each is an object of optional functions, all read at each drawing of an open network:
 * tabs() → [{id, label, html()}], panelsLeft() / panelsRight() → [{title, html, help?, footer?, cls?}],
 * discoveries() → [{kind, name, date, img, id, hidden}], gmNote() → string, hooks() / settings() → the hook names and
 * setting keys that draw the network again, click(event, view) for a click on its own markup; and runEcho
 * {create({run, title, text, broadcast, gmNote}) → id, title(id) → string} when it writes a run's news item.
 */
export const networkExtensions = new Set()
export function registerNetworkExtension(extension){
  networkExtensions.add(extension)
  return () => networkExtensions.delete(extension)
}
const L = (k, d) => d ? game.i18n.format(k, d) : game.i18n.localize(k)

export function registerNetworkContactsSettings(){
  // DjamZ, 28/10: "en réglage, comme d'hab". No rule of the book changes: on by default (proposal accepted by Élise)
  game.settings.register("sr5", NC_SETTINGS.enabled, {
    name: "SR5.NC_SettingEnabled_T", hint: "SR5.NC_SettingEnabled_D",
    scope: "world", config: true, type: Boolean, default: true,
    onChange: () => {
      ui.controls?.render?.({
        reset: true
      })
      changed()
    },
  })
  // Landing's "boutiquesOuvertes": by default, only the vendors met show
  game.settings.register("sr5", NC_SETTINGS.shopsOpen, {
    name: "SR5.NC_SettingShopsOpen_T", hint: "SR5.NC_SettingShopsOpen_D",
    scope: "world", config: true, type: Boolean, default: false, onChange: changed,
  })
  // {list: [{id, name, type: "server"|"haven", host, journal, pcs: [actorId], level, note, play, rating, by, date}]}
  game.settings.register("sr5", NC_SETTINGS.accesses, {
    scope: "world", config: false, type: Object, default: {
      list: []
    }, onChange: changed
  })
  // {list: [{key: "<vendor uuid>|<storage id>", pcs: [actorId], date}]}
  game.settings.register("sr5", NC_SETTINGS.shops, {
    scope: "world", config: false, type: Object, default: {
      list: []
    }, onChange: changed
  })
  // {ids: [factionId]}
  game.settings.register("sr5", NC_SETTINGS.revealed, {
    scope: "world", config: false, type: Object, default: {
      ids: []
    }, onChange: changed
  })
  // {list: [{id, from, userId, contact, owner, message, state, date}]}
  game.settings.register("sr5", NC_SETTINGS.introductions, {
    scope: "world", config: false, type: Object, default: {
      list: []
    },
    onChange: value => {
      notifyIntroductions(value?.list ?? [])
      changed()
    },
  })
  // {list: [run]} (nc-runs-rules.js, normalizeRun)
  game.settings.register("sr5", NC_SETTINGS.runs, {
    scope: "world", config: false, type: Object, default: {
      list: []
    }, onChange: changed
  })
  // A new run's advance, in % of the pay: 0 by default, the book pays no advance (SR5 p. 377)
  game.settings.register("sr5", NC_SETTINGS.runAdvance, {
    name: "SR5.NC_R_AvanceDefaut", hint: "SR5.NC_R_AvanceDefautAide",
    scope: "world", config: true, type: Number, default: 0, range: {
      min: 0, max: 100, step: 5
    },
  })
  game.settings.register("sr5", NC_SETTINGS.migration, {
    scope: "world", config: false, type: Number, default: 0
  })
}

/* ------------------------------------------------------------------ */
/* Reads                                                               */
/* ------------------------------------------------------------------ */

const read = (key, field, empty = []) => {
  try {
    return game.settings.get("sr5", key)?.[field] ?? empty
  } catch {
    return empty
  }
}

export const ncEnabled = () => {
  try {
    return !!game.settings.get("sr5", NC_SETTINGS.enabled)
  } catch {
    return false
  }
}
export const shopsAllOpen = () => {
  try {
    return !!game.settings.get("sr5", NC_SETTINGS.shopsOpen)
  } catch {
    return false
  }
}
export const listAccesses = () => read(NC_SETTINGS.accesses, "list")
export const listShopsDiscovered = () => read(NC_SETTINGS.shops, "list")
export const listRevealed = () => read(NC_SETTINGS.revealed, "ids")
export const listIntroductions = () => read(NC_SETTINGS.introductions, "list")
// Normalized when read: a run migrated from an older Landing gains the fields it lacked
export const listRuns = () => read(NC_SETTINGS.runs, "list").map(normalizeRun)
export const runAdvanceDefault = () => {
  try {
    return Number(game.settings.get("sr5", NC_SETTINGS.runAdvance)) || 0
  } catch {
    return 0
  }
}

/** The game year of the system's calendar, otherwise the real year + 60 (2081 in the mock-up). */
function gameYear(){
  try {
    const d = game.time.components ?? game.time.calendar?.timeToComponents?.(game.time.worldTime)
    if (d?.year > 2000) return d.year
  } catch {
    // No calendar: the real year
  }
  return new Date().getFullYear() + 60
}

/** Adds, replaces or removes a run (its code given when it has none); refused off the active GM. */
export async function writeRun(run, {
  remove = false
} = {
}){
  if (refuse()) return null
  const entry = {
    ...run, id: run.id || foundry.utils.randomID()
  }
  await updateLedger(NC_SETTINGS.runs, raw => {
    const list = (raw.list ?? []).map(normalizeRun)
    if (!entry.code) entry.code = nextCode(list, gameYear())
    return {
      list: withRun(list, entry, {
        remove
      })
    }
  })
  return entry
}

/** "Interested": the active GM writes it, the others send it to him. */
export async function sendRunInterest(data){
  if (!ncEnabled()) return ui.notifications.warn(L("SR5.NC_Disabled"))
  if (game.user.isActiveGM) return recordInterest(data, game.user.id)
  if (!game.users.activeGM) return ui.notifications.warn(L("SR5.NC_R_MjAbsent"))
  const {
    SR5_SocketHandler
  } = await import("../../socket.js")
  await SR5_SocketHandler.emitForGM("ncRunInterest", data)
}

export async function _socketRunInterest(message, senderId){
  if (!game.user.isActiveGM || !ncEnabled()) return
  await recordInterest(message.data ?? {
  }, senderId)
}

async function recordInterest(data, userId){
  const user = game.users.get(userId)
  const pc = game.actors.get(data.actorId)
  if (!user || !pc || !pc.testUserPermission(user, "OWNER")) return
  await updateLedger(NC_SETTINGS.runs, raw => {
    const list = (raw.list ?? []).map(normalizeRun)
    const run = list.find(r => r.id === data.runId)
    // A run this character does not see takes no interest from her
    if (!run || (run.for === "chosen" && !run.pcs.includes(pc.id))) return null
    const next = toggleInterest(run, pc.id)
    return next ? {
      list: withRun(list, next)
    } : null
  })
}

/** Landing is there: its deck holds the two buttons, the token controls do not. */
export const landingActive = () => !!game.modules?.get(LANDING_ID)?.active

/** A Landing older than 1.9.0 still keeps its own Network and Contacts. */
export function landingLegacy(){
  const m = game.modules?.get(LANDING_ID)
  return !!m?.active && foundry.utils.isNewerVersion(LANDING_DELEGATES, m.version ?? "0")
}

/* ------------------------------------------------------------------ */
/* Writes (the active GM)                                              */
/* ------------------------------------------------------------------ */

function refuse(){
  if (game.user?.isActiveGM) return false
  ui.notifications?.warn(L("SR5.NC_GMOnly"))
  return true
}

/** Adds, replaces or removes an access; refused, with a warning, off the active GM. */
export async function writeAccess(access, {
  remove = false
} = {
}){
  if (refuse()) return null
  const entry = {
    ...access, id: access.id || foundry.utils.randomID()
  }
  await updateLedger(NC_SETTINGS.accesses, raw => ({
    list: withAccess(raw.list ?? [], entry, {
      remove
    })
  }))
  return entry
}

/** The gamemaster gives these characters the access to a host (Landing's place revealed on its map). */
export async function grantAccess(host, actorIds){
  if (refuse() || !isHost(host)) return
  await updateLedger(NC_SETTINGS.accesses, raw => {
    let list = raw.list ?? []
    let changedList = false
    for (const actorId of actorIds){
      const next = withDiscovery(list, {
        id: foundry.utils.randomID(), host: host.uuid, actorId, name: host.name, date: Date.now(),
        rating: String(host.system?.matrix?.deviceRating ?? ""), play: matrixScene(host) ? "zones" : "book",
      })
      if (next){
        list = next
        changedList = true
      }
    }
    return changedList ? {
      list
    } : null
  })
}

/** The gamemaster shows a shop to these characters ("Show to…"). */
export async function discoverShop(key, pcs){
  if (refuse()) return
  await updateLedger(NC_SETTINGS.shops, raw => {
    const list = withShopDiscovered(raw.list ?? [], {
      key, pcs, date: Date.now()
    })
    return list ? {
      list
    } : null
  })
}

export async function setFactionRevealed(id, revealed){
  if (refuse()) return
  await updateLedger(NC_SETTINGS.revealed, raw => {
    const ids = new Set(raw.ids ?? [])
    if (revealed) ids.add(id)
    else ids.delete(id)
    return {
      ids: [...ids]
    }
  })
}

/* ------------------------------------------------------------------ */
/* Introductions: asked by a player, answered by the partner, then the GM */
/* ------------------------------------------------------------------ */

const actorName = id => game.actors.get(id)?.name ?? "?"
const contactName = uuid => {
  try {
    return fromUuidSync(uuid)?.name ?? "?"
  } catch {
    return "?"
  }
}

/** The characters of this user (none for the gamemaster, who sees everything). */
export function myCharacters(){
  if (game.user.isGM) return new Set()
  return new Set(game.actors.filter(a => a.type === "actorPc" && a.isOwner).map(a => a.id))
}

const seen = new Set()
/** A notification to whoever must answer an introduction, when the request arrives (read once per state). */
function notifyIntroductions(list){
  const mine = myCharacters()
  for (const d of list){
    const key = `${d.id}:${d.state}`
    if (seen.has(key)) continue
    seen.add(key)
    if (d.state === "partner" && mine.has(d.owner)) ui.notifications.info(L("SR5.NC_C_DemandeRecue", {
      de: actorName(d.from), contact: contactName(d.contact)
    }))
    if (d.state === "gm" && game.user.isActiveGM) ui.notifications.info(L("SR5.NC_C_DemandeMj", {
      de: actorName(d.from), contact: contactName(d.contact)
    }))
  }
  // The set only holds the requests still in the register (30 closed at most)
  const keys = new Set(list.map(d => `${d.id}:${d.state}`))
  for (const k of seen) if (!keys.has(k)) seen.delete(k)
}

/** The active GM writes the requests; the others send them to him. */
export async function sendIntroduction(data){
  if (!ncEnabled()) return ui.notifications.warn(L("SR5.NC_Disabled"))
  if (game.user.isActiveGM) return handleIntroduction(data, game.user.id)
  if (!game.users.activeGM) return ui.notifications.warn(L("SR5.NC_C_PasDeMj"))
  const {
    SR5_SocketHandler
  } = await import("../../socket.js")
  await SR5_SocketHandler.emitForGM("ncIntroduction", data)
}

export async function _socketIntroduction(message, senderId){
  if (!game.user.isActiveGM || !ncEnabled()) return
  await handleIntroduction(message.data ?? {
  }, senderId)
}

async function handleIntroduction(data, userId){
  const user = game.users.get(userId)
  if (!user) return
  let announce = null
  await updateLedger(NC_SETTINGS.introductions, raw => {
    const list = [...(raw.list ?? [])]
    if (data.op === "create"){
      const item = fromUuidSync(data.contact)
      const from = game.actors.get(data.from)
      if (item?.type !== "itemContact" || !from?.testUserPermission(user, "OWNER") || item.parent?.testUserPermission(user, "OWNER")) return null
      if (list.some(d => d.contact === item.uuid && d.from === from.id && ["partner", "gm"].includes(d.state))) return null
      list.push({
        id: foundry.utils.randomID(), from: from.id, userId: user.id, contact: item.uuid, owner: item.parent.id,
        message: String(data.message ?? "").slice(0, 500), state: "partner", date: Date.now(),
      })
    } else if (data.op === "answer"){
      const i = list.findIndex(d => d.id === data.id)
      const d = list[i]
      if (!d) return null
      const owner = game.actors.get(d.owner)
      const by = d.state === "gm" ? (user.isGM ? "gm" : null) : (owner?.testUserPermission(user, "OWNER") && !user.isGM ? "partner" : null)
      const next = by && answerIntroduction(d, {
        by, accept: !!data.accept
      })
      if (!next) return null
      list[i] = {
        ...next, date: Date.now()
      }
      if (next.state === "refused" || next.state === "accepted") announce = [next, by]
    } else return null
    return {
      list: pruneIntroductions(list)
    }
  })
  if (announce) await announceIntroduction(...announce)
}

/** The asker (and the partner) learn the answer by a whisper. */
async function announceIntroduction(d, by){
  const key = d.state === "accepted" ? "SR5.NC_C_PresentationAcceptee" : (by === "gm" ? "SR5.NC_C_PresentationRefuseeMj" : "SR5.NC_C_PresentationRefusee")
  const owner = game.actors.get(d.owner)
  const to = [d.userId, ...game.users.filter(u => !u.isGM && owner?.testUserPermission(u, "OWNER")).map(u => u.id)]
  await ChatMessage.create({
    content: `<p>${foundry.utils.escapeHTML(L(key, {
      contact: contactName(d.contact), proprietaire: owner?.name ?? "?", de: actorName(d.from)
    }))}</p>`,
    whisper: [...new Set([...to, ...game.users.filter(u => u.isGM).map(u => u.id)])],
    speaker: {
      alias: L("SR5.NC_Contacts")
    },
  })
}

/* ------------------------------------------------------------------ */
/* An access found at once (DjamZ's Q4, 22/10)                         */
/* ------------------------------------------------------------------ */

const isHost = a => a?.type === "actorDevice" && a.system?.matrix?.deviceType === "host"
const isPc = a => a?.type === "actorPc" && a.hasPlayerOwner
const resolve = uuid => {
  try {
    return uuid ? fromUuidSync(uuid) : null
  } catch {
    return null
  }
}
/** A host played in zones (module Matrice), read in the raw flags: getFlag throws while that module is off. */
export const matrixScene = host => host?.flags?.["matrice-sr5"]?.server?.scene ?? ""
/** The character behind an actor (an unlinked token gives its world actor). */
const pcOf = a => isPc(a) ? (a.isToken ? game.actors.get(a.id) ?? a : a) : null

/** The browser that sees the mark or the entry reports it; the active GM writes, the others ask him. */
async function report(pc, host){
  if (!pc || !host || !ncEnabled() || landingLegacy()) return
  const data = {
    actorId: pc.id, host: host.uuid
  }
  if (game.user.isActiveGM) return recordDiscovery(data, game.user.id)
  if (!game.users.activeGM) return
  const {
    SR5_SocketHandler
  } = await import("../../socket.js")
  await SR5_SocketHandler.emitForGM("ncAccessFound", data)
}

export async function _socketAccessFound(message, senderId){
  if (!game.user.isActiveGM || !ncEnabled()) return
  await recordDiscovery(message.data ?? {
  }, senderId)
}

async function recordDiscovery(data, userId){
  const user = game.users.get(userId)
  const pc = game.actors.get(data.actorId)
  const host = resolve(data.host)
  if (!user || !isPc(pc) || !isHost(host) || !pc.testUserPermission(user, "OWNER")) return
  await updateLedger(NC_SETTINGS.accesses, raw => {
    const list = withDiscovery(raw.list ?? [], {
      id: foundry.utils.randomID(), host: host.uuid, actorId: pc.id, name: host.name, date: Date.now(),
      rating: String(host.system?.matrix?.deviceRating ?? ""), play: matrixScene(host) ? "zones" : "book",
    })
    return list ? {
      list
    } : null
  })
}

/** At the active GM's: a client ticked on a vendor's sheet dates its discovery (column "Discoveries"). */
function dateNewClients(item, changes){
  if (!game.user.isActiveGM || item.system?.type !== "shop" || !item.parent || !ncEnabled() || landingLegacy()) return
  const next = foundry.utils.getProperty(changes, "system.shop.clients")
  if (!Array.isArray(next)) return
  const before = new Set((item.system.shop?.clients ?? []).map(c => c.actorId))
  const pcs = next.map(c => c.actorId).filter(id => id && !before.has(id))
  if (!pcs.length) return
  updateLedger(NC_SETTINGS.shops, raw => {
    const list = withShopDiscovered(raw.list ?? [], {
      key: shopKey(item.parent.uuid, item.id), pcs, date: Date.now()
    })
    return list ? {
      list
    } : null
  })
}

/* ------------------------------------------------------------------ */
/* The buttons, the hooks, the migration                               */
/* ------------------------------------------------------------------ */

const openWindow = mode => import("./nc-window.js").then(m => m.SR5NetworkContactsWindow.open(mode))

// The setting off: a module that mounts a view gets the window's answer, and an empty view to unmount
const mounted = async mount => {
  if (ncEnabled()) return mount()
  ui.notifications.warn(L("SR5.NC_Disabled"))
  return {
    redraw(){}, unmount(){}
  }
}

/**
 * game.sr5.networkContacts, for the modules (landing-metroplexes-sr5 mounts the views in its deck pages). The views
 * are imported on first use; mountX() resolves to {redraw(), unmount()}, to be unmounted by whoever mounted it.
 */
export function networkContactsApi(){
  return {
    get enabled(){
      return ncEnabled()
    },
    openNetwork: () => openWindow("network"),
    openContacts: () => openWindow("contacts"),
    mountNetwork: ({
      main, side
    }) => mounted(async () => (await import("./nc-network.js")).mountNetwork({
      main, side
    })),
    mountContacts: ({
      main, side
    }) => mounted(async () => (await import("./nc-contacts.js")).mountContacts({
      main, side
    })),
    mountFactions: side => mounted(async () => (await import("./nc-contacts.js")).mountFactions(side)),
    registerNetworkExtension,
    accesses: () => foundry.utils.deepClone(listAccesses()),
    writeAccess,
    grantAccess,
    shopsDiscovered: () => foundry.utils.deepClone(listShopsDiscovered()),
    discoverShop,
    shopKey,
    // The runs, read only (landing-metroplexes-sr5's latest announcements); the board writes them
    runs: () => foundry.utils.deepClone(listRuns()),
    changedHook: NC_CHANGED,
  }
}

/** Two buttons of the token controls, for everyone, unless Landing's deck holds them (DjamZ, 28/10). */
export function addNetworkContactsTools(controls){
  const tokens = controls?.tokens ?? controls?.token
  if (!tokens?.tools || !ncEnabled() || landingActive()) return
  for (const [name, title, icon, mode] of [
    ["sr5Network", "SR5.NC_Networks", "fas fa-network-wired", "network"],
    ["sr5Contacts", "SR5.NC_Contacts", "fas fa-address-book", "contacts"],
  ]) {
    tokens.tools[name] = {
      name, title, icon, order: Object.keys(tokens.tools).length, button: true, visible: true,
      onChange: () => openWindow(mode),
    }
  }
}

export function registerNetworkContactsHooks(){
  Hooks.on("getSceneControlButtons", addNetworkContactsTools)
  // A mark really put on a host, however it was put (the card's button, the API, a module), and not the defense that
  // only offers it (DjamZ, 30/10). A mark added again: a known access does not change
  Hooks.on(MATRIX_HOOKS.marksChanged, (target, ownerId, value, previous) => {
    if (!(value > previous)) return
    const host = isHost(target) ? target : target?.parent
    // An unlinked token marks under its token id, as markItem reads it, whatever scene this client shows
    if (isHost(host)) report(pcOf(SR5_EntityHelpers.getRealActorFromID(ownerId)), host)
  })
  // sr5.matrixHostChanged: entering a host needs a mark, or the gamemaster putting her there
  Hooks.on("sr5.matrixHostChanged", (actor, hostUuid, previous, reason) => {
    if (reason !== "enter") return
    const host = resolve(hostUuid)
    if (isHost(host)) report(pcOf(actor), host)
  })
  Hooks.on("preUpdateItem", dateNewClients)
  Hooks.once("ready", () => {
    seen.clear()
    for (const d of listIntroductions()) seen.add(`${d.id}:${d.state}`)
    migrateLandingData().catch(e => console.error("SR5 | Network and Contacts migration", e))
  })
}

/** A world setting of a module, read raw: it answers even when the module is off (no registration needed). */
export function rawWorldSetting(key){
  const doc = game.settings.storage.get("world")?.find?.(s => s.key === key)
  let value = doc?.value
  if (typeof value === "string"){
    try {
      value = JSON.parse(value)
    } catch {
      return null
    }
  }
  return value ?? null
}

// 1: Network and Contacts; 2: the runs, their payments and the advance setting
export const NC_MIGRATION_VERSION = 2

/**
 * Landing's data copied into the system, by the active GM: its registers (accesses, shops, factions revealed,
 * introductions, runs with what they already paid), the sharing and sorting of each contact, each user's favorites.
 * Nothing of Landing's is erased (a world can go back). Done once; done again at each load while a Landing older
 * than 1.9.0 is active, which keeps writing its own copy (merge only adds what is missing). A payment Landing made is
 * never made again: the run keeps it, and the sheets' entries Landing flagged are recognized (isPaymentOf).
 */
export async function migrateLandingData(){
  if (!game.user?.isActiveGM) return
  const legacy = landingLegacy()
  const version = Number(game.settings.get("sr5", NC_SETTINGS.migration)) || 0
  const done = version >= NC_MIGRATION_VERSION
  if (done && !legacy) return
  const landingRuns = rawWorldSetting(`${LANDING_ID}.runs`)?.liste ?? []
  const runs = mergeLandingRuns(landingRuns, read(NC_SETTINGS.runs, "list"))
  const newRuns = runs.length - read(NC_SETTINGS.runs, "list").length
  if (newRuns) await updateLedger(NC_SETTINGS.runs, () => ({
    list: runs
  }))
  if (version < 2){
    const advance = Number(rawWorldSetting(`${LANDING_ID}.avanceRuns`)) || 0
    if (advance) await updateLedger(NC_SETTINGS.runAdvance, () => advance)
  }
  const landing = Object.fromEntries(["acces", "boutiquesDecouvertes", "factionsRevelees", "demandes"]
    .map(k => [k, rawWorldSetting(`${LANDING_ID}.${k}`)]))
  const merged = mergeLandingRegisters(landing, {
    accesses: listAccesses(), shops: listShopsDiscovered(), revealed: listRevealed(), introductions: listIntroductions(),
  })
  const count = {
    accesses: merged.accesses.length - listAccesses().length, contacts: 0, users: 0
  }
  if (count.accesses) await updateLedger(NC_SETTINGS.accesses, () => ({
    list: merged.accesses
  }))
  if (merged.shops.length !== listShopsDiscovered().length) await updateLedger(NC_SETTINGS.shops, () => ({
    list: merged.shops
  }))
  if (merged.revealed.length !== listRevealed().length) await updateLedger(NC_SETTINGS.revealed, () => ({
    ids: merged.revealed
  }))
  if (merged.introductions.length !== listIntroductions().length) await updateLedger(NC_SETTINGS.introductions, () => ({
    list: merged.introductions
  }))
  // A contact's sharing and sorting: copied where the system has none yet
  for (const actor of game.actors){
    const updates = []
    for (const item of actor.items){
      if (item.type !== "itemContact") continue
      const old = item.flags?.[LANDING_ID]
      if (!old || item.flags?.sr5?.ncShare) continue
      if (!old.partage && !old.metier) continue
      updates.push({
        _id: item.id, "flags.sr5.ncShare": shareFromLanding(old.partage), "flags.sr5.ncTrade": tradeFromLanding(old.metier)
      })
    }
    if (updates.length){
      await actor.updateEmbeddedDocuments("Item", updates, {
        render: false
      })
      count.contacts += updates.length
    }
  }
  for (const user of game.users){
    const old = user.flags?.[LANDING_ID]?.favoris
    if (!Array.isArray(old) || !old.length || user.flags?.sr5?.ncFavorites) continue
    await user.update({
      "flags.sr5.ncFavorites": cleanFavorites(old)
    })
    count.users++
  }
  // Landing's "boutiquesOuvertes", once: the system's own setting is the GM's afterwards
  if (version < 1 && rawWorldSetting(`${LANDING_ID}.boutiquesOuvertes`) === true) await updateLedger(NC_SETTINGS.shopsOpen, () => true)
  if (!done) await updateLedger(NC_SETTINGS.migration, () => NC_MIGRATION_VERSION)
  if (count.accesses || count.contacts || count.users || newRuns) ui.notifications.info(L("SR5.NC_MigrationDone", {
    a: count.accesses, c: count.contacts, u: count.users, r: newRuns
  }))
  if (legacy) ui.notifications.warn(L("SR5.NC_LandingLegacy"), {
    permanent: true
  })
}
