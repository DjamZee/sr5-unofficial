import {
  describe, it, expect, vi, beforeEach, afterEach
} from "vitest"
import {
  registerNetworkContactsHooks
} from "../modules/interface/network-contacts/nc-registry.js"
import {
  SR5_SocketHandler
} from "../modules/socket.js"
import {
  MATRIX_HOOKS
} from "../modules/system/matrix-hooks.js"
import {
  SR5_EntityHelpers
} from "../modules/entities/helpers.js"

vi.mock("../modules/socket.js", () => ({
  SR5_SocketHandler: {
    emitForGM: vi.fn(async () => {})
  }
}))

// DjamZ, 30/10: the line of a network access comes with the mark really put, no longer at the defense that only offers it
describe("the access line of a host", () => {
  const saved = {
    game: globalThis.game, Hooks: globalThis.Hooks, canvas: globalThis.canvas
  }
  const host = {
    type: "actorDevice", uuid: "Actor.h", system: {
      matrix: {
        deviceType: "host"
      }
    }
  }
  const pc = {
    id: "pc", type: "actorPc", hasPlayerOwner: true
  }
  let hooks
  const flush = async () => {
    await new Promise(resolve => setTimeout(resolve, 0))
  }
  beforeEach(() => {
    hooks = {
    }
    SR5_SocketHandler.emitForGM.mockClear()
    globalThis.Hooks = {
      on: (name, fn) => {
        hooks[name] = fn
      }, once: () => {}
    }
    globalThis.canvas = {
      tokens: {
        get: () => null
      }
    }
    globalThis.game = {
      settings: {
        get: () => true
      },
      modules: new Map(),
      actors: new Map([["pc", pc]]),
      user: {
        isActiveGM: false
      },
      users: {
        activeGM: {
        }
      },
    }
    registerNetworkContactsHooks()
  })
  afterEach(() => {
    Object.assign(globalThis, saved)
  })

  it("does not come from the resolved action, which only offers the mark", () => {
    expect(hooks["sr5.matrixActionResolved"]).toBeUndefined()
  })

  it("comes with a mark put on the host's device", async () => {
    hooks[MATRIX_HOOKS.marksChanged]({
      parent: host
    }, "pc", 1, 0, "mark")
    await flush()
    expect(SR5_SocketHandler.emitForGM).toHaveBeenCalledWith("ncAccessFound", {
      actorId: "pc", host: "Actor.h"
    })
  })

  it("comes with the mark of an unlinked token, read as markItem reads its id, on no matter what scene", async () => {
    const read = vi.spyOn(SR5_EntityHelpers, "getRealActorFromID").mockReturnValue({
      ...pc, isToken: true
    })
    hooks[MATRIX_HOOKS.marksChanged]({
      parent: host
    }, "jetonNonLie", 1, 0, "mark")
    await flush()
    expect(read).toHaveBeenCalledWith("jetonNonLie")
    expect(SR5_SocketHandler.emitForGM).toHaveBeenCalledWith("ncAccessFound", {
      actorId: "pc", host: "Actor.h"
    })
    read.mockRestore()
  })

  it("not with a mark erased, on anything else than a host, or by anyone else than a character", async () => {
    hooks[MATRIX_HOOKS.marksChanged]({
      parent: host
    }, "pc", 0, 1, "mark")
    hooks[MATRIX_HOOKS.marksChanged]({
      parent: {
        type: "actorPc"
      }
    }, "pc", 1, 0, "mark")
    hooks[MATRIX_HOOKS.marksChanged]({
      parent: host
    }, "ice", 1, 0, "mark")
    await flush()
    expect(SR5_SocketHandler.emitForGM).not.toHaveBeenCalled()
  })
})
