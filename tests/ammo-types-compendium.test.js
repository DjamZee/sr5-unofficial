import {
  describe, it, expect, afterEach
} from "vitest"
import {
  ammoTypeSlug, ammoTypeItems, ammoTypeDocumentSync, findAmmoTypeBySlug, setCompendiumAmmoTypes, loadCompendiumAmmoTypes
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

  // Hermine#5127 (A1): out of the pack's cache fromUuidSync gives the index entry, whose effects would be written as zeros
  describe("the real document of a type", () => {
    class Document {
      constructor(fields){
        Object.assign(this, fields)
      }
    }
    const savedFoundry = globalThis.foundry, savedFromUuidSync = globalThis.fromUuidSync
    const index = {
      _id: "u", name: "Uranium appauvri", type: "itemAmmunitionType", uuid: "Compendium.m.p.Item.u", system: {
        source: "HT"
      }
    }
    const read = (found) => {
      globalThis.foundry = {
        abstract: {
          Document
        }
      }
      globalThis.fromUuidSync = () => found
      return ammoTypeDocumentSync("Compendium.m.p.Item.u")
    }
    afterEach(() => {
      globalThis.foundry = savedFoundry
      globalThis.fromUuidSync = savedFromUuidSync
    })

    it("takes a document in memory, of the right type only", () => {
      const doc = new Document({
        type: "itemAmmunitionType", system: {
          apMod: -5
        }
      })
      expect(read(doc)).toBe(doc)
      expect(read(new Document({
        type: "itemGear"
      }))).toBeNull()
    })

    it("never takes an index entry for the document: the types read at load stand in, or nothing", () => {
      expect(read(index)).toBeNull()
      expect(read({
        ...index, system: undefined
      })).toBeNull()
      const loaded = type("Uranium appauvri", {
        uuid: index.uuid, system: {
          apMod: -5, damageMod: 1
        }
      })
      setCompendiumAmmoTypes([loaded])
      expect(read(index)).toBe(loaded)
    })
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
