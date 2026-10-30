import {
  describe, it, expect, vi
} from "vitest"

// A GM tester (29/10): "unlock the ambient noise and the background count to enter custom values". The noise of a
// scene or an area template was the sum of two closed lists in a locked field; it is now typed freely, the lists
// and the phenomenon staying as shortcuts that fill it.
globalThis.foundry ??= {
}
foundry.applications ??= {
}
foundry.applications.sheets ??= {
}
class SheetStub {
  static PARTS = {
  }
  static TABS = {
    sheet: {
      tabs: []
    }, ambience: {
    }
  }
  _prepareSubmitData() {
    return {
    }
  }
}
foundry.applications.sheets.SceneConfig ??= SheetStub
foundry.applications.sheets.MeasuredTemplateConfig ??= SheetStub
foundry.utils ??= {
}
foundry.utils.setProperty ??= (obj, path, value) => {
  const keys = path.split(".")
  let o = obj
  for (const k of keys.slice(0, -1)) o = o[k] ??= {
  }
  o[keys.at(-1)] = value
}

const {
  clampSceneNoise, SCENE_NOISE_MAX
} = await import("../modules/system/scene-noise.js")
const {
  clampBackgroundCount
} = await import("../modules/system/background-count.js")
const {
  default: SR5SceneConfig
} = await import("../modules/interface/sceneConfig.js")
const {
  default: SR5MeasuredTemplateConfig
} = await import("../modules/interface/measuredTemplateConfig.js")
const {
  SR5_PrepareRollHelper
} = await import("../modules/rolls/roll-prepare-helpers.js")

const makeForm = (values) => ({
  querySelector: (sel) => {
    const key = /name="([^"]+)"/.exec(sel)?.[1]?.replace("flags.sr5.", "")
    return key in values ? {
      value: values[key]
    } : null
  }
})

const makeSheet = (Sheet, flags) => {
  const sheet = Object.create(Sheet.prototype)
  Object.defineProperty(sheet, "document", {
    value: {
      flags: {
        sr5: flags
      }, setFlag: vi.fn()
    }
  })
  return sheet
}

describe("noise typed freely", () => {
  it("is a whole rating from 0 to 36", () => {
    expect(SCENE_NOISE_MAX).toBe(36)
    expect(clampSceneNoise("12")).toBe(12)
    expect(clampSceneNoise(-3)).toBe(0)
    expect(clampSceneNoise(99)).toBe(36)
    expect(clampSceneNoise(2.7)).toBe(2)
    expect(clampSceneNoise("")).toBe(0)
    expect(clampSceneNoise(null)).toBe(0)
    expect(clampSceneNoise("abc")).toBe(0)
  })

  it("the scene keeps the typed value over the shortcuts", () => {
    const sheet = makeSheet(SR5SceneConfig, {
    })
    const data = sheet._prepareSubmitData(null, makeForm({
      matrixSpam: "1", matrixStatic: "0", matrixNoise: "15"
    }))
    expect(data.flags.sr5.matrixNoise).toBe(15)
  })

  it("the scene bounds a value typed out of range", () => {
    const sheet = makeSheet(SR5SceneConfig, {
    })
    expect(sheet._prepareSubmitData(null, makeForm({
      matrixNoise: "50"
    })).flags.sr5.matrixNoise).toBe(36)
    expect(sheet._prepareSubmitData(null, makeForm({
      matrixNoise: "-4"
    })).flags.sr5.matrixNoise).toBe(0)
  })

  it("a shortcut fills the field without saving", () => {
    const sheet = makeSheet(SR5SceneConfig, {
      matrixNoise: 9
    })
    const field = {
      value: 9
    }
    const form = makeForm({
      matrixSpam: "2", matrixStatic: "3"
    })
    const element = {
      querySelector: (sel) => sel.includes("matrixNoise") ? field : form.querySelector(sel)
    }
    sheet.updateMatrixNoise(element)
    expect(field.value).toBe(5)
    expect(sheet.document.setFlag).not.toHaveBeenCalled()
  })

  it("opening the sheet keeps a typed noise", () => {
    const sheet = makeSheet(SR5SceneConfig, {
      matrixSpam: "2", matrixNoise: 9
    })
    sheet.updateMatrixNoise(makeForm({
    }), true)
    expect(sheet.document.setFlag).not.toHaveBeenCalled()
  })

  it("opening a scene that never had a rating gives it its shortcuts' sum, as before", () => {
    const sheet = makeSheet(SR5SceneConfig, {
      matrixSpam: "2", matrixStatic: "1"
    })
    sheet.updateMatrixNoise(makeForm({
    }), true)
    expect(sheet.document.setFlag).toHaveBeenCalledWith("sr5", "matrixNoise", 3)
  })

  it("the area template keeps the typed value too", () => {
    const sheet = makeSheet(SR5MeasuredTemplateConfig, {
    })
    expect(sheet._prepareSubmitData(null, makeForm({
      matrixSpam: "4", matrixNoise: "11"
    })).flags.sr5.matrixNoise).toBe(11)
    expect(sheet._prepareSubmitData(null, makeForm({
      matrixSpam: "4", matrixStatic: "1"
    })).flags.sr5.matrixNoise).toBe(5)
  })
})

describe("a matrix test reads the typed noise", () => {
  const withScene = (noise) => {
    globalThis.canvas = {
      scene: {
      }
    }
    globalThis.game = {
      scenes: {
        active: {
          getFlag: () => noise
        }
      }
    }
  }

  it("as a malus", () => {
    withScene(17)
    expect(SR5_PrepareRollHelper.getSceneNoise()).toBe(-17)
    withScene("8")
    expect(SR5_PrepareRollHelper.getSceneNoise()).toBe(-8)
  })

  it("never as bonus dice", () => {
    withScene(-5)
    expect(SR5_PrepareRollHelper.getSceneNoise()).toBe(0)
    withScene(undefined)
    expect(SR5_PrepareRollHelper.getSceneNoise()).toBe(0)
  })
})

describe("background count typed freely", () => {
  it("is a whole number from -24 to +24", () => {
    expect(clampBackgroundCount("7")).toBe(7)
    expect(clampBackgroundCount(2.6)).toBe(2)
    expect(clampBackgroundCount(-2.6)).toBe(-2)
    expect(clampBackgroundCount(30)).toBe(24)
    expect(clampBackgroundCount(-30)).toBe(-24)
  })
})
