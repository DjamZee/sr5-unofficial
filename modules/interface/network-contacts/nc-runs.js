import {
  RUN_STATES, OUTCOMES, normalizeRun, visibleRuns, riskDots, payLabel, reputationLines, readReactions, writeReactions,
  cleanLines, totalAdvance, advanceLines, closureLines, paymentRefusal, withPayment, paymentEntries, paymentText, isPaymentOf
} from "./nc-runs-rules.js"
import {
  listAccesses, listRuns, writeRun, runAdvanceDefault, myCharacters, sendRunInterest, networkExtensions
} from "./nc-registry.js"

// The runs board of the Network (landing-metroplexes-sr5 1.4.0 to 1.8.0; in the system since DjamZ's request of
// 28/10): two tabs of the network, the board and the archives. The register is the active GM's (nc-registry.js); a
// player's "Interested" goes to him through the system's socket. The closure writes to the system's factions registry
// (pending or applied) and, when a module offers it (landing-metroplexes-sr5's feed), a news item. The advance (when
// the run becomes "active") and the balance (at closure) go to the sheets as Karma and nuyen gains, once each.

const L = (k, d) => d ? game.i18n.format(`SR5.NC_${k}`, d) : game.i18n.localize(`SR5.NC_${k}`)
const esc = s => foundry.utils.escapeHTML(String(s ?? ""))
const actorName = id => game.actors.get(id)?.name ?? "?"
const DIALOG = ["sr5-nc-window", "sr5-nc-dialogue"]

/** The team: the PCs a player owns. */
const teamPcs = () => game.actors.filter(a => a.type === "actorPc" && a.hasPlayerOwner).sort((a, b) => a.name.localeCompare(b.name))

/** The character who says "Interested": her assigned character, otherwise the first she owns. */
function myPc(){
  const mine = myCharacters()
  if (game.user.character && mine.has(game.user.character.id)) return game.user.character.id
  return [...mine][0] ?? null
}

/** The module that writes the closure's news item (landing-metroplexes-sr5), if any. */
const echoProvider = () => [...networkExtensions].find(e => e.runEcho?.create)?.runEcho ?? null

/* ------------------------------------------------------------------ */
/* Drawing                                                             */
/* ------------------------------------------------------------------ */

const registryFactions = () => game.sr5?.factionRegistry?.data?.factions ?? []
const factionName = id => registryFactions().find(f => f.id === id)?.name ?? "?"
const sign = n => n > 0 ? `+${n}` : `${n}`

function reactions(r){
  if (!r.reactions.length) return ""
  return `<div class="react">${r.reactions.map(x => `<span class="ton-${x.tone}">${esc(x.faction)}${x.word ? ` : ${esc(x.word)}` : ""}</span>`).join("")}</div>`
}

function linkButtons(r){
  const b = []
  if (r.place) b.push(`<button type="button" class="sr5-nc-btn" data-nc-act="run-journal" data-uuid="${esc(r.place)}">${L("R_VoirLieu")}</button>`)
  const access = r.access ? listAccesses().find(a => a.id === r.access) : null
  if (access?.journal) b.push(`<button type="button" class="sr5-nc-btn" data-nc-act="journal" data-uuid="${esc(access.journal)}">${L("R_Acces", {
    nom: esc(access.name)
  })}</button>`)
  else if (access) b.push(`<span class="sr5-nc-btn eteint">${L("R_Acces", {
    nom: esc(access.name)
  })}</span>`)
  if (r.notes) b.push(`<button type="button" class="sr5-nc-btn" data-nc-act="run-journal" data-uuid="${esc(r.notes)}">${L("R_Notes")}</button>`)
  return b
}

function runCard(r, gm){
  const mine = myCharacters()
  const team = r.team.length ? ` · ${r.team.some(id => mine.has(id)) || gm ? L("R_LEquipe") : ""}` : ""
  const code = r.state === "draft" ? `${L("R_Etat_draft")} · ${L("R_Invisible")}` : `${esc(r.code)} · ${L(`R_Etat_${r.state}`)}${team}`
  const who = r.fixer ? `<span class="mut">${L(`R_Role_${r.role}`)}</span> ${esc(r.fixer)}` : ""
  const pay = r.pay ? `<span class="mut">${L("R_Paie")}</span> <span class="paie">${payLabel(r.pay)}</span>${r.perPerson ? L("R_ParPers") : ""}` : ""
  const whoLine = [who, pay].filter(Boolean).join(" · ")
  const buttons = linkButtons(r)
  if (r.state === "closed"){
    const c = r.closure ?? {
    }
    const mv = (c.movements ?? []).map(m => `<span class="ton-${m.delta > 0 ? "pos" : "neg"}">${esc(factionName(m.factionId))} ${sign(m.delta)}${r.team.length ? ` (${r.team.map(actorName).map(esc).join(", ")})` : ""}</span>`).join("")
    let echoTitle = ""
    try {
      echoTitle = c.echo ? echoProvider()?.title?.(c.echo) ?? "" : ""
    } catch {
      echoTitle = ""
    }
    // What went to the sheets (advance, balance), otherwise the balance kept
    const paid = [r.payments.advance, r.payments.balance].filter(Boolean).flatMap(v => v.lines)
    const paidText = paid.length ? L("R_Paye", {
      paie: payLabel(paid.reduce((s, l) => s + l.nuyens, 0))
    }) :
      c.pay && !c.toPay?.length ? L("R_Paye", {
        paie: payLabel(c.pay)
      }) : ""
    const detail = gm && r.payments.balance ? `<div class="mjnote">${L("R_VerseListe", {
      liste: esc(paymentText(r.payments.balance.lines, actorName))
    })}</div>` : ""
    const rest = c.toPay?.length && !r.payments.balance ? `<div class="mjnote">${L("R_AVerser", {
      liste: esc(paymentText(c.toPay, actorName))
    })}</div>` : ""
    const bottom = gm ? [
      rest ? `<button type="button" class="sr5-nc-btn j" data-nc-act="run-pay" data-id="${r.id}">${L("R_Verser")}</button>` : "",
      `<button type="button" class="sr5-nc-btn" data-nc-act="run-edit" data-id="${r.id}" data-tooltip="${L("Modifier")}"><i class="fa-solid fa-pen"></i></button>`,
    ].join("") : ""
    return `<div class="sr5-nc-run clos">
      <div class="code">${esc(r.code)} · ${L(`R_Issue_${c.outcome ?? "success"}`)}</div>
      <div class="rt">${esc(r.title)}</div>
      <div class="tx">${paidText}${echoTitle ? ` ${L("R_EchoDansFil", {
  titre: esc(echoTitle)
})}` : ""}</div>
      ${mv ? `<div class="react">${mv}</div>` : ""}
      ${gm ? detail + rest : ""}
      ${bottom ? `<div class="bas">${bottom}</div>` : ""}
    </div>`
  }
  if (gm){
    if (r.state === "draft"){
      buttons.push(`<button type="button" class="sr5-nc-btn j" data-nc-act="run-publish" data-id="${r.id}">${L("R_Publier")}</button>`)
    } else {
      const next = {
        open: "meeting", meeting: "active"
      }[r.state]
      if (next) buttons.push(`<button type="button" class="sr5-nc-btn" data-nc-act="run-state" data-id="${r.id}" data-state="${next}">${L(`R_Vers_${next}`)}</button>`)
      // An advance a sheet already holds (a register Landing lost) offers no button: the payment would be refused
      if (r.state === "active" && r.advance && !r.payments.advance && !alreadyOnSheets(r.id, "advance")) buttons.push(`<button type="button" class="sr5-nc-btn" data-nc-act="run-advance" data-id="${r.id}">${L("R_VerserAvance")}</button>`)
      buttons.push(`<button type="button" class="sr5-nc-btn j" data-nc-act="run-close" data-id="${r.id}">${L("R_Clore")}</button>`)
    }
    buttons.push(`<button type="button" class="sr5-nc-btn" data-nc-act="run-edit" data-id="${r.id}" data-tooltip="${L("Modifier")}"><i class="fa-solid fa-pen"></i></button>`)
    buttons.push(`<button type="button" class="sr5-nc-btn" data-nc-act="run-remove" data-id="${r.id}" data-tooltip="${L("Retirer")}"><i class="fa-solid fa-trash"></i></button>`)
  } else if (["open", "meeting"].includes(r.state)){
    const me = myPc()
    const already = me && r.interested.includes(me)
    buttons.push(`<button type="button" class="sr5-nc-btn ${already ? "" : "j"}" data-nc-act="run-interest" data-id="${r.id}">${L(already ? "R_PlusInteresse" : "R_Interesse")}</button>`)
  }
  const interested = r.interested.length && r.state !== "active" ? `<small>${L(r.interested.length > 1 ? "R_Interesses" : "R_Interesse1", {
    noms: r.interested.map(actorName).map(esc).join(", ")
  })}</small>` : ""
  const gmInfo = gm ? [
    r.karma ? L("R_KarmaRun", {
      n: r.karma
    }) : "",
    r.advance ? L(r.payments.advance ? "R_AvanceFaite" : "R_AvancePrevue", {
      pct: r.advance, paie: payLabel(totalAdvance(r))
    }) : "",
    r.for === "chosen" ? L("F_PourQui", {
      noms: r.pcs.map(actorName).map(esc).join(", ") || "—"
    }) : L("R_PourEquipe"),
    r.planned.length ? L("R_Prevus", {
      liste: r.planned.map(p => `${esc(factionName(p.factionId))} ${sign(p.delta)}`).join(" · ")
    }) : "",
    r.gmNote ? esc(r.gmNote) : "",
  ].filter(Boolean).join(" · ") : ""
  return `<div class="sr5-nc-run ${r.state === "active" ? "encours" : ""} ${r.state === "draft" ? "mjfond" : ""}">
    <div class="code">${code}</div>
    <div class="rt">${esc(r.title)}</div>
    ${r.text ? `<div class="tx">${esc(r.text)}</div>` : ""}
    ${whoLine ? `<div>${whoLine}</div>` : ""}
    ${r.risk ? `<div><span class="mut">${L("R_Risque")}</span> <span class="risque">${riskDots(r.risk)}</span></div>` : ""}
    ${reactions(r)}
    ${gmInfo ? `<div class="mjnote">${gmInfo}</div>` : ""}
    <div class="bas">${buttons.join("")}${interested}</div>
  </div>`
}

/** The runs grid of a tab ("board" or "archives"). */
export function htmlRuns(tab){
  const gm = game.user.isGM
  const runs = visibleRuns(listRuns(), {
    gm, mine: myCharacters(), tab
  })
  const empty = `<p class="sr5-nc-vide">${L(tab === "archives" ? "R_AucunArchive" : gm ? "R_AucunMj" : "R_Aucun")}</p>`
  const foot = gm && tab === "board" ? `<div class="sr5-nc-n-pied"><button type="button" class="sr5-nc-btn" data-nc-act="run-add">${L("R_Ajouter")}</button></div>` : ""
  return `<div class="sr5-nc-runs" data-nc-scroll>${runs.length ? runs.map(r => runCard(r, gm)).join("") : empty}</div>${foot}`
}

/* ------------------------------------------------------------------ */
/* Actions                                                             */
/* ------------------------------------------------------------------ */

/** The actions of the run cards; false when the action is not one of theirs. */
export async function runAction(action, dataset){
  const run = dataset.id ? listRuns().find(r => r.id === dataset.id) : null
  switch (action){
    case "run-add": return runDialog({
    })
    case "run-edit": return run ? runDialog(run) : true
    case "run-publish": {
      if (!run) return true
      // "Publish" (the whole team, or the characters already chosen) or "Publish for X only" (DjamZ's Q5)
      const to = await choosePublic(run)
      if (to) await writeRun({
        ...run, state: "open", date: Date.now(), ...to
      })
      return true
    }
    case "run-state": {
      if (!run) return true
      const next = await writeRun({
        ...run, state: dataset.state, team: dataset.state === "active" && !run.team.length ? run.interested : run.team
      })
      // The run starts: the advance goes (when the run has one and it did not go yet)
      if (next?.state === "active") await advanceDialog(next)
      return true
    }
    case "run-advance": return run ? advanceDialog(run, {
      asked: true
    }) : true
    case "run-pay": {
      if (run?.closure?.toPay?.length) await pay(run.id, "balance", run.closure.toPay)
      return true
    }
    case "run-interest": {
      const actorId = myPc()
      if (!actorId) return ui.notifications.warn(L("R_PasDePersonnage"))
      return sendRunInterest({
        runId: dataset.id, actorId
      })
    }
    case "run-close": return run ? closeDialog(run) : true
    case "run-remove": {
      if (!run) return true
      const {
        DialogV2
      } = foundry.applications.api
      const ok = await DialogV2.confirm({
        classes: DIALOG, window: {
          title: L("Retirer")
        }, content: `<p>${L("R_RetirerRun", {
          nom: esc(run.title)
        })}</p>`
      })
      if (ok) await writeRun(run, {
        remove: true
      })
      return true
    }
    case "run-journal": {
      const doc = await fromUuid(dataset.uuid)
      if (!doc?.testUserPermission?.(game.user, "LIMITED")) return ui.notifications.warn(L("JournalInaccessible"))
      doc.sheet?.render(true)
      return true
    }
  }
  return false
}

const pcBoxes = (name, ticked) => teamPcs().map(p => `<label class="case"><input type="checkbox" name="${name}" value="${p.id}" ${(ticked ?? []).includes(p.id) ? "checked" : ""}> ${esc(p.name)}</label>`).join("")
const ticked = (form, name) => [...form.querySelectorAll(`input[name='${name}']:checked`)].map(c => c.value)

/** Gamemaster: publish for the team, or for the characters ticked only. */
async function choosePublic(run){
  const {
    DialogV2
  } = foundry.applications.api
  return DialogV2.wait({
    classes: DIALOG,
    window: {
      title: L("R_PublierTitre", {
        nom: run.title
      })
    },
    content: `<div class="sr5-nc-formulaire"><p>${L("R_PublierAide")}</p><fieldset><legend>${L("Personnages")}</legend>${pcBoxes("pc", run.for === "chosen" ? run.pcs : [])}</fieldset></div>`,
    buttons: [
      {
        action: "all", label: L("R_PublierEquipe"), default: true, callback: () => ({
          for: "all", pcs: []
        })
      },
      {
        action: "chosen", label: L("R_PublierPour"), callback: (event, button) => {
          const pcs = ticked(button.form, "pc")
          return pcs.length ? {
            for: "chosen", pcs
          } : null
        }
      },
    ],
    rejectClose: false,
  })
}

/** The reputation movements typed one line per faction: a name and a delta. */
function factionRows(name, list){
  const factions = registryFactions().sort((a, b) => a.name.localeCompare(b.name))
  if (!factions.length) return `<p class="sr5-nc-note">${L("R_AucuneFactionRegistre")}</p>`
  return factions.map(f => {
    const v = list.find(x => x.factionId === f.id)?.delta ?? 0
    return `<label class="sr5-nc-r-fac">${esc(f.name)}<input type="number" name="${name}-${f.id}" value="${v}" step="1" min="-10" max="10"></label>`
  }).join("")
}
const readFactions = (form, name) => registryFactions().map(f => ({
  factionId: f.id, delta: Number(form.elements[`${name}-${f.id}`]?.value) || 0
})).filter(x => x.delta)

/** The team's contacts offered as fixer or Johnson (the name stays free). */
function teamContacts(){
  const out = []
  for (const a of teamPcs()) for (const i of a.items) if (i.type === "itemContact") out.push({
    uuid: i.uuid, name: i.name
  })
  return out.sort((a, b) => a.name.localeCompare(b.name))
}

/** Gamemaster: a run's form. A journal can be dropped on the Place and Notes fields. */
async function runDialog(r){
  const {
    DialogV2
  } = foundry.applications.api
  const contacts = teamContacts()
  const accesses = listAccesses()
  const content = `
    <div class="sr5-nc-formulaire sr5-nc-r-formulaire">
      <label>${L("F_Titre")}<input type="text" name="title" value="${esc(r.title ?? "")}" required></label>
      <label>${L("F_Texte")}<textarea name="text" rows="3">${esc(r.text ?? "")}</textarea></label>
      <label>${L("R_Qui")}<select name="role">${["fixer", "johnson"].map(x => `<option value="${x}" ${x === (r.role ?? "fixer") ? "selected" : ""}>${L(`R_Role_${x}`)}</option>`).join("")}</select></label>
      <label>${L("Nom")}<input type="text" name="fixer" list="sr5-nc-r-contacts" value="${esc(r.fixer ?? "")}"></label>
      <datalist id="sr5-nc-r-contacts">${contacts.map(c => `<option value="${esc(c.name)}">`).join("")}</datalist>
      <label>${L("R_Paie")}<input type="number" name="pay" min="0" step="500" value="${Number(r.pay) || 0}"></label>
      <label class="case"><input type="checkbox" name="perPerson" ${r.perPerson ? "checked" : ""}> ${L("R_ParPersonne")}</label>
      <label>${L("R_Avance")}<input type="number" name="advance" min="0" max="100" step="5" value="${r.id ? Number(r.advance) || 0 : runAdvanceDefault()}" ${r.payments?.advance ? "disabled" : ""}></label>
      <label>${L("R_KarmaParPj")}<input type="number" name="karma" min="0" step="1" value="${Number(r.karma) || 0}"></label>
      <label>${L("R_Risque")}<input type="number" name="risk" min="0" max="5" value="${Number(r.risk) || 0}"></label>
      <label>${L("R_Etat")}<select name="state">${RUN_STATES.filter(e => e !== "closed" || r.state === "closed").map(e => `<option value="${e}" ${e === (r.state ?? "draft") ? "selected" : ""}>${L(`R_Etat_${e}`)}</option>`).join("")}</select></label>
      <label>${L("F_Reactions")}<textarea name="reactions" rows="2" placeholder="${L("F_ReactionsAide")}">${esc(writeReactions(r.reactions))}</textarea></label>
      <fieldset><legend>${L("R_PrevusTitre")}</legend>${factionRows("planned", r.planned ?? [])}</fieldset>
      <label>${L("R_Lieu")}<input type="text" name="place" value="${esc(r.place ?? "")}" placeholder="${L("GlisserIci")}"></label>
      <label>${L("R_Notes")}<input type="text" name="notes" value="${esc(r.notes ?? "")}" placeholder="${L("GlisserIci")}"></label>
      <label>${L("R_AccesLie")}<select name="access"><option value="">—</option>${accesses.map(a => `<option value="${a.id}" ${a.id === r.access ? "selected" : ""}>${esc(a.name)}</option>`).join("")}</select></label>
      <label>${L("Note")}<input type="text" name="gmNote" value="${esc(r.gmNote ?? "")}"></label>
      <fieldset><legend>${L("R_EquipeTitre")}</legend>${pcBoxes("team", r.team)}</fieldset>
    </div>`
  const data = await DialogV2.prompt({
    classes: DIALOG,
    window: {
      title: r.id ? L("Modifier") : L("R_Ajouter")
    },
    position: {
      width: 560
    },
    content,
    render: (event, dialog) => {
      for (const field of dialog.element.querySelectorAll("input[name='place'], input[name='notes']")){
        field.addEventListener("dragover", ev => ev.preventDefault())
        field.addEventListener("drop", ev => {
          ev.preventDefault()
          const drop = foundry.applications.ux.TextEditor.implementation.getDragEventData(ev)
          if (drop?.uuid) field.value = drop.uuid
        })
      }
    },
    ok: {
      label: L("Enregistrer"),
      callback: (event, button) => {
        const f = button.form.elements
        const fixer = f.fixer.value.trim()
        return {
          title: f.title.value, text: f.text.value, role: f.role.value, fixer,
          fixerUuid: contacts.find(c => c.name === fixer)?.uuid ?? "",
          pay: Number(f.pay.value) || 0, perPerson: f.perPerson.checked, risk: Number(f.risk.value) || 0,
          // An advance already paid no longer changes (its field is greyed)
          advance: r.payments?.advance ? r.advance : Number(f.advance.value) || 0, karma: Number(f.karma.value) || 0,
          state: f.state.value, reactions: readReactions(f.reactions.value), planned: readFactions(button.form, "planned"),
          place: f.place.value.trim(), notes: f.notes.value.trim(), access: f.access.value, gmNote: f.gmNote.value,
          team: ticked(button.form, "team"),
        }
      },
    },
    rejectClose: false,
  })
  if (!data) return true
  const next = await writeRun({
    ...r, ...data, date: r.date || Date.now()
  })
  // Made "active" by the form: the advance goes as by the board's button
  if (next?.state === "active" && r.state !== "active") await advanceDialog(normalizeRun(next))
  return true
}

/* ------------------------------------------------------------------ */
/* Karma and nuyen on the sheets                                       */
/* ------------------------------------------------------------------ */

/** The lines of a payment, one per character: a box (with `boxes`), the Karma and the nuyen, all editable. */
function paymentTable(lines, {
  boxes = false
} = {
}){
  const cls = boxes ? "sr5-nc-r-vers cases" : "sr5-nc-r-vers"
  const head = `<div class="${cls} tete">${boxes ? "<span></span>" : ""}<span></span><span>${L("R_Karma")}</span><span>${L("R_Nuyens")}</span></div>`
  return head + lines.map(l => `<div class="${cls}" data-nc-pc="${l.actorId}">
    ${boxes ? `<input type="checkbox" name="pc-${l.actorId}" ${l.ticked ? "checked" : ""} aria-label="${esc(actorName(l.actorId))}">` : ""}
    <span class="nom">${esc(actorName(l.actorId))}</span>
    <input type="number" name="karma-${l.actorId}" min="0" step="1" value="${l.karma}">
    <input type="number" name="nuyens-${l.actorId}" min="0" step="100" value="${l.nuyens}" ${l.auto ? "data-nc-auto" : ""}>
  </div>`).join("")
}

/** The lines typed (the ticked ones only, when there are boxes); never negative. */
function readPayment(form){
  return [...form.querySelectorAll("[data-nc-pc]")].filter(row => {
    const c = row.querySelector("input[type='checkbox']")
    return !c || c.checked
  }).map(row => {
    const id = row.dataset.ncPc
    return {
      actorId: id, karma: Number(form.elements[`karma-${id}`]?.value) || 0, nuyens: Number(form.elements[`nuyens-${id}`]?.value) || 0
    }
  })
}

/** Some sheet already holds an entry of this run and step (the system's flag, or Landing 1.8.0's). */
const alreadyOnSheets = (runId, step) => game.actors.some(a => a.items.some(i => isPaymentOf(i, runId, step)))

// One payment at a time: a double click does not start two payments of the same run
const paying = new Set()

/**
 * Pays a step ("advance" or "balance") to the sheets, the system's way: itemNuyen and itemKarma gains, which the
 * sheet totals and lists in its history (the gamemaster corrects or deletes a line there). Refused when the step
 * already went, by the run read again just before and by the sheets. Resolves to true once paid.
 */
export async function pay(runId, step, lines){
  if (!game.user.isActiveGM){
    ui.notifications.warn(L("GMOnly"))
    return false
  }
  const key = `${runId}:${step}`
  if (paying.has(key)) return false
  paying.add(key)
  try {
    const run = listRuns().find(r => r.id === runId)
    if (!run) return false
    const clean = cleanLines(lines).filter(l => game.actors.get(l.actorId))
    const refusal = paymentRefusal(run, step, clean, {
      alreadyOnSheets: alreadyOnSheets(runId, step)
    })
    if (refusal === "already"){
      ui.notifications.warn(L("R_DejaVerse", {
        code: run.code, etape: L(`R_Etape_${step}`)
      }))
      return false
    }
    if (refusal){
      ui.notifications.info(L("R_RienAVerser"))
      return false
    }
    const name = L("R_GainNom", {
      code: run.code, titre: run.title, etape: L(`R_EtapeNom_${step}`)
    })
    const entries = paymentEntries({
      lines: clean, run, step, name, day: new Date().toISOString().slice(0, 10)
    })
    const done = []
    for (const e of entries){
      const actor = game.actors.get(e.actorId)
      try {
        await actor.createEmbeddedDocuments("Item", e.items)
        done.push(e.actorId)
      } catch (err){
        console.error("SR5 | run payment", err)
        ui.notifications.error(L("R_VersementEchec", {
          nom: actor.name
        }))
      }
    }
    // The run notes what really went: a sheet that failed is corrected by hand in its history
    const paid = clean.filter(l => done.includes(l.actorId))
    if (!paid.length) return false
    await writeRun(withPayment(run, step, paid, Date.now()))
    ui.notifications.info(L("R_Verse", {
      code: run.code, etape: L(`R_Etape_${step}`), n: paid.length
    }))
    return true
  } finally {
    paying.delete(key)
  }
}

/**
 * Gamemaster: the advance of a run that becomes "active", its percentage of each team member's share, editable line
 * by line. Nothing when the run has none or already paid it (with `asked`, it says so).
 */
async function advanceDialog(r, {
  asked = false
} = {
}){
  r = normalizeRun(r)
  if (!game.user.isActiveGM || !r.advance) return true
  if (r.payments.advance){
    if (asked) ui.notifications.warn(L("R_DejaVerse", {
      code: r.code, etape: L("R_Etape_advance")
    }))
    return true
  }
  const team = r.team.length ? r.team : r.interested
  if (!team.length){
    if (asked) ui.notifications.warn(L("R_PasDEquipe"))
    return true
  }
  const {
    DialogV2
  } = foundry.applications.api
  const lines = await DialogV2.wait({
    classes: DIALOG,
    window: {
      title: L("R_AvanceTitre", {
        code: r.code
      })
    },
    position: {
      width: 460
    },
    content: `<div class="sr5-nc-formulaire sr5-nc-r-formulaire"><p>${L("R_AvanceAide", {
      pct: r.advance, paie: payLabel(r.pay)
    })}</p>
      <div class="sr5-nc-r-versements">${paymentTable(advanceLines(r, team))}</div></div>`,
    buttons: [
      {
        action: "pay", label: L("R_VerserAvance"), default: true, callback: (event, button) => readPayment(button.form)
      },
      {
        action: "later", label: L("R_PlusTard"), callback: () => null
      },
    ],
    rejectClose: false,
  })
  if (lines) await pay(r.id, "advance", lines)
  return true
}

/**
 * Gamemaster: close a run (capture 06 of the mock-up). Outcome; Karma and nuyen of each ticked character (filled
 * in: the run's Karma, the balance of her share when the run succeeded), paid at once or kept on the run;
 * reputation movements (filled in with the planned ones when the run succeeds), pending or applied; the news item
 * when a module offers one (a draft for the gamemaster, or broadcast at once).
 */
async function closeDialog(r){
  const {
    DialogV2
  } = foundry.applications.api
  const team = r.team.length ? r.team : r.interested
  const lines = [
    ...closureLines(r, team, "success").map(l => ({
      ...l, ticked: true, auto: true
    })),
    ...teamPcs().filter(p => !team.includes(p.id)).map(p => ({
      actorId: p.id, karma: r.karma, nuyens: 0, ticked: false
    })),
  ]
  const advance = totalAdvance(r)
  const echo = echoProvider()
  const content = `
    <div class="sr5-nc-formulaire sr5-nc-r-formulaire">
      <fieldset><legend>${L("R_IssueTitre")}</legend>
        ${OUTCOMES.map((o, n) => `<label class="case"><input type="radio" name="outcome" value="${o}" ${n === 0 ? "checked" : ""}> ${L(`R_Issue_${o}`)}</label>`).join("")}
      </fieldset>
      <div class="sr5-nc-r-versements"><div class="titre">${L("R_VersementsTitre")}</div>
        ${advance ? `<p class="sr5-nc-note">${L("R_AvanceVersee", {
    paie: payLabel(advance)
  })}</p>` : ""}
        ${paymentTable(lines, {
    boxes: true
  })}
        <label class="case"><input type="checkbox" name="payNow" checked> ${L("R_VerserMaintenant")}</label>
      </div>
      <fieldset><legend>${L("R_Reputation")}</legend>${factionRows("mv", r.planned)}
        <label class="case"><input type="checkbox" name="pending" checked> ${L("R_EnAttente")}</label>
      </fieldset>
      ${echo ? `<label class="case"><input type="checkbox" name="echo" checked> ${L("R_EcrireEcho")}</label>
      <label>${L("R_EchoTitre")}<input type="text" name="echoTitle" value=""></label>
      <label>${L("F_Texte")}<textarea name="echoText" rows="2"></textarea></label>
      <label class="case"><input type="checkbox" name="echoBroadcast"> ${L("R_EchoDiffuser")}</label>` : ""}
    </div>`
  const data = await DialogV2.prompt({
    classes: DIALOG,
    window: {
      title: L("R_CloreTitre", {
        code: r.code
      })
    },
    position: {
      width: 540
    },
    content,
    render: (event, dialog) => {
      // A failed or abandoned run carries neither the movements planned "if it succeeds" nor a balance
      const form = dialog.element.querySelector("form") ?? dialog.element
      form.querySelectorAll("input[name='outcome']").forEach(radio => radio.addEventListener("change", () => {
        if (!radio.checked) return
        const success = radio.value === "success"
        for (const p of registryFactions()){
          const field = form.querySelector(`input[name='mv-${p.id}']`)
          if (field) field.value = success ? (r.planned.find(x => x.factionId === p.id)?.delta ?? 0) : 0
        }
        for (const l of closureLines(r, team, radio.value)){
          const field = form.querySelector(`input[name='nuyens-${l.actorId}'][data-nc-auto]`)
          if (field) field.value = l.nuyens
        }
      }))
    },
    ok: {
      label: L("R_CloreDiffuser"),
      callback: (event, button) => {
        const f = button.form.elements
        const payment = readPayment(button.form)
        return {
          outcome: button.form.querySelector("input[name='outcome']:checked")?.value ?? "success",
          team: payment.map(l => l.actorId), payment: cleanLines(payment), payNow: f.payNow.checked,
          movements: readFactions(button.form, "mv"), pending: f.pending.checked,
          echo: !!f.echo?.checked, echoTitle: f.echoTitle?.value.trim() ?? "", echoText: f.echoText?.value.trim() ?? "",
          echoBroadcast: !!f.echoBroadcast?.checked,
        }
      },
    },
    rejectClose: false,
  })
  if (!data) return true
  await closeRun(r, data)
  return true
}

async function closeRun(r, d){
  if (!game.user.isActiveGM) return ui.notifications.warn(L("GMOnly"))
  // A balance already paid (a run reopened then closed again by hand) does not go again: said before anything is written
  if (d.payment.length && (r.payments.balance || alreadyOnSheets(r.id, "balance"))){
    return ui.notifications.warn(L("R_DejaVerse", {
      code: r.code, etape: L("R_Etape_balance")
    }))
  }
  // 1. The system's factions registry (the reputation is never counted twice: the news item carries none)
  const registry = game.sr5?.factionRegistry
  const lines = reputationLines({
    movements: d.movements, team: d.team, code: r.code, pending: d.pending,
    time: game.time.worldTime, newId: () => foundry.utils.randomID(),
  })
  if (lines.length){
    if (!registry?.update) return ui.notifications.error(L("R_RegistreAbsent"))
    const ok = await registry.update(data => {
      data.log.push(...lines)
    })
    if (ok === false) return
  }
  // 2. The news item, tied to the run, when a module writes one; the gamemaster's note says what goes to the sheets
  let echo = ""
  const provider = echoProvider()
  if (d.echo && provider){
    const summary = d.movements.map(m => `${factionName(m.factionId)} ${sign(m.delta)}`).join(", ")
    const advance = totalAdvance(r)
    const payment = [
      d.payment.length ? L(d.payNow ? "R_EchoVerse" : "R_EchoAVerser", {
        liste: paymentText(d.payment, actorName)
      }) : L("R_EchoRienVerse"),
      advance ? L("R_EchoAvance", {
        paie: payLabel(advance)
      }) : "",
    ].filter(Boolean).join(" ")
    try {
      echo = await provider.create({
        run: r, title: d.echoTitle || r.title, text: d.echoText, broadcast: d.echoBroadcast,
        gmNote: L("R_EchoNote", {
          reputation: summary || L("R_SansReputation"), equipe: d.team.map(actorName).join(", ") || "—",
          etat: L(d.pending ? "R_EnAttenteCourt" : "R_Appliquee"), versement: payment,
        }),
      }) ?? ""
    } catch (e){
      console.error("SR5 | run news item", e)
    }
  }
  // 3. The run, closed; the balance stays noted on it until it is paid
  const closedPay = totalAdvance(r) + d.payment.reduce((s, l) => s + l.nuyens, 0)
  await writeRun({
    ...r, state: "closed", team: d.team, closure: {
      outcome: d.outcome, pay: closedPay, movements: d.movements, echo, toPay: d.payment, date: Date.now()
    }
  })
  ui.notifications.info(L("R_Clos", {
    code: r.code, n: lines.length
  }))
  // 4. The payment, the system's way (reads again the run just written)
  if (d.payNow && d.payment.length) await pay(r.id, "balance", d.payment)
}
