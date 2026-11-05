import {
  describe, it, expect
} from "vitest"
import {
  SR5_CharacterUtility
} from "../modules/entities/actors/utilityActor.js"
import {
  SR5_EntityHelpers
} from "../modules/entities/helpers.js"
import {
  SR5
} from "../modules/config.js"

// Powerful Swimmer (Shadow Spells p. 27): "La vitesse de nage de l'adepte est doublée (p. 138, SR5), et chaque succès à
// un test de Natation permet de gagner 2 mètres de distance supplémentaire, 4 mètres pour les elfes et les trolls".
// SR5 p. 138: swimming rate = average of Agility and Strength, +1 m per hit (2 for elves and trolls). The Mégapack item
// carried a valueReplace without a value and x2, which did nothing (Rémi#3958): the system had no way to multiply
const power = (effects) => ({
  name: "Nageur surpuissant", type: "itemAdeptPower", id: "p", system: {
    isActive: true, customEffects: Object.fromEntries(effects.map((e, i) => [i, {
      category: "movements", wifi: false, transfer: false, value: null, ...e
    }]))
  }
})
const doubleSwim = power([
  {
    target: "system.movements.swim.movement", type: "multiply", multiplier: 2
  },
  {
    target: "system.movements.swim.extraMovement", type: "multiply", multiplier: 2
  },
])
const plus = (target, value) => ({
  name: "Bonus", type: "itemGear", id: "g", system: {
    isActive: true, customEffects: {
      0: {
        category: "movements", target, type: "value", value, multiplier: null
      }
    }
  }
})

// The swim row prepared as Foundry does: the item effects first, then the bases set by updateMovements (SR5 p. 138)
function swim(items, {
  agility = 4, strength = 4, elfOrTroll = false
} = {
}){
  const swim = {
    movement: {
      base: 0, value: 0, modifiers: []
    }, extraMovement: {
      base: 0, value: 0, modifiers: []
    }
  }
  const actor = {
    type: "actorPc", items, system: {
      movements: {
        swim
      }
    }
  }
  for (const i of items) SR5_CharacterUtility.applyCustomEffects(i, actor)
  swim.movement.base = Math.ceil((strength + agility) / 2)
  swim.extraMovement.base = elfOrTroll ? 2 : 1
  SR5_EntityHelpers.updateValue(swim.movement)
  SR5_EntityHelpers.updateValue(swim.extraMovement)
  return [swim.movement.value, swim.extraMovement.value]
}

describe("multiply effect type", () => {
  it("is offered in the effect editor", () => {
    expect(SR5.customEffectsTypes.multiply).toBe("SR5.Multiply")
  })

  it("doubles the swimming rate and the metres per hit (Shadow Spells p. 27)", () => {
    expect(swim([])).toEqual([4, 1])
    expect(swim([doubleSwim])).toEqual([8, 2])
    // elves and trolls: 4 m per hit
    expect(swim([doubleSwim], {
      elfOrTroll: true
    })).toEqual([8, 4])
  })

  it("doubles after the additions, whatever the order of the items", () => {
    expect(swim([doubleSwim, plus("system.movements.swim.movement", 1)])).toEqual([10, 2])
    expect(swim([plus("system.movements.swim.movement", 1), doubleSwim])).toEqual([10, 2])
  })

  it("does nothing without a factor in figures, or with 1", () => {
    for (const multiplier of [null, "", 1, "abc", 0, -2]) {
      expect(swim([power([{
        target: "system.movements.swim.movement", type: "multiply", multiplier
      }])])).toEqual([4, 1])
    }
  })

  it("two multiplications multiply each other (x2 x2 = x4)", () => {
    expect(swim([doubleSwim, doubleSwim])).toEqual([16, 4])
  })
})
