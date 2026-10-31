import {
  describe, it, expect, vi, beforeEach, afterEach
} from 'vitest'
import {
  foundryHooks
} from './fixtures/foundry-hooks.js'
import {
  SR5ShopCatalog, isReagentEntry
} from '../modules/interface/shop-catalog.js'
import {
  fitsRestock
} from '../modules/interface/shop-vendor-rules.js'
import {
  VENDOR_TEMPLATES
} from '../modules/interface/shop-vendor-templates.js'
import {
  SR5Shop
} from '../modules/interface/shop.js'
import {
  SR5ShopStock
} from '../modules/interface/shop-stock.js'
import {
  SR5ShopVendor
} from '../modules/interface/shop-vendor.js'
import {
  SR5_SocketHandler
} from '../modules/socket.js'
import {
  cashCard, socketCashQuestion
} from '../modules/interface/shop-retry.js'

const focus = {
  type: 'itemFocus', system: {
    legality: 'R', price: {
      value: 4000
    }, availability: {
      value: 3
    }
  }
}
const reagent = (legality, availability) => ({
  type: 'itemGear', flags: {
    sr5: {
      reagent: true
    }
  }, system: {
    legality, price: {
      value: 20
    }, availability: {
      value: availability
    }
  }
})
const fits = (entry, template) => fitsRestock(SR5ShopCatalog.describe(entry), SR5ShopCatalog.shelfOf(entry), template)

describe('the magic shelf', () => {
  it('holds the reagents, told by their flag, and the rest of the gear stays where it was', () => {
    expect(SR5ShopCatalog.shelfOf(reagent('', 0))).toBe('magic')
    expect(SR5ShopCatalog.shelfOf(focus)).toBe('magic')
    expect(isReagentEntry({
      type: 'itemWeapon', flags: {
        sr5: {
          reagent: true
        }
      }
    })).toBe(false)
    // Not by the book and the page: a copy from before the flag, or the page corrected, changes nothing
    expect(SR5ShopCatalog.shelfOf({
      type: 'itemGear', system: {
        source: 'forbiddenArcana', page: 181
      }
    })).toBe('gear')
    expect(SR5ShopCatalog.shelfOf({
      type: 'itemGear', system: {
      }
    })).toBe('gear')
    expect(SR5ShopCatalog.INDEX_FIELDS).toContain('flags.sr5.reagent')
  })

  it('leaves no magic template empty: foci are all restricted (SR5 p. 465), a legal shop sells reagents', () => {
    const shelf = [focus, reagent('', 0), reagent('', 1), reagent('', 4), reagent('R', 6)]
    for (const template of VENDOR_TEMPLATES.filter(t => t.family === 'magic')) {
      expect(shelf.filter(entry => fits(entry, template)).length, template.key).toBeGreaterThan(0)
    }
    // Mama Pauvre and the Parabotaniste of the Megapack carry these settings on their sheets
    expect(shelf.filter(entry => fits(entry, {
      shelves: ['magic'], legality: ['legal'], maxAvailability: 8
    }))).toHaveLength(3)
    expect(VENDOR_TEMPLATES.find(t => t.key === 'traditionalTalismonger').legality).toContain('R')
  })
})

// The way a card really goes: the click reached the gamemaster's browser, cashCard runs the real till
describe('the till of a card, on the gamemaster\'s browser', () => {
  const gm = {
    id: 'gm', isGM: true
  }
  const player = {
    id: 'pl', isGM: false
  }
  let settings, card, buyer, relayed, confirm, whispers

  const results = [{
    uuid: 'Item.gun', name: 'Gun', outcome: 'success', obtained: true, quantity: 1, netHits: 1, availability: 0
  }]
  const cash = (extra = {
  }, sender = 'pl') => cashCard({
    messageId: 'msg1', express: false, ...extra
  }, sender)
  const settled = async () => {
    await vi.dynamicImportSettled()
    await new Promise(resolve => setTimeout(resolve))
  }

  beforeEach(() => {
    settings = {
    }
    relayed = vi.spyOn(SR5_SocketHandler, 'emitForPlayer').mockResolvedValue()
    confirm = vi.fn(async () => true)
    whispers = []
    buyer = {
      id: 'buyer', name: 'Wrecker', isOwner: true, type: 'actorPc', items: Object.assign([], {
        get: () => null
      }), system: {
      },
      testUserPermission: u => u.id === 'pl' || u.isGM,
    }
    card = {
      id: 'msg1', author: gm, content: '<footer class="sr-shop-card-footer">x</footer>', update: vi.fn(async () => {}),
      flags: {
        sr5shop: {
          buyerId: 'buyer', buyerName: 'Wrecker', surcharge: 0, limit: 0, results
        }
      },
    }
    vi.stubGlobal('game', {
      user: gm,
      users: {
        activeGM: gm, get: id => ({
          gm, pl: player
        })[id]
      },
      settings: {
        get: (s, k) => settings[k], set: async (s, k, v) => {
          settings[k] = v
        }
      },
      time: {
        worldTime: 0
      },
      actors: {
        get: id => id === buyer?.id ? buyer : null
      },
      messages: {
        get: () => card
      },
      i18n: {
        format: k => k, localize: k => k
      },
    })
    vi.stubGlobal('ui', {
      notifications: {
        warn: vi.fn(), info: vi.fn()
      }
    })
    vi.stubGlobal('fromUuid', async () => ({
      name: 'Gun', type: 'itemWeapon', system: {
        price: {
          value: 500
        }, availability: {
          value: 0
        }
      }
    }))
    vi.stubGlobal('Hooks', foundryHooks())
    globalThis.foundry.applications ??= {
    }
    globalThis.foundry.applications.api ??= {
    }
    globalThis.foundry.applications.api.DialogV2 = {
      confirm
    }
    globalThis.foundry.documents ??= {
    }
    globalThis.foundry.documents.ChatMessage = {
      create: async data => {
        whispers.push(data)
        return data
      }
    }
    globalThis.foundry.utils.escapeHTML ??= s => s
    vi.spyOn(SR5Shop, 'sellableSource').mockReturnValue(true)
    vi.spyOn(SR5ShopStock, 'canSell').mockReturnValue(true)
    vi.spyOn(SR5ShopStock, 'isBuyer').mockReturnValue(true)
    vi.spyOn(SR5Shop, 'balance').mockReturnValue(0)
  })
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('tells the player who clicked she cannot pay, not the gamemaster, and the card may be cashed again', async () => {
    expect(await cash()).toBe(false)
    await settled()
    expect(ui.notifications.warn).not.toHaveBeenCalled()
    expect(relayed).toHaveBeenCalledWith('shopVendorNotice', expect.objectContaining({
      level: 'warn', key: 'SR5.WARN_ShopNotEnoughNuyen'
    }), 'pl')
    expect(card.update).not.toHaveBeenCalled()
    expect(settings.sr5ShopRetryLedger.msg1.cashed).toBe(false)
  })

  it('tells the gamemaster when he clicked himself', async () => {
    expect(await cash({
    }, 'gm')).toBe(false)
    await settled()
    expect(ui.notifications.warn).toHaveBeenCalledOnce()
    expect(relayed).not.toHaveBeenCalled()
  })

  it('refuses a purchase that would take her Essence to 0 at her browser, with no question to the gamemaster (SR5 p. 54)', async () => {
    const essence = vi.spyOn(SR5Shop, 'essenceAllows')
    const screen = vi.spyOn(SR5Shop, 'screenLines')
    await cash()
    expect(screen.mock.calls[0][2].isGM).toBe(false)
    expect(essence.mock.calls[0][2].isGM).toBe(false)
    essence.mock.calls[0][2].warn('SR5.WARN_ShopEssenceTooLow', {
      name: 'Wrecker'
    })
    await settled()
    expect(relayed).toHaveBeenCalledWith('shopVendorNotice', {
      level: 'warn', key: 'SR5.WARN_ShopEssenceTooLow', data: {
        name: 'Wrecker'
      }
    }, 'pl')
    expect(confirm).not.toHaveBeenCalled()
  })

  it('asks a module\'s warning of whoever clicked; the card is released meanwhile, a yes comes back as a new request', async () => {
    vi.stubGlobal('Hooks', foundryHooks({
      'sr5.purchaseFunds': [data => {
        data.allow = true
        data.warning = 'Dette'
      }]
    }))
    expect(await cash()).toBe(false)
    await settled()
    expect(confirm).not.toHaveBeenCalled()
    expect(settings.sr5ShopRetryLedger.msg1.cashed).toBe(false)
    const asked = relayed.mock.calls.find(([type]) => type === 'shopCashQuestion')
    expect(asked[1].question).toEqual({
      kind: 'funds', warning: 'Dette'
    })
    expect(asked[2]).toBe('pl')
    // The card is not frozen by a question nobody answers
    expect(await cash()).toBe(false)

    // On her browser now
    game.user = player
    const request = vi.spyOn(SR5_SocketHandler, 'emitForGM').mockResolvedValue()
    await socketCashQuestion({
      data: asked[1]
    }, 'gm')
    expect(confirm).toHaveBeenCalledOnce()
    expect(request).toHaveBeenCalledWith('shopAvailabilityRetry', expect.objectContaining({
      cash: true, messageId: 'msg1', answers: {
        funds: true
      }
    }))
  })

  it('leaves the card as it was on a no', async () => {
    game.user = player
    confirm.mockResolvedValue(false)
    const request = vi.spyOn(SR5_SocketHandler, 'emitForGM').mockResolvedValue()
    await socketCashQuestion({
      data: {
        messageId: 'msg1', question: {
          kind: 'greyware', name: 'Wrecker', count: 1
        }
      }
    }, 'gm')
    expect(request).not.toHaveBeenCalled()
  })

  it('takes a question from a gamemaster only', async () => {
    await socketCashQuestion({
      data: {
        messageId: 'msg1', question: {
          kind: 'funds', warning: 'x'
        }
      }
    }, 'pl')
    expect(confirm).not.toHaveBeenCalled()
  })

  it('at a vendor\'s: the till is given the way to ask, and a question stops the sale', async () => {
    card.flags.sr5shop.vendor = {
      uuid: 'Actor.v', storageId: 's'
    }
    vi.spyOn(SR5ShopVendor, 'sell').mockImplementation(async request => {
      request.ask({
        kind: 'funds', warning: 'Dette'
      })
      return false
    })
    expect(await cash()).toBe(false)
    await settled()
    expect(relayed.mock.calls.find(([type]) => type === 'shopCashQuestion')[2]).toBe('pl')
  })

  it('writes nothing on a question, "paying" before the money moves, "cashed" when the sale is done', async () => {
    let during
    const checkout = vi.spyOn(SR5Shop, 'checkout').mockImplementation(async (b, lines, {
      beforePay
    }) => {
      expect(settings.sr5ShopRetryLedger?.msg1?.cashed).toBeFalsy()
      await beforePay()
      during = {
        ...settings.sr5ShopRetryLedger.msg1
      }
      return true
    })
    expect(await cash()).toBe(true)
    expect(during).toMatchObject({
      paying: true
    })
    expect(during.cashed).toBeFalsy()
    expect(settings.sr5ShopRetryLedger.msg1.cashed).toBe(true)
    expect(settings.sr5ShopRetryLedger.msg1.paying).toBeUndefined()
    expect(checkout).toHaveBeenCalledOnce()
  })

  it('a till cut off during the sale: the player is told, nothing is paid again unless a gamemaster says so', async () => {
    const checkout = vi.spyOn(SR5Shop, 'checkout').mockResolvedValue(true)
    settings.sr5ShopRetryLedger = {
      msg1: {
        lines: [], paying: true
      }
    }
    expect(await cash()).toBe(false)
    expect(whispers[0].content).toContain('SR5.ShopCashInterrupted')
    expect(await cash({
    }, 'gm')).toBe(false)
    await settled()
    expect(confirm).toHaveBeenCalledOnce()
    expect(checkout).toHaveBeenCalledOnce()
    expect(settings.sr5ShopRetryLedger.msg1.cashed).toBe(true)
  })

  it('a resumed till that sells nothing keeps the card interrupted: the first debit may have happened', async () => {
    const checkout = vi.spyOn(SR5Shop, 'checkout').mockImplementation(async (b, lines, {
      ask
    }) => {
      ask({
        kind: 'greyware', name: 'Wrecker', count: 1
      })
      return false
    })
    confirm.mockResolvedValue(false)
    settings.sr5ShopRetryLedger = {
      msg1: {
        lines: [], paying: true
      }
    }
    expect(await cash({
      answers: {
        resume: true
      }
    }, 'gm')).toBe(false)
    await settled()
    expect(settings.sr5ShopRetryLedger.msg1.paying).toBe(true)
    // She clicks: told, and the till is not run again
    expect(await cash()).toBe(false)
    expect(whispers.at(-1).content).toContain('SR5.ShopCashInterrupted')
    expect(checkout).toHaveBeenCalledOnce()
  })

  it('a click while the gamemaster reads the till: she hears it, and nothing is paid twice', async () => {
    let release
    const checkout = vi.spyOn(SR5Shop, 'checkout').mockImplementation(() => new Promise(resolve => {
      release = resolve
    }))
    const first = cash()
    await settled()
    expect(await cash()).toBe(false)
    expect(relayed).toHaveBeenCalledWith('shopVendorNotice', {
      level: 'warn', key: 'SR5.ShopCashBusy'
    }, 'pl')
    release(true)
    expect(await first).toBe(true)
    expect(await cash()).toBe(false)
    expect(checkout).toHaveBeenCalledOnce()
  })

  it('the Essence question of a gamemaster goes to the one who clicked, with the till stopped', async () => {
    const asked = []
    vi.spyOn(SR5Shop, 'screenLines').mockResolvedValue({
      lines: [], confirmed: false
    })
    expect(await SR5Shop.essenceAllows({
      name: 'W', items: [], system: {
        essence: {
          value: 0.1
        }
      }
    }, [{
      type: 'itemAugmentation', name: 'x', system: {
        essenceCost: {
          value: 1, base: 1
        }, type: 'cyberware', isActive: true
      }, grade: null, quantity: 1
    }], {
      isGM: true, ask: q => asked.push(q)
    })).toBe(false)
    expect(confirm).not.toHaveBeenCalled()
    expect(asked[0]).toMatchObject({
      kind: 'essence', name: 'W'
    })
  })

  it('counts the GreyWare chosen at the till and the GreyWare on the counter', () => {
    expect(SR5Shop.greywareCount([{
      grade: 'greyware', quantity: 2
    }, {
      grade: null, system: {
        grade: 'greyware'
      }, quantity: 1
    }, {
      grade: 'alphaware', system: {
        grade: 'greyware'
      }, quantity: 5
    }, {
      system: {
      }
    }])).toBe(3)
  })

  it('says so when the buyer of the card is gone', async () => {
    buyer = null
    expect(await cash()).toBe(false)
    expect(whispers).toHaveLength(1)
    expect(whispers[0].whisper).toContain('pl')
    expect(whispers[0].content).toContain('SR5.WARN_ShopCardBuyerGone')
  })
})
