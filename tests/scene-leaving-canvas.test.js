import {
  describe, it, expect, afterEach, vi
} from "vitest"
import {
  actorRollScene, indicatorScene, noteSceneLeavingCanvas, viewedScene
} from "../modules/system/scene-noise.js"

vi.mock('../modules/socket.js', () => ({
  SR5_SocketHandler: {
  },
}))

const {
  sr5HookDeleteScene, sr5HookUpdateSceneLeavingCanvas
} = await import("../modules/hooks/canvas.js")
const {
  SR5_EffectArea
} = await import("../modules/system/effectArea.js")

// Edmond (01/11): the GM deletes or deactivates the active scene while it is watched. Foundry empties the canvas with no
// canvasReady, and canvas.scene names the scene gone until the teardown ends: the indicator stayed at 7/5 and the actor
// kept the background count of the scene, a spell at 6 dice instead of 11 on both clients.
const actor = (id, isOwner = true) => ({
  id, isOwner, items: [], prepareData: vi.fn(), sheet: {
    rendered: false, render: vi.fn()
  }
})
const sceneOf = (id, actors, active = false) => ({
  id, active, tokens: actors.map(a => ({
    actorId: a.id, actorLink: true, actor: a
  }))
})

describe("a scene leaving the canvas", () => {
  const savedGame = globalThis.game, savedCanvas = globalThis.canvas
  afterEach(() => {
    globalThis.game = savedGame
    globalThis.canvas = savedCanvas
    noteSceneLeavingCanvas(null)
  })
  const setWorld = (viewed, actors, scenes = []) => {
    globalThis.canvas = {
      scene: viewed
    }
    globalThis.game = {
      user: {
        isGM: false
      },
      actors: Object.assign([...actors], {
        get: id => actors.find(a => a.id === id)
      }),
      scenes: {
        active: scenes.find(s => s.active) ?? null, get: id => scenes.find(s => s.id === id)
      }
    }
  }

  it("deleted: the rolls and the indicator read no scene, though canvas.scene still names it", () => {
    const a1 = actor("a1"), gone = sceneOf("A", [a1], true)
    setWorld(gone, [a1])
    sr5HookDeleteScene(gone)
    expect(globalThis.canvas.scene).toBe(gone)
    expect(viewedScene()).toBeNull()
    expect(actorRollScene(a1)).toEqual({
      scene: null, hasToken: false
    })
    expect(indicatorScene()).toBeNull()
  })

  it("deleted: each client prepares its own actors again, once each, not the others'", () => {
    const mine = actor("a1"), theirs = actor("a2", false), gone = sceneOf("A", [mine, mine, theirs], true)
    setWorld(gone, [mine, theirs])
    sr5HookDeleteScene(gone)
    expect(mine.prepareData).toHaveBeenCalledTimes(1)
    expect(theirs.prepareData).not.toHaveBeenCalled()
  })

  it("deleted while another scene is on the canvas: that one stays the viewed scene", () => {
    const a1 = actor("a1"), viewed = sceneOf("B", [a1]), gone = sceneOf("A", [a1], true)
    setWorld(viewed, [a1], [viewed])
    sr5HookDeleteScene(gone)
    expect(viewedScene()).toBe(viewed)
    expect(actorRollScene(a1).scene).toBe(viewed)
  })

  it("deactivated with no other active: read as gone", () => {
    const a1 = actor("a1"), left = sceneOf("A", [a1])
    setWorld(left, [a1], [left])
    sr5HookUpdateSceneLeavingCanvas(left, {
      active: false
    })
    expect(viewedScene()).toBeNull()
    expect(actorRollScene(a1).scene).toBeNull()
  })

  it("deactivated for another scene, or another change: canvas.scene is left to the next draw", () => {
    const a1 = actor("a1"), left = sceneOf("A", [a1]), next = sceneOf("B", [a1], true)
    setWorld(left, [a1], [left, next])
    sr5HookUpdateSceneLeavingCanvas(left, {
      active: false
    })
    expect(viewedScene()).toBe(left)
    setWorld(left, [a1], [left])
    sr5HookUpdateSceneLeavingCanvas(left, {
      flags: {
      }
    })
    expect(viewedScene()).toBe(left)
  })

  it("a scene deactivated and viewed again is read again once drawn (canvasInit lifts the note)", () => {
    const a1 = actor("a1"), left = sceneOf("A", [a1])
    setWorld(left, [a1], [left])
    sr5HookUpdateSceneLeavingCanvas(left, {
      active: false
    })
    noteSceneLeavingCanvas(null)
    expect(viewedScene()).toBe(left)
  })

  it("a template of a scene gone stops counting on a linked actor, one of the active scene does not", () => {
    const item = sceneId => ({
      type: "itemEffect", system: {
        type: "areaEffect", ownerItem: `Scene.${sceneId}.MeasuredTemplate.t1`, customEffects: {
          0: {
            target: "system.magic.bgCount"
          }
        }
      }
    })
    const active = sceneOf("B", [], true)
    setWorld(null, [], [active])
    expect(SR5_EffectArea.isPreparedAreaEffectOffScene(item("A"), {
      isToken: false
    })).toBe(true)
    expect(SR5_EffectArea.isPreparedAreaEffectOffScene(item("B"), {
      isToken: false
    })).toBe(false)
  })
})
