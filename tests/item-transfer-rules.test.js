import {
  describe, it, expect
} from "vitest"
import {
  bundleOf, bundleRefusal, isPhysical, mergeStickWrites, movesRatherThanCopies, orderSteps, planCash, planObject, runSteps, sanitizeArrival, tradeRefusal, transferRefusal, hasMark, withMark, strandLineKey
} from "../modules/interface/item-transfer-rules.js"

describe("the lines of the interrupted move's card", () => {
  it("speaks of money only when there is some", () => {
    expect(strandLineKey({
      kind: "money", amount: 500 
    })).toBe("SR5.TransferStrandMoney")
    expect(strandLineKey({
      name: "Stick", funds: 500 
    })).toBe("SR5.TransferStrandObject")
    expect(strandLineKey({
      name: "Balles" 
    })).toBe("SR5.TransferStrandObjectPlain")
    expect(strandLineKey({
      name: "Balles", funds: 0 
    })).toBe("SR5.TransferStrandObjectPlain")
    expect(strandLineKey({
      name: "Stick", funds: 500 
    }, true)).toBe("SR5.TransferStrandKept")
    expect(strandLineKey({
      name: "Balles", funds: 0 
    }, true)).toBe("SR5.TransferStrandKeptPlain")
  })
})

// A world in memory: every write can be made to fail, or to cut the list short as a page reloaded would
function world(actors) {
  const state = structuredClone(actors)
  let writes = 0
  let failAt = Infinity
  const write = () => {
    if (writes++ === failAt) throw new Error("server refused")
  }
  const get = (path, source) => path.split(".").reduce((o, k) => o?.[k], source)
  const set = (path, value, target) => {
    const keys = path.split(".")
    const last = keys.pop()
    keys.reduce((o, k) => (o[k] ??= {
    }), target)[last] = value
  }
  return {
    state,
    get writes() {
      return writes
    },
    failOn(n) {
      failAt = n
      writes = 0
    },
    has: (actor, id) => !!state[actor][id],
    read: (actor, id, path) => get(path, state[actor][id]),
    async create(actor, data) {
      write()
      state[actor][data._id] = structuredClone(data)
    },
    async update(actor, id, changes) {
      write()
      for (const [path, value] of Object.entries(changes)) set(path, value, state[actor][id])
    },
    async remove(actor, id) {
      write()
      delete state[actor][id]
    },
  }
}

const stick = (id, value, quantity = 1, max = 5000) => ({
  _id: id, id, name: "Créditube", type: "itemGear",
  system: {
    isCredstick: true, quantity, storedIn: "", funds: {
      value, max
    }
  },
})

const asItem = source => ({
  ...source, toObject: () => structuredClone(source)
})
const itemsOf = (w, actor) => Object.values(w.state[actor]).map(asItem)

// All the money of a world: on the sticks and on the accounts
const money = w => Object.values(w.state).flatMap(a => Object.values(a)).reduce((sum, i) => {
  if (i.system?.isCredstick) return sum + i.system.funds.value
  if (i.type === "itemNuyen") return sum + (i.system.type === "gain" ? i.system.amount : -i.system.amount)
  return sum
}, 0)

let counter = 0
const newId = () => `new${++counter}`

function plan(w, id, quantity, from = "a", to = "b") {
  const fromItems = itemsOf(w, from)
  const toItems = itemsOf(w, to)
  return planObject({
    item: fromItems.find(i => i.id === id), quantity, from, to, fromItems, toItems,
    takenIds: new Set(toItems.map(i => i.id)), newId,
  }).steps
}

describe("what moves", () => {
  it("is what one can hand over; the rest stays a copy", () => {
    expect(movesRatherThanCopies({
      type: "itemGear", system: {
      }
    })).toBe(true)
    expect(movesRatherThanCopies({
      type: "itemStorage", system: {
      }
    })).toBe(true)
    expect(movesRatherThanCopies({
      type: "itemQuality", system: {
      }
    })).toBe(false)
    expect(movesRatherThanCopies({
      type: "itemSpell", system: {
      }
    })).toBe(false)
    expect(movesRatherThanCopies({
      type: "itemWeapon", system: {
        type: "unarmedCombat"
      }
    })).toBe(false)
  })

  it("refuses an implant in place, a fitted accessory, a deployed vehicle, a locked bag's content", () => {
    expect(transferRefusal({
      type: "itemAugmentation", system: {
        isActive: true
      }
    })).toBe("implant")
    expect(transferRefusal({
      type: "itemAugmentation", system: {
        isActive: false
      }
    })).toBe(null)
    expect(transferRefusal({
      type: "itemGear", system: {
        isAccessory: true, isPlugged: true
      }
    })).toBe("plugged")
    expect(transferRefusal({
      type: "itemVehicle", system: {
        isCreated: true
      }
    })).toBe("deployed")
    expect(transferRefusal({
      type: "itemStorage", system: {
        type: "shop"
      }
    })).toBe("fixture")
    const bag = {
      id: "bag", type: "itemStorage", system: {
        lock: {
          type: "mechanical", locked: true
        }
      }
    }
    expect(transferRefusal({
      type: "itemGear", system: {
        storedIn: "bag"
      }, parent: {
        items: [bag]
      }
    })).toBe("locked")
  })

  it("does not take a bag with something in it in a trade: what it holds would not show", () => {
    const bag = {
      id: "bag", type: "itemStorage", system: {
        type: "other"
      }
    }
    const held = {
      id: "k", type: "itemGear", system: {
        storedIn: "bag"
      }
    }
    expect(tradeRefusal(bag, [bag, held])).toBe("bagNotEmpty")
    expect(tradeRefusal(bag, [bag])).toBe(null)
    expect(tradeRefusal({
      type: "itemQuality", system: {
      }
    })).toBe("notAnObject")
  })

  it("takes along what a host carries and what a bag holds", () => {
    const scope = {
      id: "s", type: "itemGear", system: {
      }
    }
    const rifle = {
      id: "r", type: "itemWeapon", system: {
        accessory: [{
          _id: "s"
        }, {
          name: "printed", slot: "top"
        }]
      }
    }
    const bag = {
      id: "b", type: "itemStorage", system: {
      }
    }
    const inBag = {
      id: "i", type: "itemWeapon", system: {
        storedIn: "b", accessory: [{
          _id: "s"
        }]
      }
    }
    expect(bundleOf(rifle, [rifle, scope]).map(i => i.id)).toEqual(["r", "s"])
    expect(bundleOf(bag, [bag, inBag, scope]).map(i => i.id)).toEqual(["b", "i", "s"])
  })
})

describe("moving an object", () => {
  it("takes the stick and its money off one sheet and onto the other", async () => {
    const w = world({
      a: {
        s: stick("s", 3000)
      }, b: {
      }
    })
    const before = money(w)
    expect((await runSteps(plan(w, "s", 1), w)).ok).toBe(true)
    expect(w.state.a.s).toBeUndefined()
    expect(w.state.b.s.system.funds.value).toBe(3000)
    expect(money(w)).toBe(before)
  })

  it("shares the balance of a pile between the tubes that leave and those that stay", async () => {
    const w = world({
      a: {
        s: stick("s", 1001, 3)
      }, b: {
      }
    })
    const before = money(w)
    await runSteps(plan(w, "s", 1), w)
    expect(w.state.a.s.system.quantity).toBe(2)
    expect(w.state.a.s.system.funds.value + Object.values(w.state.b)[0].system.funds.value).toBe(before)
    expect(money(w)).toBe(before)
  })

  it("adds rounds to the receiver's identical pile", async () => {
    const ammo = (id, quantity) => ({
      _id: id, id, name: "Balles", type: "itemAmmunition", system: {
        quantity, storedIn: ""
      }
    })
    const w = world({
      a: {
        x: ammo("x", 50)
      }, b: {
        y: ammo("y", 10)
      }
    })
    await runSteps(plan(w, "x", 20), w)
    expect(w.state.a.x.system.quantity).toBe(30)
    expect(w.state.b.y.system.quantity).toBe(30)
    expect(Object.keys(w.state.b)).toEqual(["y"])
  })

  it("never merges a loaded stick into a pile: its balance would be lost in the count", async () => {
    const w = world({
      a: {
        s: stick("s", 100)
      }, b: {
        t: stick("t", 0)
      }
    })
    await runSteps(plan(w, "s", 1), w)
    expect(Object.keys(w.state.b).sort()).toEqual(["s", "t"])
    expect(money(w)).toBe(100)
  })

  it("gives the object a new id when the receiver holds that id, and its contents follow", async () => {
    const bag = {
      _id: "b", id: "b", name: "Sac", type: "itemStorage", system: {
      }
    }
    const held = {
      _id: "k", id: "k", name: "Couteau", type: "itemWeapon", system: {
        storedIn: "b"
      }
    }
    const w = world({
      a: {
        b: bag, k: held
      }, b: {
        b: {
          _id: "b", id: "b", name: "Autre", type: "itemGear", system: {
          }
        }
      }
    })
    await runSteps(plan(w, "b", 1), w)
    const arrived = Object.values(w.state.b).find(i => i.name === "Sac")
    expect(arrived._id).not.toBe("b")
    expect(w.state.b.k.system.storedIn).toBe(arrived._id)
    expect(Object.keys(w.state.a)).toEqual([])
  })

  it("an implant set aside stays set aside: the sheet's rule for a drop would install it", async () => {
    const implant = {
      _id: "i", id: "i", name: "Oeil", type: "itemAugmentation", system: {
        isActive: false
      }
    }
    const w = world({
      a: {
        i: implant
      }, b: {
      }
    })
    const fromItems = itemsOf(w, "a")
    const {
      steps
    } = planObject({
      item: fromItems[0], quantity: 1, from: "a", to: "b", fromItems, toItems: [], takenIds: new Set(), newId,
      arrive: data => {
        data.system.isActive = true
        return data
      },
    })
    await runSteps(steps, w)
    expect(w.state.b.i.system.isActive).toBe(false)
  })

  it("a sheet that refuses the object leaves nothing to run", () => {
    const w = world({
      a: {
        s: stick("s", 100)
      }, b: {
      }
    })
    const fromItems = itemsOf(w, "a")
    expect(planObject({
      item: fromItems[0], quantity: 1, from: "a", to: "b", fromItems, toItems: [], takenIds: new Set(), newId, arrive: () => null,
    })).toMatchObject({
      steps: [], refused: true
    })
  })

  it("leaves a device out of the network it belonged to", async () => {
    const device = {
      _id: "d", id: "d", name: "Commlink", type: "itemDevice", system: {
        isSlavedToPan: true, panMaster: "m", pan: {
          content: [{
            uuid: "x"
          }]
        }
      }
    }
    const w = world({
      a: {
        d: device
      }, b: {
      }
    })
    await runSteps(plan(w, "d", 1), w)
    expect(w.state.b.d.system).toMatchObject({
      isSlavedToPan: false, panMaster: "", pan: {
        content: []
      }
    })
  })
})

describe("the money is never made or lost", () => {
  const scenario = () => world({
    a: {
      s: stick("s", 3000),
      p: stick("p", 900, 3),
      n: {
        _id: "n", id: "n", type: "itemNuyen", system: {
          type: "gain", amount: 1000
        }
      },
    },
    b: {
      t: stick("t", 200),
      n2: {
        _id: "n2", id: "n2", type: "itemNuyen", system: {
          type: "gain", amount: 50
        }
      },
    },
  })

  // A whole stick, part of a pile, cash from a stick to a stick, and a line on each account
  function tradeSteps(w) {
    const cash = planCash(500, [{
      id: "s2", funds: 0
    }, {
      id: "p", funds: 900
    }], [{
      id: "t", funds: 200, room: 4800
    }])
    const steps = [
      ...plan(w, "s", 1),
      ...mergeStickWrites("a", cash.debits),
      ...mergeStickWrites("b", cash.credits),
      {
        op: "create", actor: "a", data: {
          _id: "out", type: "itemNuyen", system: {
            type: "loss", amount: 100
          }
        }
      },
      {
        op: "create", actor: "b", data: {
          _id: "in", type: "itemNuyen", system: {
            type: "gain", amount: 100
          }
        }
      },
    ]
    return orderSteps(steps)
  }

  it("runs a full trade with the same total", async () => {
    const w = scenario()
    const before = money(w)
    const result = await runSteps(tradeSteps(w), w)
    expect(result.ok).toBe(true)
    expect(money(w)).toBe(before)
  })

  it("a refused write at any step puts everything back", async () => {
    const reference = scenario()
    const count = tradeSteps(reference).length
    for (let n = 0; n < count; n++) {
      const w = scenario()
      const steps = tradeSteps(w)
      w.failOn(n)
      const result = await runSteps(steps, w)
      expect(result.ok, `step ${n}`).toBe(false)
      expect(result.undone, `step ${n}`).toBe(true)
      expect(w.state, `step ${n}`).toEqual(reference.state)
    }
  })

  it("a list cut at any step and run again ends on the same world: nothing paid twice", async () => {
    const whole = scenario()
    const wholeSteps = tradeSteps(whole)
    await runSteps(wholeSteps, whole)
    for (let n = 0; n < wholeSteps.length; n++) {
      const w = scenario()
      const steps = tradeSteps(w)
      // The page reloads after n writes: nothing is undone, the journal is read again
      for (let i = 0; i < n; i++) {
        const step = steps[i]
        if (step.op === "create") await w.create(step.actor, step.data)
        if (step.op === "update") await w.update(step.actor, step.id, step.set)
        if (step.op === "delete") await w.remove(step.actor, step.id)
      }
      // Whatever the cut, nothing stands on two sheets at once: no money can be spent twice while the journal waits
      expect(money(w), `cut at ${n}`).toBeLessThanOrEqual(money(whole))
      const result = await runSteps(steps, w)
      expect(result.ok, `cut at ${n}`).toBe(true)
      expect(money(w), `cut at ${n}`).toBe(money(whole))
      expect(Object.keys(w.state.a).sort(), `cut at ${n}`).toEqual(Object.keys(whole.state.a).sort())
      expect(Object.keys(w.state.b).sort(), `cut at ${n}`).toEqual(Object.keys(whole.state.b).sort())
    }
  })

  it("the same list run twice writes nothing the second time", async () => {
    const w = scenario()
    const steps = tradeSteps(w)
    await runSteps(steps, w)
    const after = structuredClone(w.state)
    const writes = w.writes
    expect((await runSteps(steps, w)).ok).toBe(true)
    expect(w.state).toEqual(after)
    expect(w.writes).toBe(writes)
  })

  it("a stick that moved since the plan stops everything: it is not overwritten", async () => {
    const w = scenario()
    const steps = tradeSteps(w)
    w.state.a.s.system.funds.value = 3500
    const result = await runSteps(steps, w)
    expect(result.ok).toBe(false)
    expect(w.state.a.s.system.funds.value).toBe(3500)
    expect(w.state.b.s).toBeUndefined()
    expect(w.state.b.in).toBeUndefined()
  })

  it("cash on a stick spent since the plan stops everything: what it holds now is not overwritten", async () => {
    const w = scenario()
    const steps = tradeSteps(w)
    w.state.b.t.system.funds.value = 999
    const result = await runSteps(steps, w)
    expect(result.ok).toBe(false)
    expect(w.state.b.t.system.funds.value).toBe(999)
    expect(w.state.a.s).toBeDefined()
    expect(w.state.b.in).toBeUndefined()
  })

  it("a stick is not spent twice when both sides pay", () => {
    const sticks = [{
      id: "a", funds: 100, room: 0
    }]
    const payee = [{
      id: "c", funds: 0, room: 1000
    }]
    expect(planCash(80, sticks, payee).debits).toEqual([{
      id: "a", from: 100, to: 20
    }])
    expect(planCash(80, sticks, payee)).toEqual({
      refusal: "cashShort"
    })
  })

  it("a second drop of the same stick finds it gone and cannot double it", async () => {
    const w = world({
      a: {
        s: stick("s", 3000)
      }, b: {
      }
    })
    const first = plan(w, "s", 1)
    const second = plan(w, "s", 1)
    await runSteps(first, w)
    await runSteps(second, w)
    expect(money(w)).toBe(3000)
    expect(Object.keys(w.state.b)).toEqual(["s"])
  })
})

describe("a list found in the journal", () => {
  const moved = () => {
    const w = world({
      a: {
        s: stick("s", 1000), p: stick("p", 900, 3)
      }, b: {
        t: stick("t", 0)
      }
    })
    const cash = planCash(100, [{
      id: "s", funds: 1000
    }], [{
      id: "t", funds: 0, room: 5000
    }])
    return {
      w, steps: orderSteps([...plan(w, "p", 1), ...mergeStickWrites("a", cash.debits), ...mergeStickWrites("b", cash.credits)])
    }
  }

  it("tells how far it has come, step by step", async () => {
    const {
      w, steps
    } = moved()
    const told = []
    await runSteps(steps, w, {
      onStep: done => told.push(done)
    })
    expect(told).toEqual(steps.map((_, i) => i + 1))
  })

  it("finished, is never undone, whatever was spent since", async () => {
    const {
      w, steps
    } = moved()
    await runSteps(steps, w)
    w.state.b.t.system.funds.value = 7
    const after = structuredClone(w.state)
    expect((await runSteps(steps, w, {
      from: steps.length, resuming: true
    })).ok).toBe(true)
    expect(w.state).toEqual(after)
  })

  it("does not read again the steps it knows are done", async () => {
    const {
      w, steps
    } = moved()
    const first = steps.findIndex(s => s.op === "update" && s.actor === "b")
    await runSteps(steps.slice(0, first + 1), w)
    w.state.b.t.system.funds.value = 7
    const result = await runSteps(steps, w, {
      from: first + 1, resuming: true
    })
    expect(result.ok).toBe(true)
    expect(w.state.b.t.system.funds.value).toBe(7)
  })

  it("finishes on what is there now when a stick changed during the cut: the money arrives, none is made", async () => {
    const {
      w, steps
    } = moved()
    const first = steps.findIndex(s => s.op === "update" && s.actor === "b")
    await runSteps(steps.slice(0, first), w)
    w.state.b.t.system.funds.value = 7
    const before = money(w)
    const result = await runSteps(steps, w, {
      from: first, resuming: true
    })
    expect(result.ok).toBe(true)
    expect(w.state.b.t.system.funds.value).toBe(107)
    expect(money(w)).toBe(before + 100)
  })
})

describe("a list stopped after a cut loses nothing and makes nothing twice", () => {
  // N1: a tube of 800 and 100 in cash. The tube has left, the bearer deposits 50 from the stick that was to pay
  const n1 = () => {
    const w = world({
      a: {
        t1: stick("t1", 800), pay: stick("pay", 500)
      }, b: {
        t: stick("t", 0)
      }
    })
    const cash = planCash(100, [{
      id: "pay", funds: 500
    }], [{
      id: "t", funds: 0, room: 5000
    }])
    return {
      w, steps: orderSteps([...plan(w, "t1", 1), ...mergeStickWrites("a", cash.debits), ...mergeStickWrites("b", cash.credits)])
    }
  }
  const options = {
    resuming: true, runId: "run"
  }
  const cut = async (w, steps, n) => {
    await runSteps(steps.slice(0, n), w, {
      runId: "run"
    })
  }
  // Everything that holds money, wherever it is, and what the result still names
  const total = (w, result) => money(w) + (result.stranded ?? []).reduce((sum, s) => sum + (s.amount ?? s.funds ?? 0), 0)

  it("the bearer spent from the paying stick: the list finishes, the tube arrives, the money is right", async () => {
    const {
      w, steps
    } = n1()
    const start = money(w)
    await cut(w, steps, 1)
    expect(w.state.a.t1).toBeUndefined()
    w.state.a.pay.system.funds.value -= 50
    const result = await runSteps(steps, w, {
      ...options, from: 1
    })
    expect(result.ok).toBe(true)
    expect(w.state.b.t1.system.funds.value).toBe(800)
    expect(w.state.a.pay.system.funds.value).toBe(350)
    expect(w.state.b.t.system.funds.value).toBe(100)
    expect(money(w)).toBe(start - 50)
  })

  it("the paying stick no longer holds enough: the tube goes back to its owner", async () => {
    const {
      w, steps
    } = n1()
    await cut(w, steps, 1)
    w.state.a.pay.system.funds.value = 10
    const result = await runSteps(steps, w, {
      ...options, from: 1
    })
    expect(result).toMatchObject({
      ok: false, undone: true, stranded: []
    })
    expect(w.state.a.t1.system.funds.value).toBe(800)
    expect(w.state.a.pay.system.funds.value).toBe(10)
    expect(w.state.b.t1).toBeUndefined()
  })

  it("the receiver's stick is gone before the credit: the debit and the tube go back", async () => {
    const {
      w, steps
    } = n1()
    const first = steps.findIndex(s => s.op === "update" && s.actor === "b")
    await cut(w, steps, first)
    expect(w.state.a.pay.system.funds.value).toBe(400)
    delete w.state.b.t
    const result = await runSteps(steps, w, {
      ...options, from: first
    })
    expect(result).toMatchObject({
      ok: false, undone: true
    })
    expect(w.state.a.pay.system.funds.value).toBe(500)
    expect(w.state.a.t1.system.funds.value).toBe(800)
    expect(w.state.b.t1).toBeUndefined()
  })

  it("the receiver's stick has no room left: the money comes back too", async () => {
    const {
      w, steps
    } = n1()
    const first = steps.findIndex(s => s.op === "update" && s.actor === "b")
    await cut(w, steps, first)
    w.state.b.t.system.funds.value = 4950
    const result = await runSteps(steps, w, {
      ...options, from: first
    })
    expect(result.ok).toBe(false)
    expect(w.state.a.pay.system.funds.value).toBe(500)
    expect(w.state.b.t.system.funds.value).toBe(4950)
  })

  it("the marked step that ran is not paid twice, whatever its stick shows now", async () => {
    const {
      w, steps
    } = n1()
    const first = steps.findIndex(s => s.op === "update" && s.actor === "b")
    // The write went through, the journal never heard of it
    await cut(w, steps, first + 1)
    w.state.b.t.system.funds.value += 30
    const result = await runSteps(steps, w, {
      ...options, from: first
    })
    expect(result.ok).toBe(true)
    expect(w.state.b.t.system.funds.value).toBe(130)
  })

  it("an arrival spent since stays with its bearer, and the original is not put back: no double", async () => {
    const {
      w, steps
    } = n1()
    const arrival = steps.findIndex(s => s.op === "create")
    await cut(w, steps, arrival + 1)
    w.state.b.t1.system.funds.value = 300
    delete w.state.b.t
    const result = await runSteps(steps, w, {
      ...options, from: arrival + 1
    })
    expect(result.ok).toBe(false)
    expect(w.state.a.t1).toBeUndefined()
    expect(w.state.b.t1.system.funds.value).toBe(300)
    expect(result.kept).toEqual([expect.objectContaining({
      name: "Créditube", funds: 300
    })])
    expect(result.undone).toBe(false)
  })

  it("money received and spent on the way does not also go back to the payer", async () => {
    const {
      w, steps
    } = n1()
    const credit = steps.findIndex(s => s.op === "update" && s.actor === "b")
    // A later step will fail: a last object that cannot arrive
    const failing = [...steps, {
      op: "update", actor: "b", id: "missing", set: {
        "system.funds.value": 1
      }, was: {
        "system.funds.value": 0
      }
    }]
    await cut(w, steps, credit + 1)
    w.state.b.t.system.funds.value = 40
    const result = await runSteps(failing, w, {
      ...options, from: credit + 1
    })
    expect(result.ok).toBe(false)
    expect(w.state.b.t.system.funds.value).toBe(0)
    expect(w.state.a.pay.system.funds.value).toBe(440)
    expect(result.undone).toBe(false)
  })

  it("an owner who is gone: the tube is named with its amount, never lost", async () => {
    const {
      w, steps
    } = n1()
    await cut(w, steps, 1)
    w.state.a.pay.system.funds.value = 10
    const realCreate = w.create
    const store = {
      has: w.has, read: w.read, update: w.update, remove: w.remove,
      create: (actor, data) => actor === "a" ? Promise.reject(new Error("no such actor")) : realCreate(actor, data),
    }
    const result = await runSteps(steps, store, {
      ...options, from: 1
    })
    expect(result.ok).toBe(false)
    expect(result.stranded).toEqual([expect.objectContaining({
      kind: "object", actor: "a", name: "Créditube", funds: 800, snapshot: expect.objectContaining({
        _id: "t1"
      })
    })])
    expect(total(w, result)).toBe(800 + 10 + 0)
  })

  it("the stick that paid is gone: the amount is named, with whose it was", async () => {
    const {
      w, steps
    } = n1()
    const credit = steps.findIndex(s => s.op === "update" && s.actor === "b")
    await cut(w, steps, credit)
    delete w.state.a.pay
    delete w.state.b.t
    const result = await runSteps(steps, w, {
      ...options, from: credit
    })
    expect(result.stranded).toEqual([expect.objectContaining({
      kind: "money", actor: "a", itemId: "pay", amount: 100
    })])
    expect(w.state.a.t1.system.funds.value).toBe(800)
  })

  it("another list writing the same stick during the cut does not make the first pay twice", async () => {
    const {
      w, steps
    } = n1()
    const debit = steps.findIndex(s => s.op === "update" && s.actor === "a")
    // The debit went through, the journal never heard of it (reached is still at the debit)
    await cut(w, steps, debit + 1)
    expect(w.state.a.pay.system.funds.value).toBe(400)
    // A newer list debits the same stick, with its own mark
    expect((await runSteps([{
      op: "update", actor: "a", id: "pay", set: {
        "system.funds.value": 300
      }, was: {
        "system.funds.value": 400
      }
    }], w, {
      runId: "other"
    })).ok).toBe(true)
    const result = await runSteps(steps, w, {
      ...options, from: debit
    })
    expect(result.ok).toBe(true)
    expect(w.state.a.pay.system.funds.value).toBe(300)
    expect(w.state.b.t.system.funds.value).toBe(100)
  })

  it("a list's mark stays among the others, and the field does not grow without end", () => {
    let field = ""
    for (let i = 0; i < 20; i++) field = withMark(field, `r${i}:0`)
    expect(hasMark(field, "r19:0")).toBe(true)
    expect(hasMark(field, "r18:0")).toBe(true)
    expect(field.split("|").length).toBe(8)
    expect(hasMark(field, "r0:0")).toBe(false)
  })

  it("every cut, then every kind of trouble: the money only ever goes down by what the bearer spent", async () => {
    const reference = n1()
    const start = money(reference.w)
    for (let n = 0; n <= reference.steps.length; n++) {
      for (const trouble of ["none", "spendPayer", "emptyPayer", "loseReceiver"]) {
        const {
          w, steps
        } = n1()
        await cut(w, steps, n)
        let outside = 0
        if (trouble === "spendPayer" && w.state.a.pay) {
          w.state.a.pay.system.funds.value -= 50
          outside = 50
        }
        if (trouble === "emptyPayer" && w.state.a.pay) {
          outside = w.state.a.pay.system.funds.value
          w.state.a.pay.system.funds.value = 0
        }
        if (trouble === "loseReceiver" && w.state.b.t) {
          outside = w.state.b.t.system.funds.value
          delete w.state.b.t
        }
        const result = await runSteps(steps, w, {
          ...options, from: n
        })
        expect(total(w, result) + outside, `cut ${n}, ${trouble}`).toBe(start)
        const held = [...Object.values(w.state.a), ...Object.values(w.state.b)].filter(i => i.name === "Créditube" && i._id === "t1")
        expect(held.length, `cut ${n}, ${trouble}: one tube`).toBe(1)
      }
    }
  })
})

describe("two identical piles to one pile of the receiver", () => {
  const ammo = (id, quantity) => ({
    _id: id, id, name: "Balles", type: "itemAmmunition", system: {
      quantity, storedIn: ""
    }
  })
  const count = (w, actor) => Object.values(w.state[actor]).reduce((n, i) => n + (i.system.quantity ?? 0), 0)

  it("planned against the same pile, the second stops the list: everything goes back, no round lost", async () => {
    const w = world({
      a: {
        x: ammo("x", 5), y: ammo("y", 5)
      }, b: {
        z: ammo("z", 3)
      }
    })
    const steps = orderSteps([...plan(w, "x", 5), ...plan(w, "y", 5)])
    const result = await runSteps(steps, w, {
      runId: "run"
    })
    expect(result).toMatchObject({
      ok: false, undone: true
    })
    expect(count(w, "a") + count(w, "b")).toBe(13)
    expect(count(w, "b")).toBe(3)
  })

  it("the pile counted once, the second makes its own: all the rounds arrive", async () => {
    const w = world({
      a: {
        x: ammo("x", 5), y: ammo("y", 5)
      }, b: {
        z: ammo("z", 3)
      }
    })
    const first = plan(w, "x", 5)
    const fromItems = itemsOf(w, "a")
    const second = planObject({
      item: fromItems.find(i => i.id === "y"), quantity: 5, from: "a", to: "b", fromItems, toItems: [],
      takenIds: new Set(itemsOf(w, "b").map(i => i.id)), newId,
    }).steps
    expect((await runSteps(orderSteps([...first, ...second]), w, {
      runId: "run"
    })).ok).toBe(true)
    expect(count(w, "b")).toBe(13)
    expect(count(w, "a")).toBe(0)
  })
})

describe("the same goods on both sides", () => {
  it("each joins nothing the other gives away: the trade goes through, and the count holds", async () => {
    const ammo = (id, quantity) => ({
      _id: id, id, name: "Balles", type: "itemAmmunition", system: {
        quantity, storedIn: ""
      }
    })
    const w = world({
      a: {
        x: ammo("x", 10)
      }, b: {
        y: ammo("y", 10)
      }
    })
    const side = (from, to, id, quantity, offered) => {
      const fromItems = itemsOf(w, from)
      const toItems = itemsOf(w, to).filter(i => i.id !== offered)
      return planObject({
        item: fromItems.find(i => i.id === id), quantity, from, to, fromItems, toItems,
        takenIds: new Set(itemsOf(w, to).map(i => i.id)), newId,
      }).steps
    }
    const steps = orderSteps([...side("a", "b", "x", 5, "y"), ...side("b", "a", "y", 3, "x")])
    expect((await runSteps(steps, w)).ok).toBe(true)
    const count = actor => Object.values(w.state[actor]).reduce((n, i) => n + i.system.quantity, 0)
    expect(count("a")).toBe(8)
    expect(count("b")).toBe(12)
  })
})

describe("what leaves a body", () => {
  const drug = system => ({
    _id: "d", id: "d", name: "Jazz", type: "itemDrug", flags: {
      sr5: {
        riseStart: 5, crashStart: 9, crashPartOver: "a", keep: 1
      }
    }, system: {
      quantity: 2, phase: "", isActive: false, wirelessTurnedOn: false, ...system
    }
  })

  it("a drug in its rise or its crash stays", () => {
    expect(transferRefusal(drug({
      phase: "rise", isActive: true
    }))).toBe("drugActive")
    expect(transferRefusal(drug({
      phase: "crash", wirelessTurnedOn: true
    }))).toBe("drugActive")
    expect(transferRefusal(drug({
    }))).toBe(null)
    expect(tradeRefusal(drug({
      phase: "crash"
    }))).toBe("drugActive")
  })

  it("over, it leaves its clock behind", () => {
    const out = sanitizeArrival(structuredClone(drug({
    })))
    expect(out.system).toMatchObject({
      phase: "", isActive: false, wirelessTurnedOn: false
    })
    expect(out.flags.sr5).toEqual({
      keep: 1
    })
  })

  it("a bag does not take a drug still working on its bearer: the refusal names the drug", () => {
    const bag = {
      id: "b", name: "Sac", type: "itemStorage", system: {
      }
    }
    const held = {
      ...drug({
        phase: "crash", wirelessTurnedOn: true, storedIn: "b"
      }), name: "Jazz"
    }
    expect(bundleRefusal(bag, [bag, held])).toEqual({
      key: "drugInBag", name: "Jazz"
    })
    expect(bundleRefusal(held, [bag, held])).toEqual({
      key: "drugActive", name: "Jazz"
    })
    expect(bundleRefusal(bag, [bag, drug({
      storedIn: "b"
    })])).toBe(null)
  })

  it("a vehicle leaves its network", () => {
    expect(sanitizeArrival({
      type: "itemVehicle", system: {
        slaved: true
      }
    }).system.slaved).toBe(false)
  })
})

describe("a line of the accounts", () => {
  const line = (id, amount) => ({
    _id: id, id, name: "Gain", type: "itemNuyen", system: {
      type: "gain", amount
    }
  })

  it("a line of Karma too", async () => {
    const karma = {
      _id: "k", id: "k", name: "Karma", type: "itemKarma", system: {
        type: "gain", amount: 5
      }
    }
    expect(movesRatherThanCopies(karma)).toBe(true)
    expect(isPhysical(karma)).toBe(false)
    const w = world({
      a: {
        k: karma
      }, b: {
      }
    })
    await runSteps(plan(w, "k", 1), w)
    expect(w.state.a.k).toBeUndefined()
    expect(w.state.b.k.system.amount).toBe(5)
  })

  it("moves rather than copies, and is no object one gives", () => {
    expect(movesRatherThanCopies(line("n", 1))).toBe(true)
    expect(isPhysical(line("n", 1))).toBe(false)
    expect(tradeRefusal(line("n", 1))).toBe("notAnObject")
  })

  it("leaves its sheet: the money does not exist twice", async () => {
    const w = world({
      a: {
        n: line("n", 2000)
      }, b: {
      }
    })
    await runSteps(plan(w, "n", 1), w)
    expect(w.state.a.n).toBeUndefined()
    expect(money(w)).toBe(2000)
  })

  it("that changed since the plan stays", async () => {
    const w = world({
      a: {
        n: line("n", 2000)
      }, b: {
      }
    })
    const steps = plan(w, "n", 1)
    w.state.a.n.system.amount = 500
    expect((await runSteps(orderSteps(steps), w)).ok).toBe(false)
    expect(w.state.a.n.system.amount).toBe(500)
    expect(w.state.b.n).toBeUndefined()
  })
})

describe("cash", () => {
  it("takes from the sticks in order and loads the receiver's up to their room", () => {
    const payer = [{
      id: "a", funds: 100
    }, {
      id: "b", funds: 500
    }]
    const payee = [{
      id: "c", funds: 0, room: 300
    }, {
      id: "d", funds: 10, room: 1000
    }]
    expect(planCash(400, payer, payee)).toEqual({
      debits: [{
        id: "a", from: 100, to: 0
      }, {
        id: "b", from: 500, to: 200
      }],
      credits: [{
        id: "c", from: 0, to: 300
      }, {
        id: "d", from: 10, to: 110
      }],
    })
  })

  it("refuses what the sticks do not hold, and what the receiver's cannot take", () => {
    expect(planCash(10, [{
      id: "a", funds: 5
    }], [{
      id: "c", funds: 0, room: 100
    }])).toEqual({
      refusal: "cashShort"
    })
    expect(planCash(10, [{
      id: "a", funds: 50
    }], [])).toEqual({
      refusal: "cashNoRoom"
    })
  })
})
