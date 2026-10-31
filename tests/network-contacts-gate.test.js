import {
  describe, it, expect, vi, beforeEach, afterEach
} from "vitest"
import {
  networkContactsApi, _socketRunInterest, _socketIntroduction, sendRunInterest, sendIntroduction
} from "../modules/interface/network-contacts/nc-registry.js"

// Hermine#5127 (A4), Aubin#3948 (B1): the setting off, only the window said no. Every entry now gives the same answer.
describe("Network and Contacts turned off", () => {
  const saved = {
    game: globalThis.game, ui: globalThis.ui
  }
  const set = vi.fn()
  let warn
  beforeEach(() => {
    warn = vi.fn()
    set.mockClear()
    globalThis.ui = {
      notifications: {
        warn
      }
    }
    globalThis.game = {
      settings: {
        get: (_, key) => key === "ncEnabled" ? false : [], set
      },
      i18n: {
        localize: k => k
      },
      user: {
        id: "gm", isActiveGM: true
      },
      users: {
        activeGM: {
        }
      },
    }
  })
  afterEach(() => {
    globalThis.game = saved.game
    globalThis.ui = saved.ui
  })

  it.each(["mountNetwork", "mountContacts", "mountFactions"])("%s warns and gives an empty view", async name => {
    const view = await networkContactsApi()[name]({
      main: null, side: null
    })
    expect(warn).toHaveBeenCalledWith("SR5.NC_Disabled")
    expect(() => {
      view.redraw()
      view.unmount()
    }).not.toThrow()
  })

  it("says it is off to the modules", () => {
    expect(networkContactsApi().enabled).toBe(false)
  })

  it("writes nothing from a socket or a direct call", async () => {
    await _socketRunInterest({
      data: {
        runId: "r", actorId: "a"
      }
    }, "p")
    await _socketIntroduction({
      data: {
        contactUuid: "c"
      }
    }, "p")
    await sendRunInterest({
      runId: "r", actorId: "a"
    })
    await sendIntroduction({
      contactUuid: "c"
    })
    expect(set).not.toHaveBeenCalled()
    expect(warn).toHaveBeenCalledTimes(2)
  })
})
