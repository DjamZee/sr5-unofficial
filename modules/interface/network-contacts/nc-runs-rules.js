/**
 * The runs board of the Network (landing-metroplexes-sr5 1.4.0 to 1.8.0, block 6 of the mock-up validated by DjamZ
 * on 22/10; in the system since 28/10), without Foundry: tested alone (tests/network-runs-rules.test.js). The
 * gamemaster publishes, closes and chooses who sees (the team by default, or chosen characters); each player says
 * "Interested". At closure, the reputation movements go to the system's factions registry; the advance (when the run
 * becomes "active") and the balance (at closure) go to the sheets as Karma and nuyen gains, once each, never twice.
 */

export const RUN_STATES = ["draft", "open", "meeting", "active", "closed"]
export const OUTCOMES = ["success", "failure", "abandoned"]
export const ROLES = ["fixer", "johnson"]
export const PAY_STEPS = ["advance", "balance"]

const text = v => String(v ?? "").trim()
const ids = l => [...new Set((l ?? []).map(String).filter(Boolean))]
const whole = v => Math.max(0, Math.round(Number(v) || 0))

/** The lines of a payment: a character, her nuyen and her Karma, never negative; an empty line is dropped. */
export function cleanLines(lines){
  const seen = new Set()
  const out = []
  for (const l of lines ?? []){
    const actorId = text(l?.actorId)
    if (!actorId || seen.has(actorId)) continue
    const line = {
      actorId, nuyens: whole(l.nuyens), karma: whole(l.karma)
    }
    if (!line.nuyens && !line.karma) continue
    seen.add(actorId)
    out.push(line)
  }
  return out
}

const normalizePayment = p => p ? {
  date: Number(p.date) || 0, lines: cleanLines(p.lines)
} : null
const movements = list => (list ?? []).map(x => ({
  factionId: text(x.factionId), delta: Math.round(Number(x.delta) || 0)
})).filter(x => x.factionId && x.delta)

/** A clean run: the known fields, cleaned; an id and a code are given by the caller. */
export function normalizeRun(r){
  return {
    id: String(r.id ?? ""),
    code: text(r.code),
    title: text(r.title) || "?",
    text: text(r.text),
    // Who offers it: a fixer or a Mr. Johnson; a contact of the team (uuid) or a free name
    role: ROLES.includes(r.role) ? r.role : "fixer",
    fixer: text(r.fixer),
    fixerUuid: text(r.fixerUuid),
    pay: whole(r.pay),
    perPerson: !!r.perPerson,
    // Each character's Karma (SR5 p. 379); the advance, in % of the pay, paid when the run becomes "active"
    karma: whole(r.karma),
    advance: Math.min(100, whole(r.advance)),
    // What already went to the sheets: once each, never twice
    payments: {
      advance: normalizePayment(r.payments?.advance), balance: normalizePayment(r.payments?.balance)
    },
    risk: Math.max(0, Math.min(5, Math.round(Number(r.risk) || 0))),
    // Reactions announced (tags), and the movements planned should the run succeed
    reactions: (r.reactions ?? []).map(x => ({
      faction: text(x.faction), word: text(x.word), tone: ["pos", "neg"].includes(x.tone) ? x.tone : "neutral"
    }))
      .filter(x => x.faction),
    planned: movements(r.planned),
    state: RUN_STATES.includes(r.state) ? r.state : "draft",
    for: r.for === "chosen" ? "chosen" : "all",
    pcs: ids(r.pcs),
    interested: ids(r.interested),
    team: ids(r.team),
    // Links: a place or notes (journal), an access of the Network
    place: text(r.place),
    notes: text(r.notes),
    access: text(r.access),
    gmNote: text(r.gmNote),
    date: Number(r.date) || 0,
    closure: r.closure ? {
      outcome: OUTCOMES.includes(r.closure.outcome) ? r.closure.outcome : "success",
      pay: whole(r.closure.pay),
      movements: movements(r.closure.movements),
      // The news item a module wrote (landing-metroplexes-sr5's feed), by its id
      echo: text(r.closure.echo),
      // The balance kept on the run when the gamemaster did not pay it at once ("Pay" in the archives)
      toPay: cleanLines(r.closure.toPay),
      date: Number(r.closure.date) || 0,
    } : null,
  }
}

/** Adds or replaces a run (by id) in a copy of the list; removes it with `remove`. */
export function withRun(list, run, {
  remove = false
} = {
}){
  const others = (list ?? []).filter(r => r.id !== run.id)
  return remove ? others : [...others, normalizeRun(run)]
}

/** The next code, "JOB-2081-115": the game year, then one more than the highest of that year. */
export function nextCode(list, year){
  const prefix = `JOB-${year}-`
  const max = (list ?? []).map(r => r.code ?? "").filter(c => c.startsWith(prefix))
    .reduce((m, c) => Math.max(m, Number(c.slice(prefix.length)) || 0), 100)
  return `${prefix}${String(max + 1).padStart(3, "0")}`
}

/** A run this viewer sees: published (not a draft) and for the team, or for one of her characters. */
export function runVisible(r, {
  gm = false, mine = new Set()
} = {
}){
  if (gm) return true
  if (r.state === "draft") return false
  if ((r.team ?? []).some(id => mine.has(id))) return true
  return r.for !== "chosen" || (r.pcs ?? []).some(id => mine.has(id))
}

/**
 * The runs seen, on two tabs: "board" (what is not closed; the gamemaster's drafts included) and "archives" (the
 * closed runs). The mock-up's order: active, meeting, open, drafts; the latest first in each state.
 */
export function visibleRuns(list, {
  gm = false, mine = new Set(), tab = "board"
} = {
}){
  const rank = {
    active: 0, meeting: 1, open: 2, draft: 3, closed: 4
  }
  return (list ?? [])
    .filter(r => runVisible(r, {
      gm, mine
    }))
    .filter(r => tab === "archives" ? r.state === "closed" : r.state !== "closed")
    .sort((a, b) => (rank[a.state] - rank[b.state]) || ((b.closure?.date ?? b.date) - (a.closure?.date ?? a.date)))
}

/** "Interested": adds or removes this character; null when the run takes no more interest (draft, closed). */
export function toggleInterest(run, actorId){
  if (!run || !actorId || !["open", "meeting"].includes(run.state)) return null
  const already = (run.interested ?? []).includes(actorId)
  return {
    ...run, interested: already ? run.interested.filter(id => id !== actorId) : [...(run.interested ?? []), actorId]
  }
}

/** The risk as dots, out of five: 2 → "●●○○○". */
export const riskDots = n => "●".repeat(Math.max(0, Math.min(5, n))) + "○".repeat(5 - Math.max(0, Math.min(5, n)))

/** The pay, readable: "8 000 ¥". */
export const payLabel = n => `${String(Math.round(Number(n) || 0)).replace(/\B(?=(\d{3})+(?!\d))/g, " ")} ¥`

/** The reactions typed one per line: "+ Ancients : pleased", "- Lone Star", "Yakuza : watching". */
export function readReactions(block){
  return String(block ?? "").split(/\r?\n/).map(l => l.trim()).filter(Boolean).map(l => {
    let tone = "neutral"
    if (/^[+]/.test(l)) tone = "pos"
    else if (/^[-−]/.test(l)) tone = "neg"
    const rest = l.replace(/^[+\-−]\s*/, "")
    const i = rest.indexOf(":")
    return i > 0 ? {
      faction: rest.slice(0, i).trim(), word: rest.slice(i + 1).trim(), tone
    } : {
      faction: rest, word: "", tone
    }
  }).filter(r => r.faction)
}
export const writeReactions = reactions => (reactions ?? [])
  .map(r => `${r.tone === "pos" ? "+ " : r.tone === "neg" ? "- " : ""}${r.faction}${r.word ? ` : ${r.word}` : ""}`).join("\n")

/**
 * The lines of the factions log the closure writes: one movement per faction and per character of the team (reason
 * "custom", note = the run's code), pending or applied as the gamemaster chooses. Shape of the system's movements
 * (factions-app.js): {id, factionId, actorId, reason, delta, pending, time, note}.
 */
export function reputationLines({
  movements = [], team = [], code = "", pending = true, time = 0, newId = () => ""
}){
  const out = []
  for (const m of movements){
    if (!m.factionId || !m.delta) continue
    for (const actorId of team) out.push({
      id: newId(), factionId: m.factionId, actorId, reason: "custom", delta: m.delta, pending, time, note: code
    })
  }
  return out
}

/* Karma and nuyen paid to the sheets (landing-metroplexes-sr5 1.8.0, DjamZ's request of 25/10) */

/**
 * Each team member's share of the pay: the pay itself when it is "per person" (the book counts it so, SR5 p. 377),
 * otherwise the group's pay shared, the rest of an uneven share to the first ones.
 */
export function payShares(pay, perPerson, n){
  const p = whole(pay)
  if (n <= 0) return []
  if (perPerson) return Array(n).fill(p)
  const base = Math.floor(p / n)
  return Array.from({
    length: n
  }, (_, i) => base + (i < p - base * n ? 1 : 0))
}

/** What the advance already paid this character (0 when it did not go). */
export const advancePaid = (run, actorId) => run?.payments?.advance?.lines.find(l => l.actorId === actorId)?.nuyens ?? 0
export const totalAdvance = run => (run?.payments?.advance?.lines ?? []).reduce((s, l) => s + l.nuyens, 0)

/** The advance offered to each character: its percentage of her share, rounded down. */
export function advanceLines(run, team){
  const shares = payShares(run.pay, run.perPerson, team.length)
  return team.map((actorId, i) => ({
    actorId, nuyens: Math.floor(shares[i] * (run.advance ?? 0) / 100), karma: 0
  }))
}

/**
 * The closure's lines, filled in: the run's Karma for each ("for better or worse", SR5 p. 379) and, when the run
 * succeeded, the balance of her share (share minus the advance already paid, never negative). A failed or abandoned
 * run keeps the advance and offers no balance; the gamemaster corrects each line.
 */
export function closureLines(run, team, outcome = "success"){
  const shares = payShares(run.pay, run.perPerson, team.length)
  return team.map((actorId, i) => ({
    actorId, karma: whole(run.karma),
    nuyens: outcome === "success" ? Math.max(0, shares[i] - advancePaid(run, actorId)) : 0,
  }))
}

/**
 * Why a payment is refused, or null: "already" when this step already went (on the run, or on a sheet that already
 * holds an entry of this run and step), "empty" when there is nothing to pay.
 */
export function paymentRefusal(run, step, lines, {
  alreadyOnSheets = false
} = {
}){
  if (!PAY_STEPS.includes(step)) return "step"
  if (run?.payments?.[step] || alreadyOnSheets) return "already"
  if (!cleanLines(lines).length) return "empty"
  return null
}

/** The run after a payment: the step noted with its lines; null when refused. */
export function withPayment(run, step, lines, date = 0){
  if (paymentRefusal(run, step, lines)) return null
  const next = {
    ...run, payments: {
      ...(run.payments ?? {
      }), [step]: {
        date, lines: cleanLines(lines)
      }
    }
  }
  if (step === "balance" && run.closure) next.closure = {
    ...run.closure, toPay: []
  }
  return next
}

/**
 * True when an item is a Karma or nuyen gain of this run and step: the system's flag (sr5.ncRun), or the one Landing
 * 1.8.0 put before the runs came to the system (landing-metroplexes-sr5 {run, etape: "avance" | "solde"}). The second
 * guard against a double payment, and the one a migrated world relies on.
 */
export function isPaymentOf(item, runId, step){
  if (!["itemKarma", "itemNuyen"].includes(item?.type)) return false
  const mine = item.flags?.sr5?.ncRun
  if (mine?.run === runId && mine?.step === step) return true
  const old = item.flags?.["landing-metroplexes-sr5"]
  return old?.run === runId && old?.etape === {
    advance: "avance", balance: "solde"
  }[step]
}

/**
 * The system's entries for a payment, per character: an itemNuyen gain and an itemKarma gain, like those the sheet
 * writes by hand (the actor's Karma and nuyen history, the gamemaster may correct them). Their flag is the second
 * guard against a double payment.
 */
export function paymentEntries({
  lines, run, step, name, day = ""
}){
  const flags = {
    sr5: {
      ncRun: {
        run: run.id, step
      }
    }
  }
  return cleanLines(lines).map(l => ({
    actorId: l.actorId,
    items: [
      l.nuyens ? {
        name, type: "itemNuyen", img: "systems/sr5/assets/img/items/itemNuyen.svg", flags,
        system: {
          amount: l.nuyens, type: "gain", date: day, description: ""
        }
      } : null,
      l.karma ? {
        name, type: "itemKarma", img: "systems/sr5/assets/img/items/itemKarma.svg", flags,
        system: {
          amount: l.karma, type: "gain", date: day, description: ""
        }
      } : null,
    ].filter(Boolean),
  }))
}

/** "Ava 6 000 ¥, 5 Karma ; Bob 6 000 ¥": a payment's lines in plain words. */
export function paymentText(lines, nameOf = id => id){
  return cleanLines(lines).map(l => `${nameOf(l.actorId)} ${[l.nuyens ? payLabel(l.nuyens) : "",
    l.karma ? `${l.karma} Karma` : ""].filter(Boolean).join(", ")}`).join(" ; ")
}

/* ------------------------------------------------------------------ */
/* Migration from landing-metroplexes-sr5 (1.4.0 to 1.8.0)             */
/* ------------------------------------------------------------------ */

const LANDING_STATES = {
  brouillon: "draft", ouvert: "open", rendezvous: "meeting", encours: "active", clos: "closed"
}
const LANDING_OUTCOMES = {
  reussi: "success", rate: "failure", abandonne: "abandoned"
}
const paymentFromLanding = v => v ? {
  date: v.date, lines: v.lignes
} : null

/** A Landing run (French fields, versements.avance / solde) in the system's shape, its payments kept to the line. */
export function runFromLanding(r){
  return normalizeRun({
    id: r?.id, code: r?.code, title: r?.titre, text: r?.texte, role: r?.role, fixer: r?.fixer, fixerUuid: r?.fixerUuid,
    pay: r?.paie, perPerson: r?.parPersonne, karma: r?.karma, advance: r?.avance,
    payments: {
      advance: paymentFromLanding(r?.versements?.avance), balance: paymentFromLanding(r?.versements?.solde)
    },
    risk: r?.risque, reactions: (r?.reactions ?? []).map(x => ({
      faction: x.faction, word: x.mot, tone: x.ton
    })),
    planned: r?.prevus, state: LANDING_STATES[r?.etat] ?? "draft", for: r?.pour === "choisir" ? "chosen" : "all",
    pcs: r?.pj, interested: r?.interesses, team: r?.equipe, place: r?.lieu, notes: r?.notes, access: r?.acces,
    gmNote: r?.noteMj, date: r?.date,
    closure: r?.cloture ? {
      outcome: LANDING_OUTCOMES[r.cloture.issue] ?? "success", pay: r.cloture.paie, movements: r.cloture.mouvements,
      echo: r.cloture.echo, toPay: r.cloture.aVerser, date: r.cloture.date,
    } : null,
  })
}

/**
 * Landing's runs added to the system's, by id: a run already in the system is kept as it is (its payments are the
 * system's), Landing's others come with their payments.
 */
export function mergeLandingRuns(landingList, systemList){
  const seen = new Set((systemList ?? []).map(r => r.id))
  return [...(systemList ?? []), ...(landingList ?? []).map(runFromLanding).filter(r => r.id && !seen.has(r.id))]
}
