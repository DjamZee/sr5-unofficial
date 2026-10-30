import {
  describe, it, expect, vi, beforeEach
} from "vitest"

// The weapons of a spirit's powers (DjamZ, 29/10): an optional power chosen at the summoning, or dropped on the sheet
// afterwards, brings its weapon, found in the base weapons by the power's key. Elemental Attack: DV (Magic x 2)P,
// AP -(Magic), range increment (Magic), of the element the gamemaster picks, fire for a spirit of fire (SR5 p. 397);
// Natural Weapon of a spirit of beasts: DV (Force)P (SR5 p. 307); Noxious Breath, a toxin of Power Magic (SR5 p. 403).

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
  SR5_CompendiumUtility
} from "../modules/entities/actors/utilityCompendium.js"
import {
  weaponRatingModifiers
} from "../modules/entities/items/weapon-ratings.js"

const {
  SR5SpiritSheet
} = await import("../modules/entities/actors/spiritSheet.js")

const effects = list => list.map(([category, value]) => ({
  category, value
}))
const weapon = (name, keys, element = "") => ({
  name, type: "itemWeapon",
  system: {
    damageElement: element, damageType: "stun",
    damageValue: {
      base: 0, magicMultiplier: 0, isStrengthBased: false
    },
    armorPenetration: {
      base: 0, linkedAttribute: ""
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
    systemEffects: effects(keys),
  },
  toObject(){
    return structuredClone({
      name: this.name, type: this.type, system: this.system
    })
  },
})
const power = key => ({
  name: key, type: "itemPower", system: {
    systemEffects: effects([["spiritPower", key]])
  }
})

const compendium = [
  weapon("Attaque élémentaire (feu)", [["baseOwnItem", "fire"], ["spiritPower", "elementalAttack"]], "fire"),
  weapon("Attaque élémentaire (électricité)", [["spiritPower", "elementalAttack"]], "electricity"),
  weapon("Attaque élémentaire (froid)", [["spiritPower", "elementalAttack"]], "cold"),
  weapon("Arme naturelle (mêlée)", [["spiritPower", "naturalWeapon"]]),
  weapon("Souffle nocif", [["spiritPower", "noxiousBreath"]], "toxin"),
  weapon("Salive corrosive", [["spiritPower", "corrosiveSpit"]], "acid"),
]

beforeEach(() => {
  vi.restoreAllMocks()
  vi.spyOn(SR5_CompendiumUtility, "getCategoryItems").mockImplementation(async () => compendium)
})

describe("the weapon of a spirit power", () => {
  it("an Elemental Attack of the element the gamemaster picks, following the Magic", async () => {
    const chooseElement = vi.fn(async () => "electricity")
    const [given, ...rest] = await SR5_CompendiumUtility.powerWeapons([power("elementalAttack")], {
      force: 4, spiritType: "air", chooseElement
    })
    expect(rest).toEqual([])
    expect(chooseElement).toHaveBeenCalledWith(["fire", "electricity", "cold"])
    expect(given.name).toBe("Attaque élémentaire (électricité)")
    expect(given.system.damageValue).toMatchObject({
      base: 0, magicMultiplier: 2
    })
    expect(given.system.armorPenetration).toMatchObject({
      base: 0, linkedAttribute: "magic"
    })
    expect(given.system.damageType).toBe("physical")
    expect([given.system.range.short.base, given.system.range.extreme.base]).toEqual([4, 16])
  })

  it("fire for a spirit of fire, without asking", async () => {
    const chooseElement = vi.fn()
    const [given] = await SR5_CompendiumUtility.powerWeapons([power("elementalAttack")], {
      force: 3, spiritType: "fire", chooseElement
    })
    expect(chooseElement).not.toHaveBeenCalled()
    expect(given.system.damageElement).toBe("fire")
  })

  it("none when the window is closed, nor twice when the spirit holds it", async () => {
    expect(await SR5_CompendiumUtility.powerWeapons([power("elementalAttack")], {
      force: 4, spiritType: "water", chooseElement: async () => null
    })).toEqual([])
    const held = compendium[1].toObject()
    expect(await SR5_CompendiumUtility.powerWeapons([power("elementalAttack"), held], {
      force: 4, spiritType: "water", chooseElement: vi.fn()
    })).toEqual([])
  })

  it("a Natural Weapon of DV (Force)P; Noxious Breath as it is; Corrosive Spit as before", async () => {
    const given = await SR5_CompendiumUtility.powerWeapons([power("naturalWeapon"), power("noxiousBreath"), power("corrosiveSpit")], {
      force: 5, spiritType: "beasts"
    })
    const byName = Object.fromEntries(given.map(w => [w.name, w.system]))
    expect(byName["Arme naturelle (mêlée)"]).toMatchObject({
      damageType: "physical", damageValue: {
        base: 5, isStrengthBased: false
      }
    })
    expect(byName["Souffle nocif"].damageValue.base).toBe(0)
    expect(byName["Souffle nocif"].range.short.base).toBe(0)
    expect(byName["Salive corrosive"].damageValue.base).toBe(10)
    expect(byName["Salive corrosive"].armorPenetration.base).toBe(-5)
  })

  it("a power without a weapon brings none, and the compendium is not read", async () => {
    expect(await SR5_CompendiumUtility.powerWeapons([power("fear")], {
      force: 4, spiritType: "air"
    })).toEqual([])
    expect(SR5_CompendiumUtility.getCategoryItems).not.toHaveBeenCalled()
  })

  it("its DV and AP follow the Magic, the gamemaster's adjustment included", async () => {
    const [given] = await SR5_CompendiumUtility.powerWeapons([power("elementalAttack")], {
      force: 4, spiritType: "fire"
    })
    expect(weaponRatingModifiers(given.system, {
      specialAttributes: {
        magic: {
          augmented: {
            value: 3
          }
        }
      }
    })).toEqual([{
      target: "damageValue", label: "SR5.Magic", value: 6
    }, {
      target: "armorPenetration", label: "SR5.Magic", value: -3
    }])
  })
})

describe("the base weapons read from a compendium", () => {
  it("keep every Elemental Attack, which share the power's key; a power stays given once", async () => {
    vi.restoreAllMocks()
    const entry = (w, id) => ({
      _id: id, ...w
    })
    const docs = [entry(compendium[1], "e1"), entry(compendium[2], "e2"), entry(weapon("Souffle nocif bis", [["spiritPower", "noxiousBreath"]]), "n2"), entry(compendium[4], "n1")]
    const pack = {
      collection: "sr5.sr5-megapack-items",
      getIndex: vi.fn(async () => docs),
      getDocuments: vi.fn(async ({
        _id__in
      }) => docs.filter(d => _id__in.includes(d._id))),
    }
    SR5_CompendiumUtility._compendiumCache.clear()
    globalThis.game.settings = {
      get: () => "sr5.sr5-megapack-items"
    }
    globalThis.game.modules = new Map()
    globalThis.game.packs = new Map([[pack.collection, pack]])
    const loaded = await SR5_CompendiumUtility.getCategoryItems("baseWeapons")
    // The first by name wins for a power: « Souffle nocif » before « Souffle nocif bis »
    expect(loaded.map(d => d._id).sort()).toEqual(["e1", "e2", "n1"])
  })
})

describe("a power dropped on a spirit's sheet", () => {
  it("brings its weapon", async () => {
    globalThis.Item = {
      implementation: {
        create: vi.fn(async data => data)
      }
    }
    const createEmbeddedDocuments = vi.fn()
    const sheet = Object.create(SR5SpiritSheet.prototype)
    sheet.actor = {
      isOwner: true, uuid: "Actor.spirit", items: new Map(), createEmbeddedDocuments,
      system: {
        type: "beasts", force: {
          value: 4
        }
      }
    }
    await sheet._onDropItem({
    }, {
      id: "p1", parent: null, toObject: () => ({
        ...power("naturalWeapon"), system: {
          ...power("naturalWeapon").system, actionType: "complex"
        }
      })
    })
    expect(createEmbeddedDocuments).toHaveBeenCalledWith("Item", [expect.objectContaining({
      name: "Arme naturelle (mêlée)"
    })])
    expect(createEmbeddedDocuments.mock.calls[0][1][0].system.damageValue.base).toBe(4)
  })
})
