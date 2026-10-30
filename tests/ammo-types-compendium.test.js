import {
  describe, it, expect, afterEach
} from "vitest"
import {
  ammoTypeSlug, ammoTypeItems, findAmmoTypeBySlug, setCompendiumAmmoTypes, loadCompendiumAmmoTypes
} from "../modules/system/ammo-types.js"

// Amandine#4927 (29/10): the ammunition menu of a weapon offered a custom type (Argent, HaDeS…) only once imported in the
// world. The menus and the rolls now also read the types of the active compendiums, without duplicates.
const type = (name, extra = {
}) => ({
  name, type: "itemAmmunitionType", uuid: `x.${name}`, system: {
  }, ...extra
})

describe("custom ammunition types", () => {
  const savedGame = globalThis.game, savedConfig = globalThis.CONFIG
  afterEach(() => {
    globalThis.game = savedGame
    globalThis.CONFIG = savedConfig
    setCompendiumAmmoTypes([])
  })

  it("slugs a name as the weapons store it", () => {
    expect(ammoTypeSlug("Uranium appauvri")).toBe("uranium_appauvri")
    expect(ammoTypeSlug("Anti-Véhicule")).toBe("anti_v_hicule")
  })

  it("adds the compendium types to the world's, the world's copy winning", () => {
    const worldArgent = type("Argent", {
      uuid: "Item.w1"
    })
    globalThis.game = {
      items: [worldArgent, {
        name: "Pistolet", type: "itemWeapon"
      }]
    }
    setCompendiumAmmoTypes([type("Argent"), type("HaDeS"), type("HaDeS")])
    expect(ammoTypeItems().map(i => i.uuid)).toEqual(["Item.w1", "x.HaDeS"])
    expect(findAmmoTypeBySlug("hades")?.name).toBe("HaDeS")
    expect(findAmmoTypeBySlug("argent")).toBe(worldArgent)
    expect(findAmmoTypeBySlug("")).toBeUndefined()
  })

  it("loads the packs' types once, leaving out the copies of the built-in types", async () => {
    const docs = [type("Normales"), type("Gaz"), type("Sylvestrine")]
    let asked = null
    const pack = {
      documentName: "Item", collection: "mp.items",
      index: [{
        _id: "a", type: "itemAmmunitionType"
      }, {
        _id: "b", type: "itemWeapon"
      }],
      getDocuments: async query => {
        asked = query
        return docs
      }
    }
    globalThis.CONFIG = {
      SR5: {
        allAmmunitionTypes: {
          regular: "SR5.AmmunitionTypeRegular"
        }, grenadeTypes: {
          gas: "SR5.GrenadeTypeGas"
        }
      }
    }
    globalThis.game = {
      items: [], packs: [pack, {
        documentName: "Actor", index: []
      }],
      i18n: {
        localize: key => ({
          "SR5.AmmunitionTypeRegular": "Normales", "SR5.GrenadeTypeGas": "Gaz"
        })[key] ?? key
      }
    }
    await loadCompendiumAmmoTypes()
    expect(asked).toEqual({
      _id__in: ["a"]
    })
    expect(ammoTypeItems().map(i => i.name)).toEqual(["Sylvestrine"])
  })
})
