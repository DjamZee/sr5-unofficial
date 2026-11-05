import {
  describe, it, expect
} from "vitest"
import {
  zeroLockSource, lockAugmentedAtZero
} from "../modules/entities/actors/effect-replace.js"
import {
  SR5_CharacterUtility
} from "../modules/entities/actors/utilityActor.js"
import {
  limitAttributeValue
} from "../modules/entities/actors/poolOnlyAttribute.js"
import {
  uncappedRating
} from "../modules/entities/actors/augmentationCap.js"

// Better Than Bad p. 125, Tétraplégique: "Toutes vos caractéristiques physiques, à l'exception de Constitution, sont
// réduites à 0 [...] Vous ne pouvez tirer aucun bénéfice des augmentations ou améliorations affectant les attributs
// physiques". The Mégapack quality: valueReplace 0 on agility, reaction and strength natural. Measured on the alpha
// (Rémi#3958, 04/11): an implant +1 still gave Agility 0/1
const KEYS = ["body", "agility", "reaction", "strength", "willpower", "logic", "intuition", "charisma"]

const item = (name, type, effects) => ({
  name, type, id: name, system: {
    isActive: true, customEffects: Object.fromEntries(effects.map((e, i) => [i, {
      category: "characterAttributes", multiplier: null, wifi: false, transfer: false, ...e
    }]))
  }
})

const quadriplegic = item("Tétraplégique", "itemQuality", ["agility", "reaction", "strength"].map(k => ({
  target: `system.attributes.${k}.natural`, type: "valueReplace", value: 0
})))
const implant = (key, value) => item(`Implant ${key}`, "itemAugmentation", [{
  target: `system.attributes.${key}.augmented`, type: "value", value
}])
const spell = item("Augmentation d'attribut", "itemSpell", [{
  target: "system.attributes.agility.augmented", type: "value", value: 3
}])
const adept = item("Réflexes améliorés", "itemAdeptPower", [{
  target: "system.attributes.reaction.augmented", type: "value", value: 2
}])
const mysticAptitude = item("Aptitude mystique", "itemQuality", ["body", "agility", "reaction", "strength"].map(k => ({
  target: `system.attributes.${k}.augmented`, type: "valueReplace", value: null
})))
const replaceAugmented = (value) => item("Remplacement", "itemEffect", [{
  target: "system.attributes.agility.augmented", type: "valueReplace", value
}])

// A character prepared as Foundry does: reset, the item effects in the order of the items, then updateAttributes
// (twice, as after the armor encumbrance)
function prepare(items, natural = 4){
  const attributes = Object.fromEntries(KEYS.map(k => [k, {
    natural: {
      base: natural, value: 0, modifiers: []
    }, augmented: {
      base: 0, value: 0, modifiers: []
    }
  }]))
  const actor = {
    type: "actorPc", items, system: {
      attributes, initiatives: {
      }
    }
  }
  for (const i of items) SR5_CharacterUtility.applyCustomEffects(i, actor)
  SR5_CharacterUtility.updateAttributes(actor)
  SR5_CharacterUtility.updateAttributes(actor)
  return attributes
}

const ratings = (attributes, key) => `${attributes[key].natural.value}/${attributes[key].augmented.value}`

describe("Quadriplegic (Better Than Bad p. 125): physical attributes locked at 0", () => {
  it("an implant, a spell, an adept power add nothing, in either order of the items", () => {
    const others = [implant("agility", 1), spell, adept, implant("strength", 2)]
    for (const items of [[quadriplegic, ...others], [...others, quadriplegic]]) {
      const a = prepare(items)
      expect(ratings(a, "agility")).toBe("0/0")
      expect(ratings(a, "reaction")).toBe("0/0")
      expect(ratings(a, "strength")).toBe("0/0")
    }
  })

  it("leaves the mental attributes alone (the quality does not touch them)", () => {
    const a = prepare([quadriplegic, implant("logic", 1)])
    expect(ratings(a, "logic")).toBe("4/5")
  })

  // Arbitrage de DjamZ (05/11): Body keeps its rating, but no augmentation counts while the quality is on the sheet
  it("keeps Body at its natural rating, without augmentation, in either order", () => {
    for (const items of [[quadriplegic, implant("body", 2)], [implant("body", 2), quadriplegic]]) {
      const a = prepare(items)
      expect(ratings(a, "body")).toBe("4/4")
      const locks = a.body.augmented.modifiers.filter(m => m.type === "attributeLock")
      expect(locks).toHaveLength(1)
      expect(locks[0].ceiling).toBe(4)
      expect(locks[0].source).toBe("SR5.AttributeLockedAtNatural")
    }
    expect(ratings(prepare([quadriplegic, implant("body", 2)], 6), "body")).toBe("6/6")
  })

  it("gives the Body augmentations back once the quality is gone", () => {
    expect(ratings(prepare([implant("body", 2)]), "body")).toBe("4/6")
  })

  it("is told by ONE item replacing Agility, Reaction AND Strength with 0", () => {
    const zero = (name, keys) => item(name, "itemQuality", keys.map(k => ({
      target: `system.attributes.${k}.natural`, type: "valueReplace", value: 0
    })))
    // one attribute only (a cyberlimb, another quality): Body untouched
    expect(ratings(prepare([zero("Autre", ["agility"]), implant("body", 2)]), "body")).toBe("4/6")
    // the three, but by two items: no Quadriplegic
    expect(ratings(prepare([zero("A", ["agility", "reaction"]), zero("B", ["strength"]), implant("body", 2)]), "body")).toBe("4/6")
    // the augmented ratings brought down to 0 (a spell, a called shot): no Quadriplegic either
    const augmentedZero = item("Sort", "itemEffect", ["agility", "reaction", "strength"].map(k => ({
      target: `system.attributes.${k}.augmented`, type: "valueReplace", value: 0
    })))
    expect(ratings(prepare([augmentedZero, implant("body", 2)]), "body")).toBe("4/6")
  })

  it("says why on the augmented rating, once", () => {
    const a = prepare([quadriplegic, implant("agility", 1)])
    const locks = a.agility.augmented.modifiers.filter(m => m.type === "attributeLock")
    expect(locks).toHaveLength(1)
    expect(locks[0].ceiling).toBe(0)
  })

  it("shows no augmentation cap on a locked attribute (+6, over the +4 of SR5 p. 96)", () => {
    const a = prepare([quadriplegic, implant("reaction", 3), adept, implant("reaction", 1)])
    expect(a.reaction.augmented.value).toBe(0)
    expect(a.reaction.augmented.modifiers.filter(m => m.type === "augmentationCap")).toHaveLength(0)
  })

  it("holds for the Physical limit even with a pool-only boost (Attribute Boost)", () => {
    const a = prepare([quadriplegic, implant("strength", 2)])
    a.strength.augmented.modifiers.push({
      source: "Boost", type: "itemAdeptPower", value: 2, poolOnly: true
    })
    expect(limitAttributeValue(a.strength)).toBe(0)
    expect(uncappedRating(a.strength, true)).toBe(0)
  })

  it("a replace with 0 on the augmented rating locks it too, whatever comes after", () => {
    const a = prepare([replaceAugmented(0), implant("agility", 2)])
    expect(a.agility.augmented.value).toBe(0)
  })
})

// Relecture de Pauline#4382, 1er tour
describe("Quadriplegic: penalties and later replaces", () => {
  const lower = (key, value) => item(`Diminution ${key}`, "itemEffect", [{
    target: `system.attributes.${key}.augmented`, type: "value", value, forceAdd: true
  }])
  // the form the effect editor offers for a cyberlimb (effect.hbs): valueReplace on the natural Agility and Strength
  const cyberlimb = item("Bras cybernétique", "itemAugmentation", ["agility", "strength"].map(k => ({
    target: `system.attributes.${k}.natural`, type: "valueReplace", value: 5
  })))

  it("a penalty on Body still counts: the ignored augmentations do not absorb it (4 + 4 − 2 = 2)", () => {
    for (const items of [[quadriplegic, implant("body", 2), implant("body", 2), lower("body", -2)],
      [lower("body", -2), implant("body", 2), quadriplegic, implant("body", 2)]]) {
      const a = prepare(items)
      expect(ratings(a, "body")).toBe("4/2")
      // the help keeps the ignored values
      expect(a.body.augmented.modifiers.filter(m => m.ignoredValue === 2)).toHaveLength(2)
    }
  })

  it("a cyberlimb replacing Agility and Strength cannot lift the quality, in either order", () => {
    for (const items of [[quadriplegic, cyberlimb, implant("body", 1)], [cyberlimb, quadriplegic, implant("body", 1)]]) {
      const a = prepare(items)
      expect(ratings(a, "agility")).toBe("0/0")
      expect(ratings(a, "strength")).toBe("0/0")
      expect(ratings(a, "body")).toBe("4/4")
    }
  })

  it("without the quality, the last replace still wins (cyberlimb 5, then 3)", () => {
    const three = item("Bras 3", "itemAugmentation", [{
      target: "system.attributes.agility.natural", type: "valueReplace", value: 3
    }])
    expect(ratings(prepare([cyberlimb, three]), "agility")).toBe("3/3")
    expect(ratings(prepare([three, cyberlimb]), "agility")).toBe("5/5")
  })
})

// Arbitrage de DjamZ (05/11): under Quadriplegic, no extra initiative die and no Physical limit bonus from an augmentation;
// the penalties stay
describe("Quadriplegic: initiative dice and Physical limit", () => {
  const onto = (name, type, target, value) => item(name, type, [{
    category: "initiatives", target, type: "value", value
  }])
  const wired = onto("Réflexes câblés", "itemAugmentation", "system.initiatives.physicalInit.dice", 2)
  const jazzDice = onto("Jazz", "itemDrug", "system.initiatives.physicalInit.dice", 2)
  const jazzLimit = onto("Jazz limite", "itemAugmentation", "system.limits.physicalLimit", 1)
  const limitPenalty = onto("Malus", "itemEffect", "system.limits.physicalLimit", -1)

  // the attributes prepared as before, then the Physical limit and the physical initiative as Foundry works them out
  function full(items, type = "actorPc", profile = null){
    const attributes = prepare(items)
    const system = {
      attributes, essence: {
        value: 6
      }, matrix: {
      }, profileInitiative: profile, limits: {
        physicalLimit: {
          base: 0, value: 0, modifiers: []
        }
      }, initiatives: {
        physicalInit: {
          base: 0, value: 0, modifiers: [], dice: {
            base: 0, value: 0, modifiers: []
          }
        }
      }
    }
    const actor = {
      type, items, system
    }
    for (const i of items) {
      const own = Object.values(i.system.customEffects).filter(e => !e.target.startsWith("system.attributes."))
      if (own.length) SR5_CharacterUtility.applyCustomEffects({
        ...i, system: {
          ...i.system, customEffects: Object.fromEntries(own.map((e, n) => [n, e]))
        }
      }, actor)
    }
    SR5_CharacterUtility.updateLimits(actor)
    SR5_CharacterUtility.updateInitiativePhysical(actor)
    return {
      dice: system.initiatives.physicalInit.dice.value, limit: system.limits.physicalLimit.value,
      diceMods: system.initiatives.physicalInit.dice.modifiers, limitMods: system.limits.physicalLimit.modifiers
    }
  }

  it("keeps 1D6 and the printed Physical limit, in either order of the items", () => {
    // Body 4, Strength and Reaction 0: ceil((0 x 2 + 4 + 0) / 3) = 2
    for (const items of [[quadriplegic, wired, jazzDice, jazzLimit], [wired, jazzDice, jazzLimit, quadriplegic]]) {
      const r = full(items)
      expect(r.dice).toBe(1)
      expect(r.limit).toBe(2)
      expect(r.diceMods.filter(m => m.ignoredValue === 2)).toHaveLength(2)
      expect(r.limitMods.filter(m => m.type === "attributeLock")).toHaveLength(1)
    }
  })

  it("a penalty on the Physical limit still counts", () => {
    expect(full([quadriplegic, jazzLimit, limitPenalty]).limit).toBe(1)
  })

  it("a grunt keeps the dice of its printed profile", () => {
    expect(full([quadriplegic, wired], "actorGrunt", {
      dice: 2
    }).dice).toBe(3)
  })

  it("without the quality, the dice and the limit move as before", () => {
    const r = full([wired, jazzLimit])
    expect(r.dice).toBe(3)
    // ceil((4 x 2 + 4 + 4) / 3) = 6, + 1
    expect(r.limit).toBe(7)
  })
})

describe("a character without the quality is not touched", () => {
  it("augmentations add as before", () => {
    const a = prepare([implant("agility", 1), spell, adept])
    expect(ratings(a, "agility")).toBe("4/8")
    expect(ratings(a, "reaction")).toBe("4/6")
  })

  it("Mystic Aptitude (valueReplace null) locks nothing", () => {
    const a = prepare([mysticAptitude, implant("agility", 1)])
    expect(ratings(a, "agility")).toBe("4/5")
    expect(zeroLockSource(a.agility)).toBeNull()
  })

  it("a replace with another value (2) is no lock", () => {
    const a = prepare([replaceAugmented(2)])
    expect(a.agility.augmented.value).toBe(2)
    expect(zeroLockSource(a.agility)).toBeNull()
  })

  it("lockAugmentedAtZero leaves a malformed rating alone", () => {
    expect(() => lockAugmentedAtZero(undefined, "x")).not.toThrow()
  })
})
