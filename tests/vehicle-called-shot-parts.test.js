import {
  describe, it, expect
} from "vitest"
import {
  SR5_CalledShotHelpers
} from "../modules/rolls/roll-helpers/calledShot.js"
import {
  applyFlatTires
} from "../modules/entities/actors/utilityActor-rigging.js"
import {
  flatTireCount, flatTirePenalty, VEHICLE_PART_LOCATIONS
} from "../modules/system/vehicle-parts.js"
import {
  CALLED_SHOT_VEHICLE_LOCATIONS
} from "../modules/system/effect-editor.js"
import {
  SR5
} from "../modules/config.js"

const tire = {
  type: "itemEffect", system: {
    type: "tire"
  }
}
const vehicle = (...items) => ({
  items, system: {
  }
})

// SR5 p. 206 (VO p. 205): a tire, a sensor, a window, by the normal called shot rules
describe("called shots against a vehicle part (SR5 p. 206)", () => {
  it("costs the -4 of a called shot, with no DV limit", () => {
    for (const location of VEHICLE_PART_LOCATIONS) {
      expect(SR5_CalledShotHelpers.convertCalledShotToMod(location)).toBe(-4)
      expect(SR5_CalledShotHelpers.convertCalledShotToLimitDV(location)).toBe(0)
      expect(Object.values(SR5_CalledShotHelpers.convertCalledShotToEffect(location))).toEqual([{
        name: location
      }])
    }
  })

  it("is offered among the vehicle locations, with a label and a status", () => {
    for (const location of VEHICLE_PART_LOCATIONS) {
      expect(CALLED_SHOT_VEHICLE_LOCATIONS).toContain(location)
      expect(SR5.calledShotsSpecifics[location]).toBeTruthy()
      expect(SR5.calledShotsEffects[location]).toBeTruthy()
    }
  })
})

describe("flat tires on the piloting tests", () => {
  it("count -2 dice per flat tire, and nothing else", () => {
    expect(flatTirePenalty([])).toBe(0)
    expect(flatTirePenalty([tire])).toBe(-2)
    expect(flatTirePenalty([tire, tire])).toBe(-4)
    expect(flatTireCount([tire, {
      type: "itemEffect", system: {
        type: "axle"
      }
    }, {
      type: "itemGear", system: {
        type: "tire"
      }
    }])).toBe(1)
  })

  it("puts the penalty on the vehicle test, the second tire adding its own", () => {
    const test = {
      base: 0, modifiers: []
    }
    applyFlatTires(vehicle(tire, tire), test)
    expect(test.modifiers).toHaveLength(1)
    expect(test.modifiers[0].value).toBe(-4)
    const intact = {
      base: 0, modifiers: []
    }
    applyFlatTires(vehicle(), intact)
    expect(intact.modifiers).toHaveLength(0)
  })

  it("gives each flat tire its own effect, even when one is already there", async () => {
    const actor = {
      items: [tire]
    }
    const effects = await SR5_CalledShotHelpers.getCalledShotsEffect({
      name: "tire"
    }, {
    }, actor)
    expect(effects).toHaveLength(1)
    expect(effects[0]["system.value"]).toBe(-2)
  })

  it("destroys a sensor or a window once, with the gamemaster's text", async () => {
    for (const part of ["sensor", "window"]) {
      const fresh = await SR5_CalledShotHelpers.getCalledShotsEffect({
        name: part
      }, {
      }, {
        items: []
      })
      expect(fresh).toHaveLength(1)
      expect(fresh[0]["system.durationType"]).toBe("permanent")
      const again = await SR5_CalledShotHelpers.getCalledShotsEffect({
        name: part
      }, {
      }, {
        items: [{
          type: "itemEffect", system: {
            type: part
          }
        }]
      })
      expect(again).toHaveLength(0)
    }
  })
})
