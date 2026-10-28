import {
  ACCESS_TYPES, PLAY_MODES, visibleAccesses, visibleShops, shopKey, recentDiscoveries, isNew, dots
} from "./nc-rules.js"
import {
  NC_CHANGED, listAccesses, writeAccess, listShopsDiscovered, discoverShop, shopsAllOpen, myCharacters, matrixScene,
  networkExtensions
} from "./nc-registry.js"
import {
  listenWhileMounted
} from "./nc-listen.js"
import {
  htmlRuns, runAction
} from "./nc-runs.js"

// NETWORK, accesses and shops (landing-metroplexes-sr5 1.3.0 to 1.8.0, blocks 3 and 4 of the mock-up validated by
// DjamZ on 22/10). It mounts in the system's window and in Landing's deck page. It READS the system (hosts, marks,
// vendors and their clients, information broker); the registers of the accesses and of the shops discovered are the
// active GM's (nc-registry.js). A module adds its own tabs and panels (registerNetworkExtension): without one, the
// network shows its accesses and shops only, and no empty tab.

const L = (k, d) => d ? game.i18n.format(`SR5.NC_${k}`, d) : game.i18n.localize(`SR5.NC_${k}`)
const esc = s => foundry.utils.escapeHTML(String(s ?? ""))
// The tab open, on this client only
const state = {
  tab: "access"
}

// The system's public API (Joël#5126): game.sr5.matrix.marksOn(persona, host) → 0-3
const marksOn = () => game.sr5?.matrix?.marksOn ?? null
const actorName = id => game.actors.get(id)?.name ?? "?"
const isHost = a => a?.type === "actorDevice" && a.system?.matrix?.deviceType === "host"
const resolve = uuid => {
  try {
    return uuid ? fromUuidSync(uuid) : null
  } catch {
    return null
  }
}

/* ------------------------------------------------------------------ */
/* Reads                                                               */
/* ------------------------------------------------------------------ */

/** The accesses seen, with what the host says of itself: rating, each character's marks. */
function readAccesses(){
  const gm = game.user.isGM
  const mine = myCharacters()
  const on = marksOn()
  return visibleAccesses(listAccesses(), {
    gm, mine
  }).map(a => {
    const host = resolve(a.host)
    const readable = isHost(host)
    const who = gm ? a.pcs : a.pcs.filter(id => mine.has(id))
    const marks = readable && on ? who.map(id => ({
      id, n: Number(on(game.actors.get(id), host)) || 0
    })) : []
    return {
      ...a, ratingSeen: readable ? String(host.system?.matrix?.deviceRating ?? a.rating) : a.rating,
      marks, max: marks.reduce((m, x) => Math.max(m, x.n), 0),
    }
  })
}

/** The shops of the world, read on the vendors (the system's "shop" storages). */
function worldShops(){
  const out = []
  for (const actor of game.actors){
    for (const item of actor.items){
      if (item.type !== "itemStorage" || item.system?.type !== "shop") continue
      const shop = item.system.shop ?? {
      }
      out.push({
        key: shopKey(actor.uuid, item.id), vendorUuid: actor.uuid, storageId: item.id, actor,
        name: shop.label || item.name || actor.name, vendor: actor.name, img: shop.portrait || actor.img,
        template: shop.template ?? "", open: !!shop.isOpen, clients: shop.clients ?? [],
      })
    }
  }
  return out
}

const readShops = () => visibleShops(worldShops(), {
  gm: game.user.isGM, mine: myCharacters(), allOpen: shopsAllOpen(), discovered: listShopsDiscovered()
})

/* ------------------------------------------------------------------ */
/* Drawing                                                             */
/* ------------------------------------------------------------------ */

/** "5 min ago", "2 h ago", "yesterday", otherwise the day (13/10). */
function when(date){
  const min = Math.floor((Date.now() - date) / 60000)
  const h = Math.floor(min / 60)
  if (min < 1) return L("C_ALInstant")
  if (h < 1) return L("C_IlYA", {
    n: min
  })
  if (h < 24) return L("N_IlYAH", {
    n: h
  })
  if (h < 48) return L("N_Hier")
  return new Date(date).toLocaleDateString(game.i18n.lang, {
    day: "2-digit", month: "2-digit"
  })
}

const newTag = date => isNew(date) ? ` <span class="sr5-nc-tag t-new">${L("N_Nouveau")}</span>` : ""

function accessRow(a, gm){
  const under = [
    a.type === "haven" ? L("N_Paradis") : "",
    a.note ? esc(a.note) : "",
    a.level ? esc(a.level) : "",
    a.by ? L("N_ReperePar", {
      nom: esc(actorName(a.by))
    }) : "",
  ].filter(Boolean).join(" · ")
  const play = a.hidden ? `<span class="sr5-nc-tag t-mj">${L("N_Cache")}</span>` :
    a.type === "haven" ? `<span class="sr5-nc-tag t-eq">${L("N_Jeu_haven")}</span>` :
      `<span class="sr5-nc-tag t-jeu-${a.play}">${L(`N_Jeu_${a.play}`)}</span>`
  // A data haven is read through an account, not marks
  const marks = a.type === "haven" ? L("N_Compte") :
    !a.marks.length ? "—" :
      `<span data-tooltip="${esc(a.marks.map(m => `${actorName(m.id)} : ${m.n}`).join(" · "))}">${dots(a.max)}</span>`
  const buttons = []
  if (a.journal) buttons.push(`<button type="button" class="sr5-nc-btn ${a.type === "haven" ? "j" : ""}" data-nc-act="journal" data-uuid="${esc(a.journal)}">${L(a.type === "haven" ? "N_LireLeFil" : "N_Journal")}</button>`)
  if (gm){
    if (a.hidden) buttons.push(`<button type="button" class="sr5-nc-btn m" data-nc-act="reveal" data-id="${a.id}">${L("N_RevelerA")}</button>`)
    if (a.host) buttons.push(`<button type="button" class="sr5-nc-btn" data-nc-act="server" data-uuid="${esc(a.host)}">${L("N_Serveur")}</button>`)
    buttons.push(`<button type="button" class="sr5-nc-btn" data-nc-act="edit" data-id="${a.id}" data-tooltip="${L("Modifier")}"><i class="fa-solid fa-pen"></i></button>`)
    buttons.push(`<button type="button" class="sr5-nc-btn" data-nc-act="remove" data-id="${a.id}" data-tooltip="${L("Retirer")}"><i class="fa-solid fa-trash"></i></button>`)
  }
  const pcs = gm && a.pcs.length ? `<small class="qui">${a.pcs.map(actorName).map(esc).join(", ")}</small>` : ""
  return `<tr class="${a.hidden ? "mjfond fantome" : ""}">
    <td><b>${esc(a.name)}</b><small>${under || "&nbsp;"}${newTag(a.date)}</small>${pcs}</td>
    <td class="num">${esc(a.ratingSeen) || "—"}</td>
    <td class="num">${marks}</td>
    <td>${play}</td>
    <td class="act">${buttons.join(" ")}</td>
  </tr>`
}

function shopUnder(b){
  const template = b.template ? game.i18n.localize(`SR5.ShopTemplate_${b.template}`) : ""
  return [template.startsWith("SR5.") ? "" : template, b.vendor !== b.name ? b.vendor : ""].filter(Boolean).map(esc).join(" · ")
}

function shopRow(b, gm){
  const broker = b.template === "infoBroker"
  let client
  if (gm) client = b.seenClients.length ?
    b.seenClients.map(c => `<span class="sr5-nc-tag t-ve">${esc(actorName(c.actorId))} ${Number(c.loyalty) || 0}</span>`).join(" ") :
    b.known ? `<span class="sr5-nc-tag t-pr">${L("N_Visiteur")}</span>` : "—"
  else client = b.client ? `<span class="sr5-nc-tag t-ve">${L("N_Loyaute", {
    n: b.loyalty
  })}</span>` : `<span class="sr5-nc-tag t-pr">${L("N_Visiteur")}</span>`
  // Closed: greyed, without a button (the gamemaster keeps hers); not yet discovered: "Show to…" alone (mock-up)
  const buttons = []
  if (b.known && (b.open || gm)){
    if (broker) buttons.push(`<button type="button" class="sr5-nc-btn j" data-nc-act="broker" data-key="${esc(b.key)}">${L("N_InfosAVendre")}</button>`)
    else buttons.push(`<button type="button" class="sr5-nc-btn j" data-nc-act="shop" data-key="${esc(b.key)}">${L("N_Ouvrir")}</button>`)
  }
  if (gm && !b.known) buttons.push(`<button type="button" class="sr5-nc-btn m" data-nc-act="discover" data-key="${esc(b.key)}">${L("N_FaireDecouvrir")}</button>`)
  else if (gm) buttons.push(`<button type="button" class="sr5-nc-btn" data-nc-act="discover" data-key="${esc(b.key)}" data-tooltip="${L("N_FaireDecouvrir")}"><i class="fa-solid fa-eye"></i></button>`)
  const closed = !b.open ? ` <span class="sr5-nc-tag t-pr">${L("N_Fermee")}</span>` : ""
  return `<tr class="${!b.known ? "mjfond fantome" : !b.open ? "fermee" : ""}">
    <td><img class="sr5-nc-logo" src="${esc(b.img)}" alt=""></td>
    <td><b>${esc(b.name)}</b><small>${gm && !b.known ? L("N_NonDecouverte") : shopUnder(b) || "&nbsp;"}${closed}${newTag(b.date)}</small></td>
    <td>${client}</td>
    <td class="act">${buttons.join(" ")}</td>
  </tr>`
}

/** The extensions' parts, each read safely: a module that fails leaves the network drawn. */
function fromExtensions(part){
  const out = []
  for (const ext of networkExtensions){
    try {
      const v = ext[part]?.()
      if (Array.isArray(v)) out.push(...v)
      else if (v) out.push(v)
    } catch (e){
      console.error("SR5 | network extension", e)
    }
  }
  return out
}

const panel = p => `<div class="sr5-nc-panneau sr5-nc-n-panneau ${p.cls ?? ""}">
    <h2>${esc(p.title)}</h2>
    <div class="sr5-nc-n-defil">${p.html}</div>
    ${p.help ? `<div class="sr5-nc-n-aide">${p.help}</div>` : ""}
    ${p.footer ? `<div class="sr5-nc-n-pied">${p.footer}</div>` : ""}
  </div>`

function htmlMain(accesses, shops){
  const gm = game.user.isGM
  // The runs board and its archives came to the system with the network (DjamZ, 28/10)
  const tabs = [
    {
      id: "access", label: L("N_OngletAcces")
    },
    {
      id: "board", label: L("N_OngletRuns"), html: () => htmlRuns("board")
    },
    {
      id: "archives", label: L("N_OngletArchives"), html: () => htmlRuns("archives")
    },
    ...fromExtensions("tabs"),
  ]
  if (!tabs.some(t => t.id === state.tab)) state.tab = "access"
  // One tab only: no tab bar (Élise, 28/10: no empty tab without Landing)
  const nav = tabs.length > 1 ? `<nav class="sr5-nc-c-onglets">${tabs.map(t => `<button type="button" class="${state.tab === t.id ? "on" : ""}" data-nc-act="tab" data-tab="${esc(t.id)}">${esc(t.label)}</button>`).join("")}</nav>` : ""
  const ext = tabs.find(t => t.id === state.tab && t.id !== "access")
  if (ext) return `${nav}${ext.html()}`
  const tAccess = accesses.length ? `<table class="sr5-nc-tbl">
      <tr><th>${L("N_Hote")}</th><th>${L("N_Indice")}</th><th>${L("N_Marks")}</th><th>${L("N_Jeu")}</th><th></th></tr>
      ${accesses.map(a => accessRow(a, gm)).join("")}</table>` :
    `<p class="sr5-nc-vide">${L("AucunAcces")}</p>`
  const tShops = shops.length ? `<table class="sr5-nc-tbl">
      <tr><th></th><th>${L("N_Boutique")}</th><th>${L("N_Client")}</th><th></th></tr>
      ${shops.map(b => shopRow(b, gm)).join("")}</table>` :
    `<p class="sr5-nc-vide">${L("AucunVendeur")}</p>`
  const left = [{
    title: L("N_AccesMatriciels"), html: tAccess, help: L("N_AideAcces"), footer: gm ? `<button type="button" class="sr5-nc-btn" data-nc-act="add">${L("AjouterAcces")}</button>` : ""
  }, ...fromExtensions("panelsLeft")]
  const right = [{
    title: L("N_BoutiquesConnues"), html: tShops, help: L("N_AideBoutiques")
  }, ...fromExtensions("panelsRight")]
  return `${nav}
    <div class="sr5-nc-n-grille">
      <div class="sr5-nc-n-col">${left.map(panel).join("")}</div>
      <div class="sr5-nc-n-col">${right.map(panel).join("")}</div>
    </div>`
}

/** The right column: the team's latest discoveries (accesses, shops, and what an extension adds). */
function htmlSide(accesses, shops){
  const gm = game.user.isGM
  const list = recentDiscoveries({
    accesses, shops, extra: fromExtensions("discoveries")
  })
  const rows = list.map(d => `<div class="sr5-nc-mini">
      ${d.img ? `<img src="${esc(d.img)}" alt="">` : `<div class="ic">⌬</div>`}
      <div><b>${esc(d.name)}</b><br><span class="mut">${L(`N_Genre_${d.kind}`)} · ${when(d.date)}</span></div>
    </div>`).join("")
  const hidden = accesses.filter(a => a.hidden).length
  const unknown = shops.filter(b => !b.known).length
  const extra = gm ? fromExtensions("gmNote").join(" ") : ""
  const note = gm && (hidden || unknown || extra) ? `<div class="mjnote">${L("N_NoteMj", {
    a: hidden, b: unknown
  })}${extra ? ` ${extra}` : ""}</div>` : ""
  return (rows || `<p class="sr5-nc-vide">${L("N_AucuneDecouverte")}</p>`) + note
}

/* ------------------------------------------------------------------ */
/* Mounting                                                            */
/* ------------------------------------------------------------------ */

// What the network draws from: the registers, the vendors, the marks (actors and items), and what extensions follow
const HOOKS = ["createItem", "updateItem", "deleteItem", "updateActor", "createActor", "deleteActor", NC_CHANGED]

/**
 * Mounts the network in two elements: the main area and the right column (none: no column). Its listeners live until
 * unmount().
 * @returns {{redraw: Function, unmount: Function}}
 */
export function mountNetwork({
  main, side = null
}){
  const instance = {
    redraw(){
      const accesses = readAccesses()
      const shops = readShops()
      const scroll = [...main.querySelectorAll(".sr5-nc-n-defil, [data-nc-scroll]")].map(e => e.scrollTop)
      main.innerHTML = htmlMain(accesses, shops)
      main.querySelectorAll(".sr5-nc-n-defil, [data-nc-scroll]").forEach((e, i) => e.scrollTop = scroll[i] ?? 0)
      if (side) side.innerHTML = htmlSide(accesses, shops)
    },
    unmount(){
      stop()
      for (const el of [main, side].filter(Boolean)) el.removeEventListener("click", click)
    },
  }
  const click = ev => act(ev, instance)
  for (const el of [main, side].filter(Boolean)) el.addEventListener("click", click)
  const hooks = [...HOOKS, ...fromExtensions("hooks")]
  // The factions registry names the runs' movements
  const stop = listenWhileMounted(hooks, ["sr5.ncShopsOpen", "sr5.sr5Factions", ...fromExtensions("settings")], () => instance.redraw())
  instance.redraw()
  return instance
}

/* ------------------------------------------------------------------ */
/* Actions                                                             */
/* ------------------------------------------------------------------ */

const shopBy = key => worldShops().find(b => b.key === key) ?? null

async function act(ev, instance){
  const target = ev.target.closest("[data-nc-act]")
  // A click the network does not know goes to the extensions (Landing's places)
  if (!target){
    for (const ext of networkExtensions) ext.click?.(ev, instance)
    return
  }
  ev.preventDefault()
  ev.stopPropagation()
  const {
    ncAct: action, uuid, id, key
  } = target.dataset
  if (action.startsWith("run-")) return runAction(action, target.dataset)
  switch (action){
    case "tab":
      state.tab = target.dataset.tab
      return instance.redraw()
    case "journal": return openJournal(uuid)
    case "server": return openServer(uuid)
    case "add": return accessDialog({
      pcs: []
    })
    case "edit": {
      const a = listAccesses().find(x => x.id === id)
      return a ? accessDialog(a) : null
    }
    case "remove": return removeAccess(id)
    case "reveal": {
      const a = listAccesses().find(x => x.id === id)
      if (!a) return
      const pcs = await choosePcs(L("N_RevelerTitre", {
        nom: a.name
      }), a.pcs)
      // Revealed: the discovery dates from today (column "Discoveries", tag "new")
      if (pcs) await writeAccess({
        ...a, pcs, date: a.date || (pcs.length ? Date.now() : 0)
      })
      return
    }
    case "shop": {
      const b = shopBy(key)
      if (b) return game.sr5?.vendors?.open?.(b.vendorUuid, b.storageId)
      return
    }
    case "broker": return broker(shopBy(key))
    case "discover": {
      const b = shopBy(key)
      if (!b) return
      const known = listShopsDiscovered().find(d => d.key === key)?.pcs ?? []
      const pcs = await choosePcs(L("N_DecouvrirTitre", {
        nom: b.name
      }), known)
      if (pcs?.length) await discoverShop(key, pcs)
    }
  }
}

async function openJournal(uuid){
  const doc = await fromUuid(uuid)
  if (!doc?.testUserPermission?.(game.user, "LIMITED")) return ui.notifications.warn(L("JournalInaccessible"))
  doc.sheet?.render(true)
}

/** Gamemaster: the server's scene (module Matrice) if there is one, otherwise the host's sheet. */
async function openServer(uuid){
  const host = await fromUuid(uuid)
  const scene = matrixScene(host)
  const doc = scene ? (game.scenes.get(scene) ?? await fromUuid(scene)) : null
  if (doc) return doc.view()
  host?.sheet?.render(true)
}

/** "Information for sale": the system's information broker window (Cutting Aces p. 148-149). */
async function broker(b){
  if (!b) return
  const mine = myCharacters()
  const pc = game.user.character && mine.has(game.user.character.id) ? game.user.character : game.actors.get([...mine][0]) ?? null
  if (game.sr5?.infoBroker?.open) return game.sr5.infoBroker.open({
    vendor: b.actor, buyer: pc
  })
  game.sr5?.vendors?.open?.(b.vendorUuid, b.storageId)
}

async function removeAccess(id){
  const a = listAccesses().find(x => x.id === id)
  if (!a) return
  const {
    DialogV2
  } = foundry.applications.api
  const ok = await DialogV2.confirm({
    classes: ["sr5-nc-window", "sr5-nc-dialogue"], window: {
      title: L("Retirer")
    }, content: `<p>${L("RetirerAcces", {
      nom: esc(a.name)
    })}</p>`
  })
  if (ok) await writeAccess(a, {
    remove: true
  })
}

const worldPcs = () => game.actors.filter(x => x.type === "actorPc").sort((x, y) => x.name.localeCompare(y.name))

/** Gamemaster: tick the characters ("Reveal to…", "Show to…"). */
async function choosePcs(title, ticked = []){
  const {
    DialogV2
  } = foundry.applications.api
  return DialogV2.prompt({
    classes: ["sr5-nc-window", "sr5-nc-dialogue"],
    window: {
      title
    },
    content: `<div class="sr5-nc-formulaire"><fieldset><legend>${L("Personnages")}</legend>
      ${worldPcs().map(p => `<label class="case"><input type="checkbox" name="pc" value="${p.id}" ${ticked.includes(p.id) ? "checked" : ""}> ${esc(p.name)}</label>`).join("")}
    </fieldset></div>`,
    ok: {
      label: L("Enregistrer"), callback: (event, button) => [...button.form.querySelectorAll("input[name='pc']:checked")].map(c => c.value)
    },
    rejectClose: false,
  })
}

/** Gamemaster: an access's form. A host actor or a journal can be dropped on the fields. */
async function accessDialog(a){
  const {
    DialogV2
  } = foundry.applications.api
  const content = `
    <div class="sr5-nc-formulaire">
      <label>${L("Nom")}<input type="text" name="name" value="${esc(a.name ?? "")}" required></label>
      <label>${L("Type")}<select name="type">${ACCESS_TYPES.map(t => `<option value="${t}" ${t === a.type ? "selected" : ""}>${L(`Acces_${t}`)}</option>`).join("")}</select></label>
      <label>${L("N_Jeu")}<select name="play">${PLAY_MODES.map(j => `<option value="${j}" ${j === (a.play ?? "book") ? "selected" : ""}>${L(`N_Jeu_${j}`)}</option>`).join("")}</select></label>
      <label>${L("N_IndiceRepli")}<input type="text" name="rating" value="${esc(a.rating ?? "")}"></label>
      <label>${L("Niveau")}<input type="text" name="level" value="${esc(a.level ?? "")}"></label>
      <label>${L("Hote")}<input type="text" name="host" value="${esc(a.host ?? "")}" placeholder="${L("GlisserIci")}"></label>
      <label>${L("JournalLie")}<input type="text" name="journal" value="${esc(a.journal ?? "")}" placeholder="${L("GlisserIci")}"></label>
      <label>${L("Note")}<input type="text" name="note" value="${esc(a.note ?? "")}"></label>
      <fieldset><legend>${L("Personnages")}</legend>
        ${worldPcs().map(p => `<label class="case"><input type="checkbox" name="pc" value="${p.id}" ${(a.pcs ?? []).includes(p.id) ? "checked" : ""}> ${esc(p.name)}</label>`).join("")}
      </fieldset>
    </div>`
  const data = await DialogV2.prompt({
    classes: ["sr5-nc-window", "sr5-nc-dialogue"],
    window: {
      title: a.id ? L("Modifier") : L("AjouterAcces")
    },
    content,
    render: (event, dialog) => {
      for (const field of dialog.element.querySelectorAll("input[name='host'], input[name='journal']")){
        field.addEventListener("dragover", ev => ev.preventDefault())
        field.addEventListener("drop", ev => {
          ev.preventDefault()
          const drop = foundry.applications.ux.TextEditor.implementation.getDragEventData(ev)
          if (!drop?.uuid) return
          field.value = drop.uuid
          // A host dropped fills its name and rating when they are empty
          const host = field.name === "host" ? resolve(drop.uuid) : null
          const f = field.form
          if (isHost(host)){
            if (!f.elements.name.value) f.elements.name.value = host.name
            if (!f.elements.rating.value) f.elements.rating.value = String(host.system?.matrix?.deviceRating ?? "")
          }
        })
      }
    },
    ok: {
      label: L("Enregistrer"),
      callback: (event, button) => {
        const e = button.form.elements
        return {
          name: e.name.value, type: e.type.value, play: e.play.value, rating: e.rating.value, level: e.level.value,
          host: e.host.value, journal: e.journal.value, note: e.note.value,
          pcs: [...button.form.querySelectorAll("input[name='pc']:checked")].map(c => c.value),
        }
      },
    },
    rejectClose: false,
  })
  if (data) await writeAccess({
    ...a, ...data, date: a.date || Date.now()
  })
}
