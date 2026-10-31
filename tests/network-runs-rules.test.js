import {
  describe, it, expect
} from 'vitest'
import {
  normalizeRun, withRun, nextCode, visibleRuns, toggleInterest, payShares, advanceLines, closureLines, paymentRefusal,
  withPayment, paymentEntries, isPaymentOf, readReactions, writeReactions, reputationLines, runFromLanding, mergeLandingRuns
} from '../modules/interface/network-contacts/nc-runs-rules.js'

// The runs board, taken out of landing-metroplexes-sr5 1.8.0 (its tests/runs.test.js carried over). Karma for each
// character, SR5 p. 379; the pay and no advance by the book, SR5 p. 377
const landingRun = {
  id: "run1", code: "JOB-2081-101", titre: "Extraction", paie: 12000, parPersonne: false, karma: 5, avance: 25,
  etat: "clos", equipe: ["a", "b"], interesses: ["a", "b"], prevus: [{
    factionId: "f", delta: 2
  }],
  reactions: [{
    faction: "Ancients", mot: "ravis", ton: "pos"
  }],
  versements: {
    avance: {
      date: 10, lignes: [{
        actorId: "a", nuyens: 1500, karma: 0
      }, {
        actorId: "b", nuyens: 1500, karma: 0
      }]
    },
    solde: {
      date: 20, lignes: [{
        actorId: "a", nuyens: 4500, karma: 5
      }, {
        actorId: "b", nuyens: 4500, karma: 5
      }]
    },
  },
  cloture: {
    issue: "reussi", paie: 12000, mouvements: [{
      factionId: "f", delta: 2
    }], echo: "fil9", aVerser: [], date: 21
  },
}

describe('migration of Landing\'s runs: a payment never goes twice', () => {
  const run = runFromLanding(landingRun)

  it('keeps the advance and the balance already paid, to the line', () => {
    expect(run.payments.advance).toEqual({
      date: 10, lines: [{
        actorId: "a", nuyens: 1500, karma: 0
      }, {
        actorId: "b", nuyens: 1500, karma: 0
      }]
    })
    expect(run.payments.balance.lines).toHaveLength(2)
    expect(run).toMatchObject({
      id: "run1", code: "JOB-2081-101", title: "Extraction", pay: 12000, state: "closed", team: ["a", "b"]
    })
    expect(run.closure).toMatchObject({
      outcome: "success", echo: "fil9", toPay: []
    })
    expect(run.reactions).toEqual([{
      faction: "Ancients", word: "ravis", tone: "pos"
    }])
  })

  it('refuses the advance and the balance of a migrated run', () => {
    expect(paymentRefusal(run, "advance", [{
      actorId: "a", nuyens: 100
    }])).toBe("already")
    expect(paymentRefusal(run, "balance", [{
      actorId: "a", nuyens: 100
    }])).toBe("already")
    expect(withPayment(run, "balance", [{
      actorId: "a", nuyens: 100
    }])).toBe(null)
  })

  it('recognizes the entries Landing put on the sheets, even when the register lost the payment', () => {
    const bare = runFromLanding({
      ...landingRun, versements: {
      }
    })
    expect(paymentRefusal(bare, "advance", [{
      actorId: "a", nuyens: 100
    }])).toBe(null)
    const landingItem = {
      type: "itemNuyen", flags: {
        "landing-metroplexes-sr5": {
          run: "run1", etape: "avance"
        }
      }
    }
    const systemItem = {
      type: "itemKarma", flags: {
        sr5: {
          ncRun: {
            run: "run1", step: "balance"
          }
        }
      }
    }
    expect(isPaymentOf(landingItem, "run1", "advance")).toBe(true)
    expect(isPaymentOf(landingItem, "run1", "balance")).toBe(false)
    expect(isPaymentOf(systemItem, "run1", "balance")).toBe(true)
    expect(isPaymentOf({
      type: "itemGear", flags: landingItem.flags
    }, "run1", "advance")).toBe(false)
    expect(paymentRefusal(bare, "advance", [{
      actorId: "a", nuyens: 100
    }], {
      alreadyOnSheets: true
    })).toBe("already")
  })

  it('merging adds Landing\'s runs once, and keeps a run the system already holds', () => {
    const once = mergeLandingRuns([landingRun, {
      id: "run2", titre: "Draft", etat: "brouillon"
    }], [])
    expect(once.map(r => r.id)).toEqual(["run1", "run2"])
    expect(mergeLandingRuns([landingRun], once)).toEqual(once)
    const paidBySystem = [{
      ...normalizeRun({
        id: "run3", title: "S"
      }), payments: {
        advance: {
          date: 1, lines: [{
            actorId: "a", nuyens: 9, karma: 0
          }]
        }, balance: null
      }
    }]
    expect(mergeLandingRuns([{
      id: "run3", titre: "S (Landing)", versements: {
      }
    }], paidBySystem)[0].payments.advance.lines[0].nuyens).toBe(9)
  })
})

describe('payments', () => {
  const run = normalizeRun({
    id: "r", pay: 10001, karma: 4, advance: 20, team: ["a", "b"]
  })
  it('shares the group\'s pay, the rest to the first; per person, the pay itself', () => {
    expect(payShares(10001, false, 2)).toEqual([5001, 5000])
    expect(payShares(3000, true, 3)).toEqual([3000, 3000, 3000])
    expect(advanceLines(run, ["a", "b"])).toEqual([{
      actorId: "a", nuyens: 1000, karma: 0
    }, {
      actorId: "b", nuyens: 1000, karma: 0
    }])
  })
  it('the balance is the share minus the advance; a failed run pays Karma only', () => {
    const paid = withPayment(run, "advance", advanceLines(run, ["a", "b"]), 5)
    expect(closureLines(paid, ["a", "b"])).toEqual([{
      actorId: "a", karma: 4, nuyens: 4001
    }, {
      actorId: "b", karma: 4, nuyens: 4000
    }])
    expect(closureLines(paid, ["a"], "failure")).toEqual([{
      actorId: "a", karma: 4, nuyens: 0
    }])
  })
  it('a payment goes once; the balance empties what was kept to pay', () => {
    const closed = normalizeRun({
      ...run, state: "closed", closure: {
        toPay: [{
          actorId: "a", nuyens: 5
        }]
      }
    })
    const paid = withPayment(closed, "balance", [{
      actorId: "a", nuyens: 5
    }], 9)
    expect(paid.closure.toPay).toEqual([])
    expect(paymentRefusal(paid, "balance", [{
      actorId: "a", nuyens: 5
    }])).toBe("already")
    expect(paymentRefusal(run, "advance", [{
      actorId: "a"
    }])).toBe("empty")
  })
  it('the sheets\' entries carry the system\'s flag', () => {
    const [e] = paymentEntries({
      lines: [{
        actorId: "a", nuyens: 100, karma: 2
      }], run, step: "advance", name: "x"
    })
    expect(e.items.map(i => i.type)).toEqual(["itemNuyen", "itemKarma"])
    expect(e.items.every(i => isPaymentOf(i, "r", "advance"))).toBe(true)
  })
})

describe('the board', () => {
  it('codes, visibility, interest', () => {
    expect(nextCode([{
      code: "JOB-2081-114"
    }, {
      code: "JOB-2080-300"
    }], 2081)).toBe("JOB-2081-115")
    const list = [
      normalizeRun({
        id: "d", state: "draft"
      }), normalizeRun({
        id: "o", state: "open"
      }),
      normalizeRun({
        id: "c", state: "open", for: "chosen", pcs: ["z"]
      }), normalizeRun({
        id: "x", state: "closed"
      }),
    ]
    expect(visibleRuns(list, {
      mine: new Set(["a"])
    }).map(r => r.id)).toEqual(["o"])
    expect(visibleRuns(list, {
      gm: true
    }).map(r => r.id)).toEqual(["o", "c", "d"])
    expect(visibleRuns(list, {
      mine: new Set(["a"]), tab: "archives"
    }).map(r => r.id)).toEqual(["x"])
    expect(toggleInterest(list[1], "a").interested).toEqual(["a"])
    expect(toggleInterest(list[0], "a")).toBe(null)
    expect(withRun(list, {
      id: "o"
    }, {
      remove: true
    })).toHaveLength(3)
  })
  it('reactions and reputation lines', () => {
    const r = readReactions("+ Ancients : ravis\n- Lone Star\nYakuza : aux aguets")
    expect(r.map(x => x.tone)).toEqual(["pos", "neg", "neutral"])
    expect(readReactions(writeReactions(r))).toEqual(r)
    expect(reputationLines({
      movements: [{
        factionId: "f", delta: -2
      }], team: ["a", "b"], code: "J"
    })).toHaveLength(2)
  })

  // Hermine#5127 (A2): a run without pay, closed, reopened, closed again wrote its reputation twice
  describe("a run closed again", () => {
    const close = (log, movements = [{
      factionId: "f", delta: 2
    }], team = ["a"]) => reputationLines({
      movements, team, code: "J", pending: true, time: 1, log
    })
    const first = close([])

    it("writes nothing more for the same movement", () => {
      expect(first).toHaveLength(1)
      expect(close(first)).toEqual([])
    })

    it("writes only the difference of a changed movement, and the whole of a new member's", () => {
      expect(close(first, [{
        factionId: "f", delta: 3
      }]).map(l => l.delta)).toEqual([1])
      expect(close(first, [{
        factionId: "f", delta: 2
      }], ["a", "b"]).map(l => [l.actorId, l.delta])).toEqual([["b", 2]])
    })

    it("does not count the lines of another run, nor a spending", () => {
      expect(close([{
        ...first[0], note: "K"
      }])).toHaveLength(1)
      expect(close([{
        ...first[0], reason: "spend:x"
      }])).toHaveLength(1)
    })

    it("counts a movement given twice on one faction as its sum", () => {
      const two = [{
        factionId: "f", delta: 2
      }, {
        factionId: "f", delta: 1
      }]
      const lines = close([], two)
      expect(lines).toHaveLength(2)
      expect(close(lines, two)).toEqual([])
    })
  })
})
