import {
  describe, it, expect, vi
} from "vitest"

vi.mock("../modules/socket.js", () => ({
  SR5_SocketHandler: {
    emitForGM: vi.fn(),
  },
}))

const {
  SR5_CharacterUtility
} = await import("../modules/entities/actors/utilityActor.js")

// Solène#5370 (29/10): the attack pools of a sprite read "Logique" or "Intuition" while its defenses read "Niveau". A
// sprite's mental attributes are its Level, which the book names in its tests ("Hardware + Level", SR5 p. 257).

// Any path read gives a pool or a rating: what generateMatrixActions writes is kept, what it reads is worth 4
function autoObject(){
  const store = {
  }
  return new Proxy(store, {
    get(target, key){
      if (key === "modifiers") return target.modifiers ??= []
      if (key === "value") return 4
      if (typeof key === "symbol") return undefined
      if (!(key in target)) target[key] = autoObject()
      return target[key]
    }
  })
}

function actorOfType(type){
  const system = autoObject()
  system.schema = null
  system.matrix.userMode = "ar"
  return {
    type, system, items: []
  }
}

const linkedSources = actor => Object.values(actor.system.matrix.actions)
  .flatMap(a => (a.test?.modifiers ?? []).filter(m => m.type === "linkedAttribute").map(m => m.source))

describe("the Level in a sprite's matrix pools", () => {
  it("a sprite's attack pools name its Level", () => {
    const sprite = actorOfType("actorSprite")
    SR5_CharacterUtility.generateMatrixActions(sprite)
    const sources = linkedSources(sprite)
    expect(sources.length).toBeGreaterThan(10)
    expect(sources.filter(s => s !== "SR5.Level" && s !== "SR5.Resonance")).toEqual([])
  })

  it("a character keeps Logic and Intuition", () => {
    const pc = actorOfType("actorPc")
    SR5_CharacterUtility.generateMatrixActions(pc)
    const sources = linkedSources(pc)
    expect(sources).toContain("SR5.Logic")
    expect(sources).toContain("SR5.Intuition")
    expect(sources).not.toContain("SR5.Level")
  })
})
