import {
  describe, it, expect
} from "vitest"
import {
  acceptRefusal, accountRefusal, bothAccepted, changed, cleanQuantity, cleanSum, fundsMismatch, newTrade, partnerEntries, partyName, tradeCardHtml, offerLine
} from "../modules/interface/trade-rules.js"

describe("who the list \"With\" proposes", () => {
  const actor = (id, name) => ({
    id, name, uuid: `Actor.${id}`
  })
  const unlinked = (base, tokenId, name = base.name) => ({
    actorId: base.id, actorLink: false, name, actor: {
      id: base.id, name: base.name, uuid: `Scene.s.Token.${tokenId}.Actor.${base.id}`
    }
  })
  const list = p => partnerEntries({
    characters: [], tokens: [], actors: [], canTrade: () => true, ...p
  })
  const guard = actor("g", "Garde"), wren = actor("w", "Wren")

  it("gives an unlinked token once: its body, not also the actor it was made from", () => {
    const token = unlinked(guard, "t1")
    expect(list({
      tokens: [token], actors: [guard]
    })).toEqual([{
      uuid: token.actor.uuid, name: "Garde"
    }])
  })

  it("keeps the base actor when no token shown stands for it", () => {
    expect(list({
      actors: [guard]
    })).toEqual([{
      uuid: "Actor.g", name: "Garde"
    }])
  })

  it("tells apart two bodies of one name", () => {
    expect(list({
      tokens: [unlinked(guard, "t1"), unlinked(guard, "t2")], actors: [guard]
    }).map(e => e.name)).toEqual(["Garde (1)", "Garde (2)"])
  })

  it("keeps a player's character itself, even with an unlinked token", () => {
    expect(list({
      characters: [wren], tokens: [unlinked(wren, "t1")], actors: [wren]
    })).toEqual([{
      uuid: "Actor.w", name: "Wren"
    }])
  })

  it("does not fall back on the base actor when its only token is the one trading", () => {
    const token = unlinked(guard, "t1")
    expect(list({
      tokens: [token], actors: [guard], exclude: token.actor
    })).toEqual([])
  })

  it("does not reveal the base actor of a token hidden from this browser", () => {
    expect(list({
      tokens: [unlinked(guard, "t1")], actors: [guard], canSee: () => false
    })).toEqual([])
  })

  it("keeps the number on the window, and nothing else a client would write", () => {
    expect(partyName("Garde", "Garde (2)")).toBe("Garde (2)")
    expect(partyName("Garde", undefined)).toBe("Garde")
    expect(partyName("Garde", "Autre (2)")).toBe("Garde")
    expect(partyName("Garde", "Garde (2) le voleur")).toBe("Garde")
  })

  it("leaves out the one trading, and what cannot trade", () => {
    expect(list({
      characters: [wren], actors: [wren, guard], exclude: wren, canTrade: a => a.id !== "nope"
    }).map(e => e.uuid)).toEqual(["Actor.g"])
    expect(list({
      actors: [guard], canTrade: () => false
    })).toEqual([])
  })
})

const trade = () => newTrade({
  id: "t", now: 1, a: {
    actor: "A", name: "A", users: ["u1"]
  }, b: {
    actor: "B", name: "B", users: ["u2"]
  }
})

describe("the chat card", () => {
  it("wears the header of the system's cards, no bare heading, and its body is not folded", () => {
    const html = tradeCardHtml("Échange", "<p>x</p>")
    expect(html).toContain('<header class="SR-CardHeader sr-trade-card-header">')
    expect(html).toContain('<div class="sr-trade-card-content"><p>x</p></div>')
    expect(html).not.toContain("<h3>")
  })
})

describe("an offer", () => {
  it("starts open, empty, agreed by nobody, on the accounts", () => {
    expect(trade()).toMatchObject({
      version: 1, state: "open", cash: false, a: {
        items: [], nuyen: 0, accepted: false
      }, b: {
        items: [], nuyen: 0, accepted: false
      }
    })
  })

  it("a change takes both acceptances back and moves the version on", () => {
    const t = trade()
    t.a.accepted = true
    t.b.accepted = true
    expect(bothAccepted(t)).toBe(true)
    changed(t)
    expect(t.version).toBe(2)
    expect(t.a.accepted).toBe(false)
    expect(t.b.accepted).toBe(false)
    expect(bothAccepted(t)).toBe(false)
  })

  it("an Accept counts only for the version it read, on an offer still open", () => {
    const t = trade()
    expect(acceptRefusal(t, 1)).toBe(null)
    changed(t)
    expect(acceptRefusal(t, 1)).toBe("changed")
    expect(acceptRefusal(t, 2)).toBe(null)
    t.state = "running"
    expect(acceptRefusal(t, 2)).toBe("closed")
    expect(acceptRefusal(undefined, 2)).toBe("closed")
  })
})

describe("what can be offered", () => {
  it("a sum is a whole number, at least 0: no negative sum takes money from the other", () => {
    expect(cleanSum("150.9")).toBe(150)
    expect(cleanSum(-500)).toBe(0)
    expect(cleanSum("abc")).toBe(0)
    expect(cleanSum(Infinity)).toBe(0)
  })

  it("a quantity stays within the pile", () => {
    expect(cleanQuantity(5, 3)).toBe(3)
    expect(cleanQuantity(0, 3)).toBe(1)
    expect(cleanQuantity(-2, 3)).toBe(1)
    expect(cleanQuantity("x", 3)).toBe(1)
    expect(cleanQuantity(2, 1)).toBe(1)
  })

  it("the line of a credstick shows what it holds", () => {
    expect(offerLine({
      id: "s", name: "Tube", img: "i", system: {
        isCredstick: true, quantity: 2
      }
    }, 1, 500)).toEqual({
      id: "s", name: "Tube", img: "i", quantity: 1, max: 2, isStick: true, funds: 500
    })
  })

  it("a stick whose balance is not what the offer showed is refused, in both directions", () => {
    const line = {
      isStick: true, funds: 500
    }
    expect(fundsMismatch(line, 500)).toBe(false)
    expect(fundsMismatch(line, 700)).toBe(true)
    expect(fundsMismatch(line, 0)).toBe(true)
    expect(fundsMismatch({
      isStick: false, funds: 0
    }, 0)).toBe(false)
  })
})

describe("paying on the accounts", () => {
  const base = {
    nuyen: 100, cash: false, payerHasAccounts: true, payeeHasAccounts: true, balance: 100
  }
  it("goes when the accounts hold it", () => {
    expect(accountRefusal(base)).toBe(null)
  })
  it("no sum, or in cash: not the accounts' business", () => {
    expect(accountRefusal({
      ...base, nuyen: 0, balance: 0
    })).toBe(null)
    expect(accountRefusal({
      ...base, cash: true, balance: 0, payerHasAccounts: false
    })).toBe(null)
  })
  it("refuses more than the accounts hold, and a side with no accounts", () => {
    expect(accountRefusal({
      ...base, balance: 99
    })).toBe("accountShort")
    expect(accountRefusal({
      ...base, payerHasAccounts: false
    })).toBe("noAccounts")
    expect(accountRefusal({
      ...base, payeeHasAccounts: false
    })).toBe("noAccounts")
  })
})
