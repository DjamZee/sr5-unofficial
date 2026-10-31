import {
  describe, it, expect, vi, beforeEach, afterEach
} from "vitest"
import {
  readFileSync
} from "node:fs"
import {
  resolve
} from "node:path"

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
  weaponRatingModifiers, powerAttackAction, magicPowerMigration, isLegacyElementalAttack, elementalAttackMigration, elementalAttackRange
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
    expect([given.system.range.short.base, given.system.range.extreme.base]).toEqual([0, 0])
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

  it("a Natural Weapon of DV (Force)P; Noxious Breath as it is; Corrosive Spit on the Magic", async () => {
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
    expect(byName["Salive corrosive"].damageValue).toMatchObject({
      base: 0, magicMultiplier: 2 
    })
    expect(byName["Salive corrosive"].armorPenetration).toMatchObject({
      base: 0, linkedAttribute: "magic" 
    })
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

describe("the powers that follow the Magic (Maxence, 30/10)", () => {
  const given = async key => (await SR5_CompendiumUtility.modifyBaseSpiritWeapon([weapon(key, [["spiritPower", key]])], 4))[0]

  it.each(["engulfAir", "engulfWater", "engulfFire", "engulfEarth", "corrosiveSpit"])("%s: DV (Magic x 2), AP -(Magic), not the Force (SR5 p. 399, 402)", async key => {
    const {
      system 
    } = await given(key)
    expect(system.damageValue).toMatchObject({
      base: 0, magicMultiplier: 2
    })
    expect(system.armorPenetration).toMatchObject({
      base: 0, linkedAttribute: "magic"
    })
    // Force 4 and a Magic the gamemaster brought to 6
    const actor = {
      specialAttributes: {
        magic: {
          augmented: {
            value: 6
          }
        }
      }
    }
    expect(weaponRatingModifiers(system, actor)).toEqual([
      {
        target: "damageValue", label: "SR5.Magic", value: 12
      },
      {
        target: "armorPenetration", label: "SR5.Magic", value: -6
      },
    ])
  })
})

describe("the action of a power's ranged attack", () => {
  const system = keys => ({
    systemEffects: effects(keys)
  })

  it.each(["noxiousBreath", "corrosiveSpit", "elementalAttack"])("%s is a Complex action (SR5 p. 397, 402, 403)", key => {
    expect(powerAttackAction(system([["spiritPower", key]]))).toEqual({
      type: "complex", value: 1, source: "attack"
    })
  })

  it("reads the effects kept as an object too, and leaves the other weapons to their firing mode", () => {
    expect(powerAttackAction({
      systemEffects: {
        0: {
          category: "spiritPower", value: "noxiousBreath"
        }
      }
    })?.type).toBe("complex")
    // An old Elemental Attack is Complex once the migration, or its handing over, gave it the power's key
    expect(powerAttackAction(system([["baseOwnItem", "fire"]]))).toBeNull()
    expect(powerAttackAction({
    })).toBeNull()
  })

  it("the dialog keeps it when the firing mode is read", () => {
    const dialog = readFileSync(resolve(__dirname, "../modules/rolls/roll-dialog.js"), "utf8")
    expect(dialog.match(/action = dialogData\.combat\.powerAttackAction \?\? SR5_ConverterHelpers\.firingModeToAction/g)).toHaveLength(2)
    expect(dialog).not.toMatch(/action = SR5_ConverterHelpers\.firingModeToAction/)
  })

  it("a weapon on the Physical limit shows it on the card", () => {
    const prepare = readFileSync(resolve(__dirname, "../modules/rolls/roll-prepare-case/rollData-Weapon.js"), "utf8")
    expect(prepare).toMatch(/rollData\.limit\.type = itemData\.accuracy\.isPhysicalLimitBased \? "physicalLimit" : "accuracy"/)
  })
})

describe("a power without a weapon in the compendium (Hermine#5127)", () => {
  const savedUi = globalThis.ui, savedUser = globalThis.game.user
  afterEach(() => {
    globalThis.ui = savedUi
    globalThis.game.user = savedUser
    SR5_CompendiumUtility._warnedPowerWeapons.clear()
  })

  it("tells the gamemaster once per power, and nobody else", () => {
    const warn = vi.fn()
    globalThis.ui = {
      notifications: {
        warn
      }
    }
    globalThis.game.user = {
      isGM: false
    }
    SR5_CompendiumUtility.warnPowerWithoutWeapon("elementalAttack", "Attaque élémentaire")
    expect(warn).not.toHaveBeenCalled()
    globalThis.game.user = {
      isGM: true
    }
    SR5_CompendiumUtility.warnPowerWithoutWeapon("elementalAttack", "Attaque élémentaire")
    SR5_CompendiumUtility.warnPowerWithoutWeapon("elementalAttack", "Attaque élémentaire")
    expect(warn).toHaveBeenCalledTimes(1)
    SR5_CompendiumUtility.warnPowerWithoutWeapon("corrosiveSpit", "Salive corrosive")
    expect(warn).toHaveBeenCalledTimes(2)
  })
})

describe("an Elemental Attack of a compendium without the power's key (Hermine#5127, A3)", () => {
  const old = (name, base, ap, range = 0, keys = [["baseOwnItem", "fire"]]) => ({
    name, type: "itemWeapon", system: {
      systemEffects: effects(keys), damageElement: "fire",
      damageValue: {
        base
      },
      armorPenetration: {
        base: ap
      },
      range: {
        short: {
          base: range
        }, medium: {
          base: range * 2
        }, long: {
          base: range * 3
        }, extreme: {
          base: range * 4
        }
      },
    },
  })
  const name = "Attaque élémentaire (feu)"

  it("is recognized by its name and element, not any weapon of the same element", () => {
    expect(isLegacyElementalAttack(old(name, 8, -4))).toBe(true)
    expect(isLegacyElementalAttack(old("Lance-flammes du MJ", 8, -4))).toBe(false)
    expect(isLegacyElementalAttack(old(name, 0, 0, 0, [["spiritPower", "elementalAttack"]]))).toBe(false)
  })

  it("written from the Force, moves onto the Magic, its key and range included: a Complex action", () => {
    const changes = elementalAttackMigration(old(name, 8, -4, 4), 4)
    expect(changes).toMatchObject({
      "system.damageValue.base": 0, "system.damageValue.magicMultiplier": 2, "system.armorPenetration.linkedAttribute": "magic",
      "system.range.short.base": 0, "system.range.extreme.base": 0,
    })
    expect(powerAttackAction({
      systemEffects: changes["system.systemEffects"]
    })?.type).toBe("complex")
  })

  it("dropped by hand, its zeros move too; a weapon the gamemaster changed stays", () => {
    expect(elementalAttackMigration(old(name, 0, 0), 4)).toMatchObject({
      "system.damageValue.magicMultiplier": 2
    })
    expect(elementalAttackMigration(old(name, 10, -2, 4), 4)).toBeNull()
    expect(elementalAttackMigration(old("Lance-flammes du MJ", 8, -4, 4), 4)).toBeNull()
  })

  it("an attack with the key only gives up a range written from the Force, not the gamemaster's", () => {
    const keyed = [["spiritPower", "elementalAttack"]]
    expect(elementalAttackMigration(old(name, 0, 0, 4, keyed), 4)).toEqual({
      "system.range.short.base": 0, "system.range.medium.base": 0, "system.range.long.base": 0, "system.range.extreme.base": 0,
    })
    expect(elementalAttackMigration(old(name, 0, 0, 7, keyed), 4)).toBeNull()
    expect(elementalAttackMigration(old(name, 0, 0, 0, keyed), 4)).toBeNull()
  })

  it("the range increment is the Magic, unless a range is written (SR5 p. 397)", () => {
    const keyed = [["spiritPower", "elementalAttack"]]
    expect(elementalAttackRange(old(name, 0, 0, 0, keyed).system, 3)).toEqual({
      short: 3, medium: 6, long: 9, extreme: 12
    })
    expect(elementalAttackRange(old(name, 0, 0, 7, keyed).system, 3)).toBeNull()
    expect(elementalAttackRange(old(name, 0, 0).system, 3)).toBeNull()
  })

  it("handed over by an old compendium, it gets the key and follows the Magic", async () => {
    const [given] = await SR5_CompendiumUtility.modifyBaseSpiritWeapon([old(name, 0, 0)], 4)
    expect(given.system.damageValue).toMatchObject({
      base: 0, magicMultiplier: 2
    })
    expect(powerAttackAction(given.system)?.type).toBe("complex")
  })
})

describe("the migration of a spirit's weapons", () => {
  const old = (key, base, ap, multiplier) => ({
    type: "itemWeapon",
    system: {
      systemEffects: effects([["spiritPower", key]]),
      damageValue: {
        base, magicMultiplier: multiplier
      },
      armorPenetration: {
        base: ap
      },
    },
  })

  it("moves a weapon written from the Force onto the Magic", () => {
    expect(magicPowerMigration(old("engulfFire", 8, -4), 4)).toEqual({
      "system.damageValue.base": 0, "system.damageValue.magicMultiplier": 2,
      "system.armorPenetration.base": 0, "system.armorPenetration.linkedAttribute": "magic",
    })
  })

  it("leaves alone a weapon the gamemaster changed, one already moved, and the others", () => {
    expect(magicPowerMigration(old("engulfFire", 10, -4), 4)).toBeNull()
    expect(magicPowerMigration(old("engulfFire", 0, 0, 2), 4)).toBeNull()
    expect(magicPowerMigration(old("naturalWeapon", 8, -4), 4)).toBeNull()
    expect(magicPowerMigration(old("engulfFire", 0, 0), 0)).toBeNull()
  })
})
