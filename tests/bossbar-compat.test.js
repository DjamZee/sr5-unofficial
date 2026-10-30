import {
  describe, it, expect, beforeEach, afterEach
} from "vitest"
import {
  bossBarMonitor, prepareBossBar, BOSS_BAR_PATHS
} from "../modules/system/bossbar-compat.js"

const box = (max, damage) => ({
  value: max, actual: {
    value: damage
  }
})

const pc = (physical, stun) => ({
  conditionMonitors: {
    physical: box(10, physical), stun: box(10, stun), overflow: box(4, 0)
  }
})

describe("Boss Bar: the bar of SR5 monitors", () => {
  it("prepares nothing while the setting is off", () => {
    expect(bossBarMonitor(pc(3, 0), "off")).toBeNull()
    expect(bossBarMonitor(pc(3, 0), undefined)).toBeNull()
  })

  it("shows the Physical boxes left of a character", () => {
    expect(bossBarMonitor(pc(3, 8), "physical")).toEqual({
      value: 7, max: 10
    })
  })

  it("shows the Stun monitor when it is the more damaged one (SR5 p. 171)", () => {
    expect(bossBarMonitor(pc(3, 8), "worst")).toEqual({
      value: 2, max: 10
    })
    expect(bossBarMonitor(pc(6, 1), "worst")).toEqual({
      value: 4, max: 10
    })
  })

  it("compares the shares left, not the boxes, when the monitors differ in size", () => {
    const system = {
      conditionMonitors: {
        physical: box(12, 6), stun: box(9, 4)
      }
    }
    // Physical 6/12 = 50 % left, Stun 5/9 = 56 % left
    expect(bossBarMonitor(system, "worst")).toEqual({
      value: 6, max: 12
    })
  })

  it("reads the single monitor of a grunt or a vehicle", () => {
    const system = {
      conditionMonitors: {
        condition: box(11, 4)
      }
    }
    expect(bossBarMonitor(system, "physical")).toEqual({
      value: 7, max: 11
    })
    expect(bossBarMonitor(system, "worst")).toEqual({
      value: 7, max: 11
    })
  })

  it("reads the Matrix monitor of a device, a sprite or an agent", () => {
    expect(bossBarMonitor({
      conditionMonitors: {
        matrix: box(10, 10)
      }
    }, "physical")).toEqual({
      value: 0, max: 10
    })
  })

  it("never goes below zero nor beyond the monitor", () => {
    expect(bossBarMonitor(pc(14, 0), "physical")).toEqual({
      value: 0, max: 10
    })
    expect(bossBarMonitor(pc(-2, 0), "physical")).toEqual({
      value: 10, max: 10
    })
  })

  it("gives no bar to an actor without a monitor", () => {
    expect(bossBarMonitor({
    }, "physical")).toBeNull()
    expect(bossBarMonitor({
      conditionMonitors: {
        physical: box(0, 0)
      }
    }, "physical")).toBeNull()
  })

  it("points the module at the prepared bar, in boxes left", () => {
    expect(BOSS_BAR_PATHS).toEqual({
      currentHpPath: "bossBar.value", maxHpPath: "bossBar.max", woundsSystem: false
    })
  })
})

describe("Boss Bar: prepared only when the module is active and the setting on", () => {
  let saved
  beforeEach(() => {
    saved = globalThis.game
  })
  afterEach(() => {
    globalThis.game = saved
  })
  const world = (active, mode) => {
    globalThis.game = {
      modules: {
        get: () => ({
          active
        })
      },
      settings: {
        get: () => mode
      },
    }
  }

  it("writes system.bossBar when both are", () => {
    world(true, "physical")
    const actor = {
      system: pc(2, 0)
    }
    prepareBossBar(actor)
    expect(actor.system.bossBar).toEqual({
      value: 8, max: 10
    })
  })

  it("leaves the actor untouched otherwise", () => {
    for (const [active, mode] of [[false, "physical"], [true, "off"], [true, "unknown"]]) {
      world(active, mode)
      const actor = {
        system: pc(2, 0)
      }
      prepareBossBar(actor)
      expect(actor.system.bossBar).toBeUndefined()
    }
  })

  it("takes the bar away once the setting is turned off", () => {
    world(true, "physical")
    const actor = {
      system: pc(2, 0)
    }
    prepareBossBar(actor)
    world(true, "off")
    prepareBossBar(actor)
    expect("bossBar" in actor.system).toBe(false)
  })
})
