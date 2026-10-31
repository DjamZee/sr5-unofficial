import {
  MAX_FAVORITES, TRADES, SHARE_LEVELS, tradeOf, shareOf, viewOf, seesDetails, cleanFavorites, toggleFavorite, favorsLabel,
  filterContacts, groupContacts, knownFactions
} from "./nc-rules.js"
import {
  NC_CHANGED, listIntroductions, listRevealed, myCharacters, sendIntroduction, setFactionRevealed
} from "./nc-registry.js"
import {
  listenWhileMounted
} from "./nc-listen.js"

// CONTACTS, the fixer's book (landing-metroplexes-sr5 1.2.0 to 1.8.0, the mock-up validated by DjamZ on 22/10). It
// mounts in two containers: the system's window (nc-window.js) and Landing's deck page. It READS the system (contacts,
// favors, factions registry, commcode messaging); it only keeps:
// - on the contact item, the sharing chosen by its owner and its sorting (flags sr5.ncShare and sr5.ncTrade);
// - on the user, her 12 favorites (flag sr5.ncFavorites, an ordered list of uuids);
// - two registers written by the active GM: the factions revealed and the introductions (nc-registry.js).

const L = (k, d) => d ? game.i18n.format(`SR5.NC_${k}`, d) : game.i18n.localize(`SR5.NC_${k}`)
const esc = s => foundry.utils.escapeHTML(String(s ?? ""))

/** The filters of the list, kept from one drawing to the next on this client only. */
const state = {
  tab: "team", from: "all", trade: "all", faction: "all", loyalty: 0, favors: "all", text: "", sort: "trade", scroll: 0
}

/** The factions registry of the system (setting sr5.sr5Factions), read as it is. */
function registry(){
  try {
    return game.settings.get("sr5", "sr5Factions") ?? {
    }
  } catch {
    return {
    }
  }
}

const commcode = () => game.sr5?.commcode ?? null
const contactsApi = () => game.sr5?.contacts ?? null
const actorName = id => game.actors.get(id)?.name ?? "?"
const contactName = uuid => fromUuidSync(uuid)?.name ?? "?"

/* ------------------------------------------------------------------ */
/* Reads                                                               */
/* ------------------------------------------------------------------ */

/** The team's characters: the PCs a player owns. */
function team(){
  return game.actors.filter(a => a.type === "actorPc" && a.hasPlayerOwner).sort((a, b) => a.name.localeCompare(b.name))
}

/** The team's contacts this viewer sees, with what she sees of them. Read again at each drawing, never kept. */
function readContacts(){
  const gm = game.user.isGM
  const mine = myCharacters()
  const factions = registry().factions ?? []
  const out = []
  for (const pc of team()){
    for (const item of pc.items){
      if (item.type !== "itemContact") continue
      const share = item.flags?.sr5?.ncShare
      const view = viewOf({
        ownerId: pc.id, share
      }, {
        gm, mine
      })
      if (!view) continue
      const f = factions.find(x => x.contacts?.includes(item.uuid))
      out.push({
        item, uuid: item.uuid, name: item.name, img: item.img, typeText: item.system?.type ?? "",
        trade: tradeOf(item.system?.type, item.flags?.sr5?.ncTrade),
        ownerId: pc.id, owner: pc.name, mine: mine.has(pc.id),
        influence: Number(item.system?.connection) || 0, loyalty: Number(item.system?.loyalty) || 0,
        chips: Number(item.system?.favors?.chips) || 0,
        share: shareOf(share), view, factionId: f?.id ?? "", faction: f?.name ?? "",
      })
    }
  }
  return out
}

const myFavorites = () => cleanFavorites(game.user.flags?.sr5?.ncFavorites)

/* ------------------------------------------------------------------ */
/* Drawing                                                             */
/* ------------------------------------------------------------------ */

const shortOwner = (c, gm) => c.mine && !gm ? L("C_Moi") : esc(c.owner)

function shareTag(c){
  const s = c.share
  if (s.level === "private") return `<span class="sr5-nc-tag t-pr">${L("C_Prive")}</span>`
  const to = s.to === "team" ? ` · ${L("C_Equipe")}` : ` → ${s.partners.map(actorName).map(esc).join(", ") || "?"}`
  return `<span class="sr5-nc-tag t-eq">${L(`C_Niveau_${s.level}`)}${to}</span>`
}

function stats(c){
  const sd = seesDetails(c.view)
  const cls = !sd ? "" : c.chips > 0 ? "fav-p" : c.chips < 0 ? "fav-m" : ""
  return `<div class="sr5-nc-stats">
    <div class="sr5-nc-stat"><i>${L("C_Influence")}</i><b>${c.influence}</b></div>
    <div class="sr5-nc-stat"><i>${L("Loyaute")}</i><b class="${sd ? "" : "mut"}">${sd ? c.loyalty : "?"}</b></div>
    <div class="sr5-nc-stat ${cls}" data-tooltip="${L("Faveurs")}"><i>${L("C_Faveurs")}</i><b class="${sd ? "" : "mut"}">${sd ? favorsLabel(c.chips) : "?"}</b></div>
  </div>`
}

function buttonsOf(c, gm, {
  list = false
} = {
}){
  if (gm) return `<button type="button" class="sr5-nc-btn" data-nc-act="sheet" data-uuid="${c.uuid}">${L("C_Fiche")}</button>`
  if (c.mine){
    return `<button type="button" class="sr5-nc-btn j" data-nc-act="call" data-uuid="${c.uuid}">${L("C_Appeler")}</button>` +
      (list ? ` <button type="button" class="sr5-nc-btn" data-nc-act="favor" data-uuid="${c.uuid}">${L("C_Faveur")}</button>` : "")
  }
  return `<button type="button" class="sr5-nc-btn" data-nc-act="introduction" data-uuid="${c.uuid}">${L("C_Presentation")}</button>`
}

function card(c, gm){
  const owner = c.mine && !gm ? L("C_MonContact") : L("C_ContactDe", {
    nom: c.owner
  })
  return `<div class="sr5-nc-carte ${gm && c.share.level === "private" ? "mjfond" : ""}">
    <div class="por" style="background-image:url('${esc(c.img)}')" ${c.mine || gm ? `data-nc-act="sheet" data-uuid="${c.uuid}"` : ""}>
      <button type="button" class="etoile-carte" data-nc-act="favorite" data-uuid="${c.uuid}" data-tooltip="${L("C_RetirerFavori")}">★</button>
      <div class="prop">${esc(owner)}</div>
    </div>
    <div class="corps"><div class="nom">${esc(c.name)}</div><div class="arch">${esc(c.typeText) || "&nbsp;"}</div>
      ${stats(c)}<div class="bas">${buttonsOf(c, gm)}</div></div>
  </div>`
}

function row(c, gm, favorite){
  const sd = seesDetails(c.view)
  const color = !sd ? "mut" : c.chips > 0 ? "vert" : c.chips < 0 ? "rouge" : "mut"
  const share = c.mine && !gm ?
    `<button type="button" class="sr5-nc-tagbtn" data-nc-act="share" data-uuid="${c.uuid}" data-tooltip="${L("C_ChangerPartage")}">${shareTag(c)}</button>` :
    gm ? shareTag(c) : ""
  return `<div class="sr5-nc-ligne ${gm && c.share.level === "private" ? "mjfond" : ""}">
    <button type="button" class="etoile ${favorite ? "" : "off"}" data-nc-act="favorite" data-uuid="${c.uuid}" data-tooltip="${L(favorite ? "C_RetirerFavori" : "C_AjouterFavori")}">${favorite ? "★" : "☆"}</button>
    <img src="${esc(c.img)}" alt="">
    <span class="nm"><b>${esc(c.name)}</b><small>${esc(c.typeText)}</small></span>
    <span class="${c.mine && !gm ? "moi" : ""}">${shortOwner(c, gm)}</span>
    <span class="mut">${esc(c.faction) || "—"}</span>
    <span class="v">${c.influence}</span>
    <span class="v">${sd ? c.loyalty : "<span class='mut'>?</span>"}</span>
    <span class="v ${color}">${sd ? favorsLabel(c.chips) : "?"}</span>
    <span>${share}</span>
    <span class="act">${buttonsOf(c, gm, {
    list: true
  })}</span>
  </div>`
}

function htmlList(contacts, gm, favorites){
  const base = state.tab === "mine" ? contacts.filter(c => c.mine) : contacts
  const kept = filterContacts(base, {
    ...state, from: state.tab === "mine" ? "all" : state.from
  }, favorites)
  const others = base.filter(c => !favorites.includes(c.uuid)).length
  const privates = gm ? base.filter(c => c.share.level === "private").length : 0
  let counter = L("C_Autres", {
    n: others
  })
  if (kept.length !== others) counter += ` · ${L("C_Affiches", {
    n: kept.length
  })}`
  if (privates) counter += ` · ${L("C_DontPrives", {
    n: privates
  })}`
  const groups = groupContacts(kept, state.sort)
  let html = `<div class="sr5-nc-ligne ent"><span></span><span></span><span>${L("C_Contact")}</span><span>${L("C_De")}</span><span>${L("C_Faction")}</span>
    <span class="v">${L("C_Infl")}</span><span class="v">${L("C_Loy")}</span><span class="v">${L("C_Fav")}</span><span>${L("C_Partage")}</span><span></span></div>`
  for (const g of groups){
    if (g.trade) html += `<div class="sr5-nc-c-groupe">${L(`C_Metier_${g.trade}`)} <span>· ${g.contacts.length}</span></div>`
    html += g.contacts.map(c => row(c, gm, false)).join("")
  }
  if (!groups.length) html += `<p class="sr5-nc-vide">${L(others ? "C_RienNeCorrespond" : "C_AucunAutre")}</p>`
  return {
    counter, html
  }
}

function chips(name, values, current){
  return `<span class="sr5-nc-puces">${values.map(([v, t]) => `<button type="button" class="${String(current) === String(v) ? "on" : ""}" data-nc-act="filter" data-filter="${name}" data-value="${esc(v)}">${esc(t)}</button>`).join("")}</span>`
}

function select(name, values, current){
  return `<select data-nc-filter="${name}">${values.map(([v, t]) => `<option value="${esc(v)}" ${String(current) === String(v) ? "selected" : ""}>${esc(t)}</option>`).join("")}</select>`
}

function htmlFilters(contacts, gm){
  const owners = [...new Map(contacts.filter(c => !c.mine).map(c => [c.ownerId, c.owner])).entries()].sort((a, b) => a[1].localeCompare(b[1]))
  const from = state.tab === "mine" ? "" : chips("from", [["all", L("C_Tous")], ...(gm ? [] : [["me", L("C_MoiMaj")]]), ...owners], state.from)
  const factions = [...new Map(contacts.filter(c => c.factionId).map(c => [c.factionId, c.faction])).entries()].sort((a, b) => a[1].localeCompare(b[1]))
  return `<div class="sr5-nc-filtres">
    <input type="search" data-nc-filter="text" value="${esc(state.text)}" placeholder="${L("C_Rechercher")}">
    ${from ? `<span class="sr5-nc-puces-titre">${L("C_De")}</span>${from}` : ""}
    ${select("trade", [["all", L("C_MetierTous")], ...TRADES.map(m => [m, L(`C_Metier_${m}`)])], state.trade)}
    ${select("faction", [["all", L("C_FactionToutes")], ...factions], state.faction)}
    ${select("loyalty", [[0, L("C_LoyauteToutes")], ...[1, 2, 3, 4, 5, 6].map(n => [n, L("C_LoyauteAuMoins", {
    n
  })])], state.loyalty)}
    ${chips("favors", [["all", L("C_Faveurs")], ["owed", L("C_MeDoivent")], ["owing", L("C_JeDois")]], state.favors)}
    ${select("sort", ["trade", "name", "influence", "loyalty"].map(t => [t, L(`C_Tri_${t}`)]), state.sort)}
  </div>`
}

/** The introductions waiting for this viewer (the partner), and her own requests under way. */
function htmlPlayerRequests(){
  const mine = myCharacters()
  const all = listIntroductions()
  const toAnswer = all.filter(d => d.state === "partner" && mine.has(d.owner))
  const asked = all.filter(d => ["partner", "gm"].includes(d.state) && mine.has(d.from))
  if (!toAnswer.length && !asked.length) return ""
  return `<div class="sr5-nc-panneau sr5-nc-demandes">
    ${toAnswer.map(d => `<div class="sr5-nc-dem"><b>${L("C_DemandePresentation", {
    de: actorName(d.from), contact: contactName(d.contact)
  })}</b>
      ${d.message ? `<div class="q">« ${esc(d.message)} »</div>` : ""}
      <div class="boutons"><button type="button" class="sr5-nc-btn j" data-nc-act="answer" data-id="${d.id}" data-accept="1">${L("C_Accepter")}</button>
      <button type="button" class="sr5-nc-btn m" data-nc-act="answer" data-id="${d.id}" data-accept="">${L("C_Refuser")}</button></div></div>`).join("")}
    ${asked.map(d => `<div class="sr5-nc-dem attente"><b>${L("C_MaDemande", {
    contact: contactName(d.contact)
  })}</b>
      <small>${L(d.state === "partner" ? "C_AttentePartenaire" : "C_AttenteMj", {
    nom: actorName(d.owner)
  })}</small></div>`).join("")}
  </div>`
}

/** The calls ringing a commcode no device carries: the gamemaster answers them. */
function pendingCalls(contacts){
  const byUuid = new Map(contacts.map(c => [c.uuid, c]))
  return (commcode()?.unanswered?.() ?? [])
    .map(e => ({
      entry: e, contact: (contactsApi()?.ofCommcode?.(e.to?.commcode) ?? []).map(i => byUuid.get(i.uuid)).find(Boolean) ?? null
    }))
    .sort((a, b) => (a.entry.sentAt ?? 0) - (b.entry.sentAt ?? 0))
}

const since = t => {
  const min = Math.max(0, Math.round((Date.now() - (t ?? Date.now())) / 60000))
  return min < 1 ? L("C_ALInstant") : L("C_IlYA", {
    n: min
  })
}

function htmlGmSide(contacts){
  const calls = pendingCalls(contacts)
  const introductions = listIntroductions().filter(d => d.state === "gm")
  const privates = contacts.filter(c => c.share.level === "private").length
  const blocks = [
    ...calls.map(({
      entry: e, contact: c
    }) => `<div class="sr5-nc-dem"><b>${esc(e.from?.actorName || e.from?.commcode)} → ${esc(c?.name ?? e.to?.commcode)}</b> <small>${since(e.sentAt)}</small>
      ${e.text ? `<div class="q">« ${esc(e.text)} »</div>` : ""}
      ${c ? `<small>${L("C_AppelLoyaute", {
    loy: c.loyalty, fav: favorsLabel(c.chips)
  })}</small>` : ""}
      <div class="boutons"><button type="button" class="sr5-nc-btn j" data-nc-act="pickUp" data-id="${e.id}">${L("C_Decrocher")}</button>
      <button type="button" class="sr5-nc-btn m" data-nc-act="noAnswer" data-id="${e.id}">${L("C_PasDeReponse")}</button></div></div>`),
    ...introductions.map(d => `<div class="sr5-nc-dem"><b>${L("C_DemandePresentation", {
      de: actorName(d.from), contact: contactName(d.contact)
    })}</b>
      <small>${L("C_ContactDe", {
    nom: actorName(d.owner)
  })} · ${L("C_PartenaireAccepte")}</small>
      ${d.message ? `<div class="q">« ${esc(d.message)} »</div>` : ""}
      <div class="boutons"><button type="button" class="sr5-nc-btn j" data-nc-act="answer" data-id="${d.id}" data-accept="1">${L("C_Accepter")}</button>
      <button type="button" class="sr5-nc-btn m" data-nc-act="answer" data-id="${d.id}" data-accept="">${L("C_Refuser")}</button></div></div>`),
  ]
  return {
    count: blocks.length,
    html: `<div class="sr5-nc-c-cote">
      <div class="sr5-nc-panneau"><h2>${L("C_AppelsEnAttente")}</h2>${blocks.join("") || `<p class="sr5-nc-vide">${L("C_AucunAppel")}</p>`}</div>
      <div class="sr5-nc-panneau"><h2>${L("C_PourLeMj")}</h2><div class="sr5-nc-note">${L("C_NoteMj", {
  n: contacts.length, p: privates
})}</div></div>
    </div>`,
  }
}

function htmlMain(contacts){
  const gm = game.user.isGM
  const favorites = myFavorites()
  const byUuid = new Map(contacts.map(c => [c.uuid, c]))
  const base = state.tab === "mine" ? contacts.filter(c => c.mine) : contacts
  const favs = favorites.map(u => byUuid.get(u)).filter(c => c && base.includes(c))
  const side = gm ? htmlGmSide(contacts) : null
  const tabs = [
    `<button type="button" class="${state.tab === "team" ? "on" : ""}" data-nc-act="tab" data-tab="team">${L("C_CarnetEquipe")}</button>`,
    gm ? "" : `<button type="button" class="${state.tab === "mine" ? "on" : ""}" data-nc-act="tab" data-tab="mine">${L("C_MesContacts")}</button>`,
    gm ? `<span class="sr5-nc-onglet-info">${L("C_AppelsEnAttente")} · ${side.count}</span>` : "",
  ].join("")
  const {
    counter, html
  } = htmlList(contacts, gm, favorites)
  return `<nav class="sr5-nc-c-onglets">${tabs}</nav>
    <div class="sr5-nc-c-grille ${gm ? "avec-cote" : ""}">
      <div class="sr5-nc-c-col" data-nc-scroll>
        ${gm ? "" : htmlPlayerRequests()}
        <div class="sr5-nc-fav-titre"><h2>${L("C_Favoris")}</h2><span class="num">${favs.length} / ${MAX_FAVORITES}</span><span class="mut">${L("C_AideFavoris")}</span></div>
        ${favs.length ? `<div class="sr5-nc-favoris">${favs.map(c => card(c, gm)).join("")}</div>` : `<p class="sr5-nc-vide">${L("C_AucunFavori")}</p>`}
        ${htmlFilters(base, gm)}
        <div class="sr5-nc-compteur">${counter}</div>
        <div class="sr5-nc-c-liste">${html}</div>
      </div>
      ${side?.html ?? ""}
    </div>`
}

/** The right column: the factions known, reachable through a contact. */
function htmlSide(contacts){
  const gm = game.user.isGM
  const reg = registry()
  const map = new Map(contacts.map(c => [c.uuid, {
    name: c.name, view: c.view, mine: c.mine
  }]))
  // The affiliated contacts this viewer does not see count for "through a private contact"
  for (const f of reg.factions ?? []) for (const u of f.contacts ?? []) if (!map.has(u)) map.set(u, {
    name: fromUuidSync(u)?.name ?? "", view: gm ? "full" : null
  })
  const factions = knownFactions(reg, {
    gm, mine: myCharacters(), revealed: listRevealed(), contacts: map, step: score => game.sr5?.factions?.attitudeShift?.(score) ?? 0, team: team().map(a => a.id),
  })
  if (!factions.length) return `<p class="sr5-nc-vide">${L("AucuneFaction")}</p>`
  const corps = topology()
  return factions.map(f => {
    const color = f.score > 0 ? "vert" : f.score < 0 ? "rouge" : "mut"
    const through = f.through ?
      `<button type="button" class="sr5-nc-btn" data-nc-act="reach" data-uuid="${f.through.uuid}">${L("C_JoindreVia", {
        nom: f.through.name
      })}</button>` :
      f.throughPrivate ? `<span class="sr5-nc-btn eteint">${L("C_ViaPrive")}</span>` : `<span class="mut">${L("C_AucunContactFaction")}</span>`
    const corp = corps.get(f.id)
    const topo = corp ? ` <button type="button" class="sr5-nc-btn" data-nc-act="topology" data-corp="${esc(corp)}">${L("C_Topologie")}</button>` : ""
    const reveal = !gm ? "" : !f.discovered ?
      `<div class="mjnote">${L("C_NonDecouverte")} · <button type="button" class="lien" data-nc-act="reveal" data-id="${f.id}">${L("C_Reveler")}</button></div>` :
      f.revealed ? `<div class="mjnote">${L("C_Revelee")} · <button type="button" class="lien" data-nc-act="hide" data-id="${f.id}">${L("C_Cacher")}</button></div>` : ""
    return `<div class="sr5-nc-fac ${!f.discovered ? "mjfond fantome" : ""}">
      <div class="fn">${esc(f.name)}</div>
      <div class="ft">${f.type ? L(`C_TypeFaction_${f.type}`) : ""}${f.member ? ` · ${L("Membre")}` : ""}</div>
      <div>${L("C_Reputation")} <span class="att ${color}">${f.score > 0 ? "+" : ""}${f.score} · ${L(`C_Mot_${f.word}`)}</span></div>
      <div class="liens">${through}${topo}</div>${reveal}
    </div>`
  }).join("")
}

/** The factions tied to a megacorp of the Topologie (setting topologie-sr5.state, factions: corp → faction). */
function topology(){
  const out = new Map()
  if (!game.modules.get("topologie-sr5")?.active) return out
  try {
    const links = game.settings.get("topologie-sr5", "state")?.factions ?? {
    }
    for (const [corp, faction] of Object.entries(links)) if (faction) out.set(faction, corp)
  } catch {
    // The Topologie's setting not registered yet: no link
  }
  return out
}

/* ------------------------------------------------------------------ */
/* Mounting                                                            */
/* ------------------------------------------------------------------ */

// What the book draws from: documents, the user's favorites, the registers, the factions and the commcode traffic
const HOOKS = ["createItem", "updateItem", "deleteItem", "updateActor", "createActor", "deleteActor", "updateUser", NC_CHANGED]
const SETTINGS = ["sr5.sr5Factions", "sr5.sr5CommcodeTraffic", "topologie-sr5.state"]

/**
 * Mounts the book in two elements: the main area and the right column (none: no column). Its listeners live until
 * unmount().
 * @returns {{redraw: Function, unmount: Function}}
 */
export function mountContacts({
  main, side = null
}){
  const instance = {
    redraw(){
      const contacts = readContacts()
      const col = main.querySelector("[data-nc-scroll]")
      if (col) state.scroll = col.scrollTop
      const focus = document.activeElement?.dataset?.ncFilter === "text" && main.contains(document.activeElement)
      main.innerHTML = htmlMain(contacts)
      if (side) side.innerHTML = htmlSide(contacts)
      const fresh = main.querySelector("[data-nc-scroll]")
      if (fresh){
        fresh.scrollTop = state.scroll
        filtersHeight(fresh)
      }
      if (focus){
        const field = main.querySelector("[data-nc-filter='text']")
        field?.focus()
        field?.setSelectionRange?.(field.value.length, field.value.length)
      }
    },
    /** The mock-up's message at the 13th favorite: at the bottom of the book, a few seconds. */
    toast(text){
      main.querySelector(".sr5-nc-toast")?.remove()
      const t = document.createElement("div")
      t.className = "sr5-nc-toast"
      t.textContent = text
      main.append(t)
      setTimeout(() => t.remove(), 4000)
    },
    unmount(){
      stop()
      for (const el of [main, side].filter(Boolean)) el.removeEventListener("click", click)
      main.removeEventListener("change", change)
      main.removeEventListener("input", input)
    },
  }
  const click = ev => act(ev, instance)
  const change = ev => {
    const name = ev.target.dataset?.ncFilter
    if (!name || name === "text") return
    state[name] = name === "loyalty" ? Number(ev.target.value) || 0 : ev.target.value
    instance.redraw()
  }
  const input = ev => {
    if (ev.target.dataset?.ncFilter !== "text") return
    state.text = ev.target.value
    // Only the list is drawn again: the field keeps its caret
    const {
      counter, html
    } = htmlList(readContacts(), game.user.isGM, myFavorites())
    main.querySelector(".sr5-nc-c-liste").innerHTML = html
    main.querySelector(".sr5-nc-compteur").textContent = counter
  }
  for (const el of [main, side].filter(Boolean)) el.addEventListener("click", click)
  main.addEventListener("change", change)
  main.addEventListener("input", input)
  const stop = listenWhileMounted(HOOKS, SETTINGS, () => instance.redraw())
  instance.redraw()
  return instance
}

/** The factions column alone (Landing's NEWSFEED page): same rows, same buttons as in the book. */
export function mountFactions(side){
  const instance = {
    redraw(){
      side.innerHTML = htmlSide(readContacts())
    },
    toast(){},
    unmount(){
      stop()
      side.removeEventListener("click", click)
    },
  }
  const click = ev => act(ev, instance)
  side.addEventListener("click", click)
  const stop = listenWhileMounted(HOOKS, SETTINGS, () => instance.redraw())
  instance.redraw()
  return instance
}

/** The list's header and a group's title stick under the search bar, whatever its height. */
function filtersHeight(col){
  const h = col.querySelector(".sr5-nc-filtres")?.offsetHeight ?? 48
  col.style.setProperty("--nc-hf", `${h}px`)
}

/* ------------------------------------------------------------------ */
/* Actions                                                             */
/* ------------------------------------------------------------------ */

const contactBy = uuid => readContacts().find(c => c.uuid === uuid) ?? null

async function act(ev, instance){
  const target = ev.target.closest("[data-nc-act]")
  if (!target) return
  ev.preventDefault()
  ev.stopPropagation()
  const {
    ncAct: action, uuid
  } = target.dataset
  switch (action){
    case "tab":
      state.tab = target.dataset.tab
      state.scroll = 0
      return instance.redraw()
    case "filter":
      state[target.dataset.filter] = target.dataset.value
      return instance.redraw()
    case "favorite": return favorite(uuid, instance)
    case "sheet": return fromUuidSync(uuid)?.sheet?.render(true)
    case "call": return call(contactBy(uuid))
    case "favor": return favor(contactBy(uuid))
    case "introduction": return introduction(contactBy(uuid))
    case "reach": {
      const c = contactBy(uuid)
      if (!c) return
      return c.mine ? call(c) : game.user.isGM ? c.item.sheet?.render(true) : introduction(c)
    }
    case "share": return shareDialog(contactBy(uuid))
    case "answer": return sendIntroduction({
      op: "answer", id: target.dataset.id, accept: !!target.dataset.accept
    })
    case "pickUp": return pickUp(target.dataset.id)
    case "noAnswer": return noAnswer(target.dataset.id)
    case "reveal":
    case "hide": return game.user.isGM ? setFactionRevealed(target.dataset.id, action === "reveal") : null
    case "topology": return game.modules.get("topologie-sr5")?.api?.open?.({
      corp: target.dataset.corp
    })
  }
}

async function favorite(uuid, instance){
  const {
    list, refused
  } = toggleFavorite(game.user.flags?.sr5?.ncFavorites, uuid)
  if (refused) return instance.toast(L("C_TropDeFavoris", {
    nom: fromUuidSync(uuid)?.name ?? "", n: MAX_FAVORITES
  }))
  await game.user.update({
    "flags.sr5.ncFavorites": list
  })
}

/** The device a character calls from: her active device, otherwise the first one with a commcode. */
function deviceOf(actor){
  const devices = actor.items.filter(i => i.type === "itemDevice" && String(i.system?.commcode ?? "").trim())
  return devices.find(i => i.system?.isActive) ?? devices[0] ?? null
}

/** "Call": a commcode call of the system goes to the contact (SR5 p. 241); the gamemaster answers in her name. */
async function call(c){
  if (!c?.mine || !c.item.isOwner) return
  const pc = c.item.parent
  const device = deviceOf(pc)
  if (!device) return ui.notifications.warn(L("C_SansCommlink", {
    nom: pc.name
  }))
  if (!commcode()?.call) return ui.notifications.error(L("C_CommcodeAbsent"))
  const {
    DialogV2
  } = foundry.applications.api
  const text = await DialogV2.prompt({
    classes: ["sr5-nc-window", "sr5-nc-dialogue"],
    window: {
      title: L("C_AppelerTitre", {
        nom: c.name
      })
    },
    content: `<div class="sr5-nc-formulaire"><label>${L("C_AppelerTexte")}<textarea name="texte" rows="3"></textarea></label>
      <p class="sr5-nc-note">${L("C_AppelerAide", {
    appareil: esc(device.name)
  })}</p></div>`,
    ok: {
      label: L("C_Appeler"), icon: "fa-solid fa-phone", callback: (event, button) => button.form.elements.texte.value
    },
    rejectClose: false,
  })
  if (text === null || text === undefined) return
  const code = (await contactsApi()?.commcodeOf?.(c.item, {
    create: true
  })) ?? ""
  if (!code) return ui.notifications.warn(L("C_SansCommcodeContact"))
  // The contact enters the character's directory: her messaging names it
  await commcode().directory?.add?.(pc, {
    name: c.name, commcode: code
  })
  // The gamemaster answers: a refusal warns by itself, a call shows in the device's window
  await commcode().call({
    deviceUuid: device.uuid, to: code, text
  })
  commcode().openDevice?.(device.uuid)
}

/** "Favor": the contact sheet's favor request (lot 37a), as it is. */
async function favor(c){
  if (!c?.mine) return
  if (contactsApi()?.favor) return contactsApi().favor(c.item, "ask")
  c.item.sheet?.render(true)
}

async function introduction(c){
  if (!c || c.mine || game.user.isGM) return
  const mine = myCharacters()
  const from = game.user.character && mine.has(game.user.character.id) ? game.user.character : game.actors.get([...mine][0])
  if (!from) return ui.notifications.warn(L("AucunPj"))
  const {
    DialogV2
  } = foundry.applications.api
  const message = await DialogV2.prompt({
    classes: ["sr5-nc-window", "sr5-nc-dialogue"],
    window: {
      title: L("C_PresentationTitre", {
        nom: c.name
      })
    },
    content: `<div class="sr5-nc-formulaire"><p>${L("C_PresentationTexte", {
      proprietaire: esc(c.owner), nom: esc(c.name)
    })}</p>
      <label>${L("C_PresentationMotif")}<textarea name="message" rows="3"></textarea></label></div>`,
    ok: {
      label: L("C_Demander"), callback: (event, button) => button.form.elements.message.value
    },
    rejectClose: false,
  })
  if (message === null || message === undefined) return
  await sendIntroduction({
    op: "create", contact: c.uuid, from: from.id, message
  })
  ui.notifications.info(L("C_DemandeEnvoyee", {
    proprietaire: c.owner
  }))
}

async function pickUp(id){
  if (!commcode()?.answer) return ui.notifications.error(L("C_CommcodeAbsent"))
  await commcode().answer(id)
  commcode().open?.()
}

async function noAnswer(id){
  if (!commcode()?.refuse) return ui.notifications.error(L("C_CommcodeAbsent"))
  await commcode().refuse(id)
}

/** A contact's sharing, chosen by its owner (never by the gamemaster), and its sorting. */
async function shareDialog(c){
  if (!c?.mine || game.user.isGM || !c.item.isOwner) return
  const s = c.share
  // The partners: the other players' characters (not her own)
  const mine = myCharacters()
  const partners = team().filter(a => !mine.has(a.id))
  const {
    DialogV2
  } = foundry.applications.api
  const chosen = c.item.flags?.sr5?.ncTrade ?? ""
  const content = `<div class="sr5-nc-formulaire">
    <fieldset><legend>${L("C_Partage")}</legend>
      ${SHARE_LEVELS.map(n => `<label class="case"><input type="radio" name="level" value="${n}" ${s.level === n ? "checked" : ""}> <b>${L(`C_Niveau_${n}`)}</b> — ${L(`C_NiveauAide_${n}`)}</label>`).join("")}
    </fieldset>
    <fieldset><legend>${L("C_PartageA")}</legend>
      <label class="case"><input type="radio" name="to" value="team" ${s.to === "team" ? "checked" : ""}> ${L("C_TouteEquipe")}</label>
      <label class="case"><input type="radio" name="to" value="partners" ${s.to === "partners" ? "checked" : ""}> ${L("C_Partenaires")}</label>
      ${partners.map(a => `<label class="case retrait"><input type="checkbox" name="partners" value="${a.id}" ${s.partners.includes(a.id) ? "checked" : ""}> ${esc(a.name)}</label>`).join("")}
    </fieldset>
    <label>${L("C_Rangement")}<select name="trade">
      <option value="" ${chosen ? "" : "selected"}>${L("C_RangementAuto", {
  metier: L(`C_Metier_${tradeOf(c.typeText)}`)
})}</option>
      ${TRADES.map(m => `<option value="${m}" ${chosen === m ? "selected" : ""}>${L(`C_Metier_${m}`)}</option>`).join("")}
    </select></label>
  </div>`
  const data = await DialogV2.prompt({
    classes: ["sr5-nc-window", "sr5-nc-dialogue"],
    window: {
      title: L("C_PartageTitre", {
        nom: c.name
      })
    },
    content,
    ok: {
      label: L("Enregistrer"),
      callback: (event, button) => {
        const f = button.form
        return {
          level: f.querySelector("input[name='level']:checked")?.value ?? "private",
          to: f.querySelector("input[name='to']:checked")?.value ?? "team",
          partners: [...f.querySelectorAll("input[name='partners']:checked")].map(x => x.value),
          trade: f.elements.trade.value,
        }
      },
    },
    rejectClose: false,
  })
  if (!data) return
  await c.item.update({
    "flags.sr5.ncShare": shareOf(data), "flags.sr5.ncTrade": data.trade
  })
}
