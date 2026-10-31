import {
  describe, it, expect
} from 'vitest'
import {
  SR5Credstick
} from '../modules/interface/credstick.js'
import {
  SR5ShopFence
} from '../modules/interface/shop-fence.js'
import {
  splitFunds, splitPile
} from '../modules/rolls/roll-helpers/pickpocket-rules.js'

const pile = (quantity, value = 0, max = 5000, name = 'Créditube (Standard)') => ({
  type: 'itemGear', name, system: {
    isCredstick: true, quantity, funds: {
      value, max
    }
  }
})

describe('a pile of credsticks holds what its tubes hold (SR5 p. 446)', () => {
  it('twenty Standard hold 100 000 ¥', () => {
    expect(SR5Credstick.capacity(pile(20))).toBe(100000)
    expect(SR5Credstick.room(pile(20, 5000))).toBe(95000)
  })
  it('a single tube and a full pile keep their old readings', () => {
    expect(SR5Credstick.capacity(pile(1))).toBe(5000)
    expect(SR5Credstick.room(pile(1, 5000))).toBe(0)
    expect(SR5Credstick.room(pile(20, 100000))).toBe(0)
  })
  it('no ceiling stays no ceiling', () => {
    expect(SR5Credstick.room(pile(20, 5000, 0))).toBe(Infinity)
  })
})

describe('tubes leaving a pile take their share of its balance', () => {
  it('one of twenty at 5 000 ¥: no nuyen made', () => {
    expect(splitFunds(pile(20, 5000), 1)).toEqual({
      taken: 250, left: 4750
    })
  })
  it('the whole pile takes the whole balance', () => {
    expect(splitFunds(pile(20, 5000), 20)).toEqual({
      taken: 5000, left: 0
    })
  })
  it('the odd nuyen stays with the pile', () => {
    expect(splitFunds(pile(3, 100), 1)).toEqual({
      taken: 33, left: 67
    })
  })
  it('whatever the split, the total holds and nobody goes over capacity', () => {
    for (const size of [2, 3, 7, 20]) for (let funds = 0; funds <= size * 5000; funds += 1237) for (let q = 1; q < size; q++) {
      const {
        taken, left
      } = splitFunds(pile(size, funds), q)
      expect(taken + left).toBe(funds)
      expect(taken).toBeLessThanOrEqual(q * 5000)
      expect(left).toBeLessThanOrEqual((size - q) * 5000)
    }
  })
  it('anything else has no balance to share', () => {
    expect(splitFunds({
      type: 'itemGear', system: {
        quantity: 3
      }
    }, 1)).toBeNull()
  })
})

describe('a credstick dropped on another sheet', () => {
  const dropped = (stick, parent) => ({
    ...stick, parent, toObject: () => structuredClone({
      type: stick.type, name: stick.name, system: stick.system
    })
  })
  it('comes empty from an actor, the whole pile with it, and the original keeps the money', () => {
    const stick = dropped(pile(20, 5000), {
      id: 'giver'
    })
    const {
      data, emptied
    } = SR5Credstick.copyOf(stick)
    expect(emptied).toBe(true)
    expect(data.system.quantity).toBe(20)
    expect(data.system.funds).toEqual({
      value: 0, max: 5000
    })
    expect(stick.system.funds.value).toBe(5000)
  })
  it('an empty stick has nothing to say', () => {
    expect(SR5Credstick.copyOf(dropped(pile(1), {
      id: 'giver'
    })).emptied).toBe(false)
  })
  it('from a compendium or the world it keeps what it was written with', () => {
    const {
      data, emptied
    } = SR5Credstick.copyOf(dropped(pile(1, 450), null))
    expect(emptied).toBe(false)
    expect(data.system.funds.value).toBe(450)
  })
  it('anything else is left alone', () => {
    const gun = {
      type: 'itemWeapon', name: 'Arme', system: {
        quantity: 1
      }, parent: {
        id: 'giver'
      }, toObject: () => ({
        type: 'itemWeapon', name: 'Arme', system: {
          quantity: 1
        }
      })
    }
    expect(SR5Credstick.copyOf(gun).emptied).toBe(false)
  })
})

describe('a fence and a loaded credstick', () => {
  const seller = (...items) => {
    const owned = new Map(items.map(i => [i.id, i]))
    const actor = {
      id: 'sellerId', name: 'A', paid: [], items: {
        get: id => owned.get(id)
      },
      deleteEmbeddedDocuments: async (_type, ids) => {
        const gone = ids.map(id => owned.get(id))
        ids.forEach(id => owned.delete(id))
        return gone
      },
      updateEmbeddedDocuments: async (_type, changes) => changes.map(c => {
        const i = owned.get(c._id)
        i.system.quantity = c['system.quantity']
        return i
      }),
      createEmbeddedDocuments: async (_type, docs) => {
        actor.paid.push(...docs.map(d => d.system.amount))
      },
    }
    return actor
  }
  const line = {
    itemId: 'stick', name: 'Tube', quantity: 1, total: 10
  }
  it('a stick loaded since the card was written is not handed over, nor paid for', async () => {
    const stick = {
      id: 'stick', ...pile(2, 300)
    }
    const actor = seller(stick)
    expect(await SR5ShopFence.handOver(actor, {
      results: [line]
    })).toBe(false)
    expect(actor.items.get('stick').system).toMatchObject({
      quantity: 2, funds: {
        value: 300
      }
    })
    expect(actor.paid).toEqual([])
  })
  it('its card then says why, not that the object is gone', async () => {
    const stick = {
      id: 'stick', ...pile(2, 300)
    }
    const actor = seller(stick)
    const message = {
      content: '<footer class="sr-shop-card-footer"><button></button></footer>',
      flags: {
        sr5fence: {
          buyerId: 'sellerId', results: [line]
        }
      },
      getFlag: (scope, key) => message.flags[scope]?.[key],
      update: async changes => {
        Object.assign(message, changes)
      },
    }
    foundry.utils.escapeHTML ??= text => text
    const user = game.user
    game.user = {
      id: 'gm'
    }
    try {
      expect(await SR5ShopFence.cash(message, actor)).toBe(false)
    } finally {
      game.user = user
    }
    expect(message.content).toContain('SR5.WARN_ShopVendorLoadedStick')
    expect(message.content).not.toContain('SR5.ShopSaleGone')
  })
  it('an empty stick is sold like any object', async () => {
    const stick = {
      id: 'stick', ...pile(2)
    }
    const actor = seller(stick)
    await SR5ShopFence.handOver(actor, {
      results: [line]
    })
    expect(actor.items.get('stick').system.quantity).toBe(1)
    expect(actor.paid).toEqual([10])
  })
})

describe('credsticks joining a pile of the receiver', () => {
  it('a loaded one stays apart, even at the same balance: merging would lose it', () => {
    expect(splitPile(pile(1, 500), 1, [pile(1, 500)]).mergeInto).toBeNull()
    expect(splitPile(pile(20, 5000), 1, [pile(2, 5000)]).mergeInto).toBeNull()
  })
  it('empty ones merge', () => {
    const mine = pile(2)
    expect(splitPile(pile(20), 1, [mine]).mergeInto).toBe(mine)
  })
  it('an empty one does not join a loaded pile', () => {
    expect(splitPile(pile(20), 1, [pile(2, 300)]).mergeInto).toBeNull()
  })
})
