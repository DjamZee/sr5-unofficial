import {
  describe, it, expect
} from "vitest"
import {
  reanchorReplaceModifiers, replaceModifierValue, replaceTarget
} from "../modules/entities/actors/effect-replace.js"
import {
  SR5_CharacterUtility
} from "../modules/entities/actors/utilityActor.js"
import {
  SR5_EntityHelpers
} from "../modules/entities/helpers.js"
import {
  vehicleStatusToRemove, VEHICLE_CALLED_SHOT_EFFECTS
} from "../modules/system/vehicle-parts.js"
import {
  CALLED_SHOT_VEHICLE_LOCATIONS
} from "../modules/system/effect-editor.js"

// Run & Gun p. 129, Essieu: "Vitesse réduite à 1". The effect is applied before the base of the attribute is set from
// its natural value: the replace read a base of 0 and Speed 3 became 4
describe("a replacing effect on an attribute whose base is set afterwards", () => {
  const speedWithAxle = natural => {
    const augmented = {
      base: 0, modifiers: []
    }
    // what applyCustomEffects pushes, base still 0
    augmented.modifiers.push({
      source: "Essieu", type: "axle", value: replaceModifierValue(0, 1) * 1, replace: true, replaceTo: 1, replaceMultiplier: 1
    })
    // what updateAttributes does next
    augmented.base = natural
    reanchorReplaceModifiers(augmented)
    SR5_EntityHelpers.updateValue(augmented, 0)
    return augmented.value
  }

  it("brings Speed down to 1, whatever the vehicle's Speed", () => {
    expect(speedWithAxle(3)).toBe(1)
    expect(speedWithAxle(6)).toBe(1)
    expect(speedWithAxle(1)).toBe(1)
  })

  it("leaves a replace without a target value as it was (Mystic Aptitude, a skill Limit)", () => {
    const augmented = {
      base: 4, modifiers: [{
        value: 2, replace: true
      }]
    }
    reanchorReplaceModifiers(augmented)
    expect(augmented.modifiers[0].value).toBe(2)
  })

  it("reads a target only from a value in figures", () => {
    expect(replaceTarget(1)).toBe(1)
    expect(replaceTarget(0)).toBe(0)
    expect(replaceTarget("3")).toBe(3)
    for (const empty of [null, undefined, "", "  ", "abc", NaN]) expect(replaceTarget(empty)).toBeUndefined()
  })

  // Mystic Aptitude (SR5 - Objets) carries four valueReplace with a null value, on Body, Agility, Reaction and Strength:
  // they did nothing before, and the first round of this fix brought the four attributes down to 0
  describe("through applyCustomEffects, then the base set as updateAttributes does", () => {
    // staleBase: the base left by the previous preparation (Foundry prepares an actor many times), modifiers: those
    // already on the attribute when the effect comes
    const run = (value, natural, staleBase = 0, modifiers = []) => {
      const augmented = {
        base: staleBase, value: 0, modifiers: [...modifiers]
      }
      const actor = {
        type: "actorPc", items: [], system: {
          attributes: {
            agility: {
              natural: {
                value: natural
              }, augmented
            }
          }
        }
      }
      SR5_CharacterUtility.applyCustomEffects({
        name: "Effet", type: "itemAdeptPower", id: "x", system: {
          customEffects: {
            0: {
              category: "characterAttributes", target: "system.attributes.agility.augmented", type: "valueReplace", value, multiplier: null
            }
          }
        }
      }, actor)
      augmented.base = natural
      reanchorReplaceModifiers(augmented)
      SR5_EntityHelpers.updateValue(augmented, 0)
      return augmented.value
    }

    it("leaves the attribute alone for a null, empty or missing value (Mystic Aptitude)", () => {
      expect(run(null, 5)).toBe(5)
      expect(run("", 5)).toBe(5)
      expect(run(undefined, 5)).toBe(5)
      // as measured in game: the base of the previous preparation (5) gave -5 and an attribute of 0
      expect(run(null, 5, 5)).toBe(5)
      // and the other modifiers stay (Reaction 5 + 1 of the adept, 6)
      expect(run(null, 5, 5, [{
        source: "Réflexes", type: "itemAdeptPower", value: 1
      }])).toBe(6)
    })

    it("replaces it for a value in figures (Axle: 1)", () => {
      expect(run(1, 5)).toBe(1)
      expect(run("2", 5)).toBe(2)
      expect(run(1, 5, 5)).toBe(1)
      expect(run(1, 3, 3, [{
        source: "Autre", type: "x", value: 2
      }])).toBe(1)
    })
  })
})

describe("the status of a vehicle location goes with its last effect", () => {
  const effect = (id, type) => ({
    id, type: "itemEffect", system: {
      type
    }
  })

  it("covers the nine locations of the vehicle", () => {
    expect([...VEHICLE_CALLED_SHOT_EFFECTS].sort()).toEqual([...CALLED_SHOT_VEHICLE_LOCATIONS].sort())
    expect(VEHICLE_CALLED_SHOT_EFFECTS).toHaveLength(9)
  })

  it("is taken off when the last effect of its type is deleted", () => {
    expect(vehicleStatusToRemove(effect("a", "axle"), [])).toBe("axle")
    expect(vehicleStatusToRemove(effect("a", "tire"), [effect("b", "sensor")])).toBe("tire")
  })

  it("stays while another effect of the same type is left (a second flat tire)", () => {
    expect(vehicleStatusToRemove(effect("a", "tire"), [effect("b", "tire")])).toBeNull()
    // the deleted item itself does not count, if the collection still holds it
    expect(vehicleStatusToRemove(effect("a", "tire"), [effect("a", "tire")])).toBe("tire")
  })

  it("does nothing for an effect that is not a vehicle location", () => {
    expect(vehicleStatusToRemove(effect("a", "stunned"), [])).toBeNull()
    expect(vehicleStatusToRemove({
      id: "a", type: "itemGear", system: {
        type: "axle"
      }
    }, [])).toBeNull()
  })
})
