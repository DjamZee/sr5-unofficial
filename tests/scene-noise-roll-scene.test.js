import {
  describe, it, expect, afterEach
} from "vitest"
import {
  actorRollScene
} from "../modules/system/scene-noise.js"

// Florentin#8152 (29/10): the indicator read the viewed scene, the roll the active one; with the GM looking at another
// scene the two differed. Both now follow the scene of the rolling token, else the active scene.
const scene = (id, actorIds) => ({
  id, tokens: actorIds.map(actorId => ({
    actorId
  }))
})

describe("actorRollScene", () => {
  const savedCanvas = globalThis.canvas, savedGame = globalThis.game
  afterEach(() => {
    globalThis.canvas = savedCanvas
    globalThis.game = savedGame
  })
  const setScenes = (viewed, active) => {
    globalThis.canvas = {
      scene: viewed
    }
    globalThis.game = {
      scenes: {
        active
      }
    }
  }

  it("reads the viewed scene when the actor has a token there, not the active one", () => {
    const viewed = scene("B", ["a1"]), active = scene("A", ["a1"])
    setScenes(viewed, active)
    expect(actorRollScene({
      id: "a1"
    })).toEqual({
      scene: viewed, hasToken: true
    })
  })

  it("falls back on the active scene when the viewed scene holds no token of the actor", () => {
    const viewed = scene("B", []), active = scene("A", ["a1"])
    setScenes(viewed, active)
    expect(actorRollScene({
      id: "a1"
    })).toEqual({
      scene: active, hasToken: true
    })
  })

  it("an unlinked token's actor reads its own scene", () => {
    const own = scene("C", ["a1"])
    setScenes(scene("B", ["a1"]), scene("A", ["a1"]))
    expect(actorRollScene({
      id: "a1", isToken: true, token: {
        parent: own
      }
    }).scene).toBe(own)
  })

  it("no token anywhere: the active scene, without token", () => {
    const active = scene("A", [])
    setScenes(null, active)
    expect(actorRollScene({
      id: "a1"
    })).toEqual({
      scene: active, hasToken: false
    })
    expect(actorRollScene(undefined)).toEqual({
      scene: active, hasToken: false
    })
  })

  it("no scene at all", () => {
    setScenes(undefined, null)
    expect(actorRollScene({
      id: "a1"
    })).toEqual({
      scene: null, hasToken: false
    })
  })
})
