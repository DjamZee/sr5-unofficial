import {
  describe, it, expect, afterEach
} from "vitest"
import {
  actorRollScene, indicatorScene
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

  describe("the indicator shows what the one who looks at it would roll", () => {
    const withUser = (viewed, active, user) => {
      setScenes(viewed, active)
      globalThis.game.user = user
    }

    const owned = {
      actor: {
        isOwner: true
      }
    }
    const foreign = {
      actor: {
        isOwner: false
      }
    }
    const placedOn = (id, tokens, actorIds) => ({
      id, tokens: [...tokens, ...actorIds.map(actorId => ({
        actorId, actorLink: true
      }))]
    })
    const character = {
      character: {
        id: "a1"
      }
    }

    it("a player whose character stands elsewhere reads that scene, not the one on screen", () => {
      const viewed = placedOn("B", [foreign], []), active = placedOn("A", [], ["a1"])
      withUser(viewed, active, character)
      expect(indicatorScene()).toBe(active)
      expect(indicatorScene()).toBe(actorRollScene(globalThis.game.user.character).scene)
    })

    it("a token of theirs on the viewed scene, a drone say, keeps that scene (Edmond, D2)", () => {
      const viewed = placedOn("B", [owned], []), active = placedOn("A", [], ["a1"])
      withUser(viewed, active, character)
      expect(indicatorScene()).toBe(viewed)
    })

    // Edmond (01/11): looking through the world's scenes let a token forgotten on an old scene impose its Noise and
    // its background count. The other scenes are not read any more, whatever stands on them
    it("a token on neither the viewed nor the active scene changes nothing: the active scene, no token", () => {
      const viewed = placedOn("B", [], []), active = placedOn("A", [], []), far = placedOn("C", [], ["a1"])
      withUser(viewed, active, character)
      globalThis.game.scenes.find = fn => [viewed, active, far].find(fn)
      expect(actorRollScene(globalThis.game.user.character)).toEqual({
        scene: active, hasToken: false
      })
      expect(indicatorScene()).toBe(active)
    })

    it("a character on the active scene, a token forgotten elsewhere: the active scene", () => {
      const active = placedOn("A", [], ["a1"]), far = placedOn("C", [], ["a1"])
      withUser(active, active, character)
      globalThis.game.scenes.find = fn => [far, active].find(fn)
      expect(actorRollScene(globalThis.game.user.character)).toEqual({
        scene: active, hasToken: true
      })
      expect(indicatorScene()).toBe(active)
    })

    it("a character placed nowhere: what its roll reads, the active scene", () => {
      const viewed = placedOn("B", [], []), active = placedOn("A", [], [])
      withUser(viewed, active, character)
      expect(indicatorScene()).toBe(active)
    })

    it("no character, or no active scene: the viewed scene", () => {
      const viewed = placedOn("B", [], []), active = placedOn("A", [], [])
      withUser(viewed, active, {
      })
      expect(indicatorScene()).toBe(viewed)
      withUser(viewed, null, character)
      expect(indicatorScene()).toBe(viewed)
    })

    it("the gamemaster reads the viewed scene", () => {
      const viewed = placedOn("B", [], []), active = placedOn("A", [], ["a1"])
      withUser(viewed, active, {
        isGM: true, ...character
      })
      expect(indicatorScene()).toBe(viewed)
    })
  })
})
