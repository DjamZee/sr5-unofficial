import {
  describe, it, expect, afterEach, vi
} from "vitest"

vi.mock('../modules/socket.js', () => ({
  SR5_SocketHandler: {
  },
}))

const {
  sr5HookUpdateScene
} = await import("../modules/hooks/canvas.js")

// Edmond (01/11): the GM brings a scene's background count from 6 to 4; the player's indicator read 4, their actor kept
// -6 until its next preparation. A player now prepares their own actors again, locally.
const actor = isOwner => ({
  isOwner, prepareData: vi.fn(), sheet: {
    rendered: false, render: vi.fn()
  }
})

describe("sr5HookUpdateScene", () => {
  const savedGame = globalThis.game
  afterEach(() => {
    globalThis.game = savedGame
  })

  const countChange = {
    flags: {
      sr5: {
        backgroundCount: 4
      }
    }
  }

  it("a player prepares their own actors again, once each, not the others'", () => {
    globalThis.game = {
      user: {
        isGM: false
      }
    }
    const own = actor(true), foreign = actor(false)
    sr5HookUpdateScene({
      tokens: [{
        actor: own
      }, {
        actor: own
      }, {
        actor: foreign
      }, {
        actor: null
      }]
    }, countChange)
    expect(own.prepareData).toHaveBeenCalledTimes(1)
    expect(foreign.prepareData).not.toHaveBeenCalled()
  })

  it("a player's rendered sheet shows it", () => {
    globalThis.game = {
      user: {
        isGM: false
      }
    }
    const own = actor(true)
    own.sheet.rendered = true
    sr5HookUpdateScene({
      tokens: [{
        actor: own
      }]
    }, {
      active: true
    })
    expect(own.sheet.render).toHaveBeenCalledTimes(1)
  })

  it("a change that does not reach them costs a player nothing", () => {
    globalThis.game = {
      user: {
        isGM: false
      }
    }
    const own = actor(true)
    sr5HookUpdateScene({
      tokens: [{
        actor: own
      }]
    }, {
      name: "Ailleurs"
    })
    expect(own.prepareData).not.toHaveBeenCalled()
  })

  it("the GM still prepares every actor of the scene", () => {
    globalThis.game = {
      user: {
        isGM: true
      }
    }
    const foreign = actor(false)
    sr5HookUpdateScene({
      tokens: [{
        actor: foreign
      }]
    }, {
      name: "Ailleurs"
    })
    expect(foreign.prepareData).toHaveBeenCalledTimes(1)
  })
})
