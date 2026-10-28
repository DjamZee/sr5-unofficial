/**
 * Network and Contacts (taken out of landing-metroplexes-sr5 1.8.0, DjamZ's request of 28/10), without Foundry: they
 * are tested alone (tests/network-contacts-rules.test.js). Everything the system already holds is READ: contacts
 * (Influence = system.connection, Loyalty = system.loyalty, SR5 p. 57, 100 and 386-389), favors (system.favors.chips),
 * the factions registry, the shops' clients. The feature only keeps the matrix accesses, the shops discovered, the
 * sharing chosen by a contact's owner, each user's favorites, the factions revealed and the introductions.
 */

/* ------------------------------------------------------------------ */
/* Contacts                                                            */
/* ------------------------------------------------------------------ */

export const MAX_FAVORITES = 12

/** What another character may see of a contact, besides "private" (the owner decides). */
export const SHARE_LEVELS = ["private", "portrait", "details"]

/** The trades of the book of contacts, in the mock-up's order; "other" takes what does not sort. */
export const TRADES = ["fixers", "gear", "health", "info", "street", "law", "transport", "other"]

// The contact's "type" is free text (itemContact.js): it is sorted by keywords, French and English, without accents
// nor capitals. The order matters: "doc des rues" is health before street, "courtière en informations" is info. Each
// word is looked for at the start of a word ("mage" does not take "image"); the owner may correct the sorting
const WORDS = [
  ["fixers", ["fixer", "intermediair", "johnson", "consigli", "broker", "negociat"]],
  ["info", ["inform", "codeu", "hacker", "decker", "pirate", "reporter", "journalis", "technomanc", "matrice", "matrix", "data", "trideo", "spider"]],
  ["health", ["doc", "medec", "medic", "infirm", "chirurg", "talisman", "mage", "chaman", "shaman", "magie", "magic", "guerisseu", "sante", "alchim"]],
  ["law", ["inspect", "police", "flic", "cop\\b", "agent", "lone star", "knight errant", "municip", "politic", "juge", "judge", "avocat", "lawyer", "procureur", "corpo", "salarym", "wageslave", "fonctionn", "gouvern", "detective", "maire", "militaire", "soldat", "officier"]],
  ["transport", ["taxi", "chauffeur", "driver", "coyote", "contreband", "smuggl", "pilot", "passeur", "rigger", "transport", "camion"]],
  ["gear", ["arme", "armur", "gunsmith", "weapon", "faussair", "forger", "mecan", "mechanic", "garde du corps", "bodyguard", "nettoy", "cleaner", "planque", "gages", "pawn", "vendeu", "dealer", "marchand", "receleu", "fence", "fourniss", "tailleur"]],
  ["street", ["gang", "squat", "barman", "barmaid", "bartender", "rockstar", "musicien", "pasteur", "pretre", "priest", "clochard", "bookmaker", "mafia", "yakuza", "street", "rue", "taulard"]],
]

export const withoutAccents = s => String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase()

/** A contact's trade from its "type" field, or the sorting chosen by its owner. */
export function tradeOf(type, chosen = ""){
  if (TRADES.includes(chosen)) return chosen
  const t = withoutAccents(type)
  if (!t.trim()) return "other"
  for (const [trade, words] of WORDS) if (words.some(w => new RegExp(`\\b${w}`).test(t))) return trade
  return "other"
}

/** The sharing kept on the contact item, read cleanly (private by default). */
export function shareOf(flag){
  const level = SHARE_LEVELS.includes(flag?.level) ? flag.level : "private"
  const to = flag?.to === "partners" ? "partners" : "team"
  return {
    level, to, partners: [...new Set((flag?.partners ?? []).map(String))]
  }
}

/**
 * What a viewer sees of a contact: null (nothing), "portrait" (face, name, trade, Influence),
 * "details" (+ Loyalty and favors), "full" (her own contact, or the gamemaster).
 * @param {{ownerId:string, share:object}} c
 * @param {{gm:boolean, mine:Set<string>}} viewer  mine = her characters
 */
export function viewOf(c, {
  gm = false, mine = new Set()
} = {
}){
  if (gm || mine.has(c.ownerId)) return "full"
  const s = shareOf(c.share)
  if (s.level === "private") return null
  if (s.to === "partners" && !s.partners.some(id => mine.has(id))) return null
  return s.level
}

export const seesDetails = view => view === "details" || view === "full"

/** A user's favorites: clean, without duplicates, 12 at most. */
export function cleanFavorites(list){
  return [...new Set((Array.isArray(list) ? list : []).map(String).filter(Boolean))].slice(0, MAX_FAVORITES)
}

/**
 * Toggles a favorite: removed if there, added at the end otherwise; refused at the 13th.
 * @returns {{list:string[], refused:boolean}}
 */
export function toggleFavorite(list, uuid){
  const l = cleanFavorites(list)
  if (l.includes(uuid)) return {
    list: l.filter(u => u !== uuid), refused: false
  }
  if (l.length >= MAX_FAVORITES) return {
    list: l, refused: true
  }
  return {
    list: [...l, uuid], refused: false
  }
}

/** The favors chip: "+2" (the contact owes the character), "−3" (the character owes), "0". */
export function favorsLabel(n){
  n = Number(n) || 0
  return n > 0 ? `+${n}` : n < 0 ? `−${-n}` : "0"
}

/**
 * The contacts of the list, filtered. The favorites are left out (they are shown large above).
 * @param {object[]} contacts  {uuid, name, typeText, trade, factionId, faction, ownerId, mine, influence, loyalty, chips, view}
 * @param {{from, trade, faction, loyalty, favors, text}} f
 */
export function filterContacts(contacts, f = {
}, favorites = []){
  const t = withoutAccents(f.text ?? "").trim()
  const loy = Number(f.loyalty) || 0
  return contacts.filter(c => {
    if (favorites.includes(c.uuid)) return false
    if (f.from && f.from !== "all" && c.ownerId !== f.from && !(f.from === "me" && c.mine)) return false
    if (f.trade && f.trade !== "all" && c.trade !== f.trade) return false
    if (f.faction && f.faction !== "all" && c.factionId !== f.faction) return false
    if (loy && !(seesDetails(c.view) && c.loyalty >= loy)) return false
    if (f.favors === "owed" && !(seesDetails(c.view) && c.chips > 0)) return false
    if (f.favors === "owing" && !(seesDetails(c.view) && c.chips < 0)) return false
    if (t && !withoutAccents(`${c.name} ${c.typeText} ${c.faction ?? ""}`).includes(t)) return false
    return true
  })
}

/**
 * The groups of the list: by trade (order of TRADES), or one group sorted by name, Influence or Loyalty.
 * @returns {{trade:string|null, contacts:object[]}[]}
 */
export function groupContacts(contacts, sort = "trade"){
  const byName = (a, b) => a.name.localeCompare(b.name)
  if (sort === "trade"){
    return TRADES.map(t => ({
      trade: t, contacts: contacts.filter(c => c.trade === t).sort(byName)
    }))
      .filter(g => g.contacts.length)
  }
  const key = {
    influence: c => c.influence, loyalty: c => (seesDetails(c.view) ? c.loyalty : -1)
  }[sort]
  const sorted = [...contacts].sort(key ? (a, b) => key(b) - key(a) || byName(a, b) : byName)
  return sorted.length ? [{
    trade: null, contacts: sorted
  }] : []
}

/**
 * The word of a reputation. The book (Cutting Aces p. 160) shifts the attitude from ±10 only; below, the word only
 * says the direction of the score.
 * @param {number} score
 * @param {number} step  game.sr5.factions' attitudeShift(score) (Cutting Aces p. 160)
 */
export function reputationWord(score, step = 0){
  if (step > 0) return "friendly"
  if (step < 0) return "hostile"
  return score > 0 ? "favorable" : score < 0 ? "wary" : "neutral"
}

/**
 * The factions of the right column.
 * Known: the gamemaster sees them all; a character sees a faction she belongs to, where she has an applied
 * movement, or that the gamemaster revealed.
 * Reachable: an affiliated contact (faction.contacts, itemContact uuids) the viewer sees; when she sees none but one
 * exists, "through a private contact" without naming it.
 * @param {{factions:object[], log:object[]}} registry  setting sr5.sr5Factions
 * @param {{gm, mine:Set, revealed:string[], contacts:Map<uuid, {name, view, mine}>, step:(score)=>number, team:string[]}} o
 */
export function knownFactions(registry, {
  gm = false, mine = new Set(), revealed = [], contacts = new Map(), step = () => 0, team = []
} = {
}){
  const log = (registry?.log ?? []).filter(e => !e.pending)
  // The viewer's score: her characters' sum; for the gamemaster, the team's
  const of = gm ? new Set(team) : mine
  const out = []
  for (const f of registry?.factions ?? []){
    const member = (f.members ?? []).some(id => mine.has(id))
    const movement = log.some(e => e.factionId === f.id && mine.has(e.actorId))
    const isRevealed = revealed.includes(f.id)
    const discovered = member || movement || isRevealed || (gm && log.some(e => e.factionId === f.id && of.has(e.actorId)))
    if (!gm && !discovered) continue
    const score = log.filter(e => e.factionId === f.id && of.has(e.actorId)).reduce((s, e) => s + (Number(e.delta) || 0), 0)
    const affiliated = (f.contacts ?? []).map(u => ({
      uuid: u, ...contacts.get(u)
    })).filter(c => c.name)
    const seen = affiliated.filter(c => c.view).sort((a, b) => (b.mine === true) - (a.mine === true) || a.name.localeCompare(b.name))
    out.push({
      id: f.id, name: f.name, type: f.type ?? "", member, revealed: isRevealed, discovered, score,
      word: reputationWord(score, step(score)),
      through: seen[0] ?? null, throughPrivate: !seen.length && affiliated.length > 0,
    })
  }
  return out.sort((a, b) => (b.discovered - a.discovered) || a.name.localeCompare(b.name))
}

/* ------------------------------------------------------------------ */
/* Introductions (a partner's contact)                                 */
/* ------------------------------------------------------------------ */

// A request: {id, from (actorId of the asker), userId, contact (uuid), owner (actorId), message,
// state: "partner" (the partner must accept) → "gm" (the gamemaster decides) → "accepted" | "refused", date}
export const INTRODUCTION_STATES = ["partner", "gm", "accepted", "refused"]

/** Applies an answer to a request; null when it does not apply (wrong state, wrong answerer). */
export function answerIntroduction(request, {
  by, accept
}){
  if (!request) return null
  if (request.state === "partner" && by === "partner") return {
    ...request, state: accept ? "gm" : "refused"
  }
  if (request.state === "gm" && by === "gm") return {
    ...request, state: accept ? "accepted" : "refused"
  }
  return null
}

/** The closed requests go beyond the 30 latest; the open ones always stay. */
export function pruneIntroductions(requests, max = 30){
  const open = requests.filter(d => d.state === "partner" || d.state === "gm")
  const closed = requests.filter(d => !open.includes(d)).sort((a, b) => (b.date ?? 0) - (a.date ?? 0)).slice(0, max)
  return [...open, ...closed]
}

/* ------------------------------------------------------------------ */
/* Network: matrix accesses and shops                                  */
/* ------------------------------------------------------------------ */

export const ACCESS_TYPES = ["server", "haven"]
// How the server is played: by the book, in zones of the module Matrice, in nodes (Xama's rule)
export const PLAY_MODES = ["book", "zones", "nodes"]
// A discovery stays "new" three real days: from one session to the next, it no longer is
export const NEW_MS = 3 * 24 * 3600 * 1000

/** A clean access: the known fields, cleaned; the id is given by the caller. */
export function normalizeAccess(a){
  return {
    id: String(a.id ?? ""),
    name: String(a.name ?? "").trim() || "?",
    type: ACCESS_TYPES.includes(a.type) ? a.type : "server",
    host: a.host ? String(a.host) : "",
    journal: a.journal ? String(a.journal) : "",
    pcs: [...new Set((a.pcs ?? []).map(String))],
    level: String(a.level ?? "").trim(),
    note: String(a.note ?? "").trim(),
    play: PLAY_MODES.includes(a.play) ? a.play : "book",
    rating: String(a.rating ?? "").trim(),
    by: a.by ? String(a.by) : "",
    date: Number(a.date) || 0,
  }
}

/** "New": discovered less than NEW_MS ago. */
export const isNew = (date, now = Date.now()) => !!date && now - date < NEW_MS

/** Adds or replaces an access (by id) in a copy of the list; removes it with `remove`. */
export function withAccess(list, access, {
  remove = false
} = {
}){
  const others = (list ?? []).filter(a => a.id !== access.id)
  return remove ? others : [...others, normalizeAccess(access)]
}

/**
 * The list once a character has put a mark on a host (or entered it): DjamZ's decision (Q4, 22/10), the access is
 * added at once. An access to the same host gains the character; otherwise an access is born, found by her.
 * @returns {Array|null} the new list, or null when nothing changes (already known to this character)
 */
export function withDiscovery(list, {
  host, actorId, name, rating = "", play = "book", date = 0, id = ""
}){
  if (!host || !actorId) return null
  const known = (list ?? []).find(a => a.host === host)
  if (known){
    if ((known.pcs ?? []).includes(actorId)) return null
    return withAccess(list, {
      ...known, pcs: [...(known.pcs ?? []), actorId]
    })
  }
  return withAccess(list, {
    id, name, type: "server", host, pcs: [actorId], by: actorId, rating, play, date
  })
}

/** A character's marks as dots, out of three (SR5 p. 237): 2 → "●●○". */
export function dots(n, max = 3){
  const k = Math.max(0, Math.min(max, Number(n) || 0))
  return "●".repeat(k) + "○".repeat(max - k)
}

/**
 * The accesses a viewer sees: the gamemaster all of them (an access without a character is "hidden"), a player
 * those of one of her characters.
 */
export function visibleAccesses(list, {
  gm = false, mine = new Set()
} = {
}){
  return (list ?? []).map(a => ({
    ...a, hidden: !(a.pcs ?? []).length
  }))
    .filter(a => gm || (a.pcs ?? []).some(id => mine.has(id)))
    .sort((a, b) => (a.hidden - b.hidden) || a.type.localeCompare(b.type) || a.name.localeCompare(b.name))
}

/** A shop's key: the vendor and its "shop" storage (a vendor may keep several). */
export const shopKey = (vendorUuid, storageId) => `${vendorUuid}|${storageId}`

/**
 * The shops a viewer sees, from the system's clients and the discoveries.
 * - client: one of her characters is a client (highest Loyalty);
 * - visitor: discovered (the gamemaster showed it) or open to all by the setting;
 * - the gamemaster sees all; what nobody knows is "not discovered".
 * @param {{key, name, open, clients:{actorId,loyalty}[]}[]} shops
 * @param {{key, pcs:string[], date}[]} discovered
 */
export function visibleShops(shops, {
  gm = false, mine = new Set(), allOpen = false, discovered = []
} = {
}){
  const byKey = new Map((discovered ?? []).map(d => [d.key, d]))
  return (shops ?? []).map(b => {
    const d = byKey.get(b.key)
    const clients = (b.clients ?? []).filter(c => gm || mine.has(c.actorId))
    const loyalty = clients.reduce((m, c) => Math.max(m, Number(c.loyalty) || 0), 0)
    const isDiscovered = (d?.pcs ?? []).some(id => gm || mine.has(id))
    const known = clients.length > 0 || isDiscovered || (allOpen && !!b.open)
    return {
      ...b, client: clients.length > 0, loyalty, seenClients: clients, discovered: isDiscovered, known, date: d?.date ?? 0
    }
  })
    .filter(b => gm || b.known)
    .sort((a, b) => (b.known - a.known) || (b.client - a.client) || a.name.localeCompare(b.name))
}

/** The register of shops discovered after "Show to…" (or a client ticked): characters added, date set. */
export function withShopDiscovered(list, {
  key, pcs = [], date = 0
}){
  const others = (list ?? []).filter(d => d.key !== key)
  const before = (list ?? []).find(d => d.key === key)
  const all = [...new Set([...(before?.pcs ?? []), ...pcs.map(String)])]
  if (before && all.length === before.pcs.length) return null
  if (!all.length) return null
  return [...others, {
    key, pcs: all, date: date || before?.date || 0
  }]
}

/**
 * The "Discoveries" column: the accesses and shops the viewer knows (and what a module adds, landing-metroplexes-sr5's
 * places), dated, latest first; what has no date does not show.
 */
export function recentDiscoveries({
  accesses = [], shops = [], extra = []
}, {
  max = 12
} = {
}){
  return [
    ...extra.filter(l => l.date && !l.hidden).map(l => ({
      kind: l.kind ?? "place", name: l.name, date: l.date, img: l.img ?? "", id: l.id
    })),
    ...accesses.filter(a => a.date && !a.hidden).map(a => ({
      kind: a.type === "haven" ? "haven" : "access", name: a.name, date: a.date, img: "", id: a.id
    })),
    ...shops.filter(b => b.date && b.known).map(b => ({
      kind: "shop", name: b.name, date: b.date, img: b.img ?? "", id: b.key
    })),
  ].sort((a, b) => b.date - a.date).slice(0, max)
}

/* ------------------------------------------------------------------ */
/* Migration from landing-metroplexes-sr5 (1.8.0 and before)           */
/* ------------------------------------------------------------------ */

const LANDING_TRADES = {
  fixers: "fixers", matos: "gear", sante: "health", info: "info", rue: "street", loi: "law", transport: "transport", autres: "other"
}
const LANDING_LEVELS = {
  prive: "private", portrait: "portrait", carnet: "details"
}
const LANDING_STATES = {
  partenaire: "partner", mj: "gm", acceptee: "accepted", refusee: "refused"
}

/** A Landing access ({nom, hote, pj, jeu: "livre"…}) in the system's shape. */
export function accessFromLanding(a){
  return normalizeAccess({
    id: a?.id, name: a?.nom, type: a?.type === "paradis" ? "haven" : "server", host: a?.hote, journal: a?.journal,
    pcs: a?.pj, level: a?.niveau, note: a?.note, rating: a?.indice, by: a?.par, date: a?.date,
    play: {
      livre: "book", zones: "zones", noeuds: "nodes"
    }[a?.jeu] ?? "book",
  })
}

export const shopDiscoveredFromLanding = d => ({
  key: String(d?.cle ?? ""), pcs: [...new Set((d?.pj ?? []).map(String))], date: Number(d?.date) || 0
})

/** Landing's sharing flag ({niveau, pour, vers}) in the system's shape. */
export const shareFromLanding = f => shareOf({
  level: LANDING_LEVELS[f?.niveau], to: f?.pour === "partenaires" ? "partners" : "team", partners: f?.vers
})

export const tradeFromLanding = m => LANDING_TRADES[m] ?? ""

export function introductionFromLanding(d){
  return {
    id: String(d?.id ?? ""), from: String(d?.de ?? ""), userId: String(d?.userId ?? ""), contact: String(d?.contact ?? ""),
    owner: String(d?.proprietaire ?? ""), message: String(d?.message ?? ""), state: LANDING_STATES[d?.etat] ?? "refused",
    date: Number(d?.date) || 0,
  }
}

/**
 * Merges Landing's registers into the system's, never losing what either holds: an entry already in the system (same
 * id, same shop key, same request id) is kept as it is, Landing's other entries are added.
 * @param {{acces?, boutiquesDecouvertes?, factionsRevelees?, demandes?}} landing  the raw values of Landing's settings
 * @param {{accesses, shops, revealed, introductions}} system  the system's current lists
 */
export function mergeLandingRegisters(landing, system){
  const add = (mine, theirs, key) => {
    const seen = new Set(mine.map(key))
    return [...mine, ...theirs.filter(x => key(x) && !seen.has(key(x)))]
  }
  return {
    accesses: add(system.accesses ?? [], (landing?.acces?.liste ?? []).map(accessFromLanding), a => a.id),
    shops: add(system.shops ?? [], (landing?.boutiquesDecouvertes?.liste ?? []).map(shopDiscoveredFromLanding), d => d.key),
    revealed: [...new Set([...(system.revealed ?? []), ...(landing?.factionsRevelees?.ids ?? []).map(String)])],
    introductions: add(system.introductions ?? [], (landing?.demandes?.liste ?? []).map(introductionFromLanding), d => d.id),
  }
}
