import {
  describe, it, expect, vi, beforeAll
} from "vitest"

// Retours d'un MJ qui teste le système (29/10), trois points sur les esprits :
// 1. spirits came without a weapon of their own: every spirit of the book has Unarmed Combat (SR5 p. 305-307), but
//    the compendiums only gave the bare hands to characters and grunts;
// 2. the Magic of a spirit (its Force, SR5 p. 305-307) could not be adjusted: the gamemaster sets an adjustment in his
//    ledger, the Force and everything it gives staying as they are;
// 3. the + of the Foci block on a spirit's sheet created a focus never shown, and a focus dropped was refused.

vi.hoisted(() => {
  globalThis.CONFIG ??= {
  }
  globalThis.foundry.applications.sheets ??= {
  }
  globalThis.foundry.applications.sheets.ActorSheetV2 ??= class {
    _onRender(){}
    async _onDropItem(event, item){
      return item
    }
  }
})
vi.mock("../modules/socket.js", () => ({
  SR5_SocketHandler: {
    emitForGM: vi.fn(),
  },
}))

import {
  readFileSync
} from "node:fs"
import {
  SR5_CompendiumUtility
} from "../modules/entities/actors/utilityCompendium.js"
import {
  SR5_CharacterUtility
} from "../modules/entities/actors/utilityActor.js"
import {
  SR5_EntityHelpers
} from "../modules/entities/helpers.js"
import {
  SPIRIT_VALUES, emptyLedger, spiritEntry, withSpiritTrait, spiritTraitsFor
} from "../modules/system/spirit-ledger.js"

const {
  SR5SpiritSheet
} = await import("../modules/entities/actors/spiritSheet.js")

beforeAll(() => {
  globalThis.game.i18n ??= {
  }
  globalThis.game.i18n.localize ??= key => key
  globalThis.game.i18n.format ??= key => key
})

const weapon = (name, owners, {
  strength = false, spiritPower = null
} = {
}) => ({
  name, type: "itemWeapon",
  system: {
    damageValue: {
      base: 0, isStrengthBased: strength
    },
    armorPenetration: {
      base: 0
    },
    range: {
      short: {
        base: 0
      }, medium: {
        base: 0
      }, long: {
        base: 0
      }, extreme: {
        base: 0
      }
    },
    systemEffects: [...owners.map(value => ({
      category: "baseOwnItem", value
    })), ...(spiritPower ? [{
      category: "spiritPower", value: spiritPower
    }] : [])],
  },
  toObject(){
    return structuredClone({
      name: this.name, type: this.type, system: this.system
    })
  },
})

const bareHands = weapon("Mains nues", ["actorGrunt", "actorPc"], {
  strength: true
})
const engulfAir = weapon("Engloutissement (Air)", ["air"], {
  spiritPower: "engulfAir"
})

describe("1. a new spirit fights bare-handed (SR5 p. 305-307)", () => {
  it("takes the characters' bare hands, after the weapons of its type", () => {
    const given = SR5_CompendiumUtility.addSpiritBareHands([engulfAir.toObject()], [engulfAir, bareHands], "air")
    expect(given.map(i => i.name)).toEqual(["Engloutissement (Air)", "Mains nues"])
    expect(SR5_CompendiumUtility.addSpiritBareHands([], [bareHands], "beasts").map(i => i.name)).toEqual(["Mains nues"])
  })

  it("prefers bare hands marked for spirits, and never gives them twice", () => {
    const own = weapon("Attaque à mains nues (esprit)", ["actorSpirit"], {
      strength: true
    })
    expect(SR5_CompendiumUtility.addSpiritBareHands([], [bareHands, own], "man").map(i => i.name)).toEqual(["Attaque à mains nues (esprit)"])
    expect(SR5_CompendiumUtility.addSpiritBareHands([bareHands.toObject()], [bareHands], "man")).toHaveLength(1)
  })

  it("a watcher, with no physical form, gets none; nor does a weapon whose damage does not follow Strength", () => {
    expect(SR5_CompendiumUtility.addSpiritBareHands([], [bareHands], "watcher")).toEqual([])
    const fixed = weapon("Poing fixe", ["actorPc"])
    expect(SR5_CompendiumUtility.addSpiritBareHands([], [fixed], "man")).toEqual([])
  })

  it("an engulf follows the Magic (SR5 p. 399), the bare hands keep following the Strength", async () => {
    const [engulf, hands] = await SR5_CompendiumUtility.modifyBaseSpiritWeapon([engulfAir.toObject(), bareHands.toObject()], 4)
    expect(engulf.system.damageValue).toMatchObject({
      base: 0, magicMultiplier: 2
    })
    expect(engulf.system.armorPenetration).toMatchObject({
      base: 0, linkedAttribute: "magic"
    })
    expect(hands.system.damageValue.base).toBe(0)
    expect(hands.system.armorPenetration.base).toBe(0)
  })
})

const value = () => ({
  base: 0, value: 0, modifiers: []
})
const attribute = () => ({
  natural: value(), augmented: value()
})
function spirit(force, ledger) {
  globalThis.game.settings = {
    get: (scope, key) => (key === "sr5SpiritLedger" ? ledger : null)
  }
  const attributes = {
  }
  for (const key of ["body", "agility", "reaction", "strength", "willpower", "logic", "intuition", "charisma"]) attributes[key] = attribute()
  const actor = {
    id: "s1", type: "actorSpirit",
    system: {
      type: "man", force: {
        base: force, value: force, modifiers: []
      },
      attributes, specialAttributes: {
        magic: attribute()
      }, essence: value(), initiatives: {
        physicalInit: {
          ...value(), dice: value()
        }
      }, penalties: {
      },
    }
  }
  SR5_CharacterUtility.updateSpiritAttributes(actor)
  return actor
}

describe("2. the gamemaster adjusts the Magic of a spirit", () => {
  it("is a signed value of his ledger, empty by default", () => {
    expect(SPIRIT_VALUES).toContain("magicAdjustment")
    expect(spiritEntry(emptyLedger(), "s1").magicAdjustment).toBeNull()
    expect(spiritEntry(withSpiritTrait(emptyLedger(), "s1", "magicAdjustment", "-2"), "s1").magicAdjustment).toBe(-2)
    expect(spiritEntry(withSpiritTrait(emptyLedger(), "s1", "magicAdjustment", ""), "s1").magicAdjustment).toBeNull()
    // The Edge of a free spirit stays a whole number from 0
    expect(spiritEntry(withSpiritTrait(emptyLedger(), "s1", "freeEdge", -4), "s1").freeEdge).toBe(0)
  })

  it("an unlinked token keeps its world actor's adjustment unless one is set on it", () => {
    let ledger = withSpiritTrait(emptyLedger(), "a1", "magicAdjustment", 2)
    expect(spiritTraitsFor(ledger, "a1", "Scene.x.Token.t").magicAdjustment).toBe(2)
    ledger = withSpiritTrait(ledger, "Scene.x.Token.t", "magicAdjustment", -1)
    expect(spiritTraitsFor(ledger, "a1", "Scene.x.Token.t").magicAdjustment).toBe(-1)
  })

  it("moves the Magic only: without it, the Magic is the Force", () => {
    expect(spirit(5, emptyLedger()).system.specialAttributes.magic.natural.value).toBe(5)
    const adjusted = spirit(5, withSpiritTrait(emptyLedger(), "s1", "magicAdjustment", -2))
    expect(adjusted.system.specialAttributes.magic.natural.value).toBe(3)
    expect(adjusted.system.specialAttributes.magic.natural.modifiers).toEqual([expect.objectContaining({
      value: -2, type: "gmAdjustment"
    })])
    expect(adjusted.system.force.value).toBe(5)
    expect(adjusted.system.essence.value).toBe(5)
    SR5_EntityHelpers.updateValue(adjusted.system.attributes.willpower.natural, 0)
    expect(adjusted.system.attributes.willpower.natural.value).toBe(5)
  })
})

describe("2. the Magic line of a spirit's sheet", () => {
  it("knows its special attribute is the Magic, which the copy the sheet reads lost", () => {
    const source = readFileSync(new URL("../modules/entities/actors/spiritSheet.js", import.meta.url), "utf8")
    expect(source).toContain("context.system.activeSpecialAttribute = this.actor.system.activeSpecialAttribute")
  })

  it("shows the gamemaster alone his adjustment, written to his ledger", () => {
    const template = readFileSync(new URL("../templates/actors/_partials/left-tabs/coreInfos/attributes.hbs", import.meta.url), "utf8")
    const spirit = template.slice(template.indexOf("The Magic of a spirit is its Force"))
    expect(spirit.slice(0, 400)).toMatch(/\{\{#if system\.isGM\}\}\s*<input type="text" class="input sr5-spirit-ledger" data-trait="magicAdjustment"/)
  })
})

describe("3. foci on a spirit's sheet", () => {
  it("are listed for the Foci block", () => {
    const sheet = Object.create(SR5SpiritSheet.prototype)
    const actor = {
      items: [{
        type: "itemFocus", name: "Focus"
      }, {
        type: "itemWeapon", name: "Mains nues"
      }]
    }
    sheet._prepareItems(actor)
    expect(actor.focuses.map(i => i.name)).toEqual(["Focus"])
  })

  it("a focus dropped is created, switched on, where it used to be refused", async () => {
    const created = []
    globalThis.Item = {
      implementation: {
        create: vi.fn(async data => created.push(data) && data)
      }
    }
    globalThis.ui = {
      notifications: {
        info: vi.fn(), warn: vi.fn()
      }
    }
    const sheet = Object.create(SR5SpiritSheet.prototype)
    sheet.actor = {
      isOwner: true, uuid: "Actor.spirit", items: new Map()
    }
    await sheet._onDropItem({
    }, {
      id: "f1", parent: null, toObject: () => ({
        type: "itemFocus", name: "Focus de puissance", system: {
          isActive: false
        }
      })
    })
    expect(created).toHaveLength(1)
    expect(created[0].system.isActive).toBe(true)
    expect(globalThis.ui.notifications.info).not.toHaveBeenCalled()
  })
})
