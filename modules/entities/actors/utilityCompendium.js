import {
  followMagic, isLegacyElementalAttack
} from "../items/weapon-ratings.js"
import {
  SR5_SystemHelpers 
} from "../../system/utilitySystem.js"
import {
  SR5 
} from "../../config.js"
import {
  SR5_SpiritTypes
} from "../items/spirit-types.js"
import {
  isAlwaysActive
} from "../items/always-active.js"
import {
  spriteGivenPowers
} from "./sprite-types.js"
import {
  MEGAPACK_FULL_ID, activeMegapackId, inActiveMegapack
} from "../../system/megapack.js"
import {
  insectRacePowers
} from "../items/insect-races.js"

export class SR5_CompendiumUtility extends Actor {

  /** Actor sub types already reported as arriving with nothing. */
  static _warnedEmptyBaseItems = new Set()

  static _warnedMissingCompendiums = new Set()
  static _warnedPowerWeapons = new Set()
  static _compendiumCache = new Map()
  static _compendiumChoices = {
  }
  // The item compendiums that may be added after the main one (lot 9): every item pack, read at the time it is
  // asked, so that a compendium created during the session can be chosen at once; a saved one since removed stays
  static extraCompendiumChoices() {
    const choices = {
    }
    for (const pack of game.packs?.filter(p => p.documentName === "Item") ?? []) {
      choices[pack.collection] = `${pack.title} (${pack.collection})`
    }
    for (const categoryKey of Object.keys(SR5_CompendiumUtility.CATEGORIES)) {
      for (const id of SR5_CompendiumUtility.getExtraCompendiumIds(categoryKey)) {
        choices[id] ??= game.i18n.format("SR5.SETTINGS.CompendiumMissing", {
          name: id
        })
      }
    }
    return choices
  }

  // Compendiums used to build actors: each one can be chosen by the GM in the system settings.
  // "auto" reads the active Megapack first (full, Lite or the system's own, every kind of item in one pack), then the
  // sr5-compendiums packs of the world language as a fallback (arbitrage de DjamZ, séance H, H18).
  // Items are recognized by their systemEffects (KEY_CATEGORIES), never by their name.
  // With no Megapack active, the full one is named (the missing compendium warning asks for it).
  static get MEGAPACK() {
    const module = activeMegapackId() ?? MEGAPACK_FULL_ID
    return {
      module, pack: `${module}.sr5-megapack-items`
    }
  }

  // The systemEffect categories that name what an item gives an actor. A spirit or sprite power key is
  // given once: the first item found with it wins, so a power the Megapack holds twice is not doubled.
  static KEY_CATEGORIES = ["baseOwnItem", "spiritPower", "spritePower"]
  static UNIQUE_CATEGORIES = ["spiritPower", "spritePower"]
  static SHARED_WEAPON_KEY = "spiritPower:elementalAttack"

  // What the index must carry to choose the items without loading them
  static INDEX_FIELDS = ["type", "system.systemEffects", "system.source"]

  // The order in which a compendium's items are read, so that "first found" is never left to the order of the
  // ids: the core rulebook first (a supplement's namesake gives way to it: Arme naturelle, SR5 p. 396, before
  // Dard caudal, Howling Shadows p. 188), then by name, then by id
  static inKeyOrder(index) {
    const core = entry => (entry.system?.source === "core" ? 0 : 1)
    return [...index].sort((a, b) => core(a) - core(b) ||
      String(a.name ?? "").localeCompare(String(b.name ?? ""), "fr") || String(a._id).localeCompare(String(b._id)))
  }

  static CATEGORIES = {
    creaturePowers: {
      setting: "compendium.creaturePowers", itemType: "itemPower", defaults: ["powers-creatures"]
    },
    spritePowers: {
      setting: "compendium.spritePowers", itemType: "itemSpritePower", defaults: ["powers-sprites"]
    },
    baseWeapons: {
      setting: "compendium.baseWeapons", itemType: "itemWeapon", defaults: ["weapons-melee", "weapons-ranged"]
    },
  }

  static registerSettings() {
    for (const [key, category] of Object.entries(SR5_CompendiumUtility.CATEGORIES)) {
      const label = key.charAt(0).toUpperCase() + key.slice(1)
      game.settings.register("sr5", category.setting, {
        name: `SR5.SETTINGS_Compendium${label}_T`,
        hint: `SR5.SETTINGS_Compendium${label}_D`,
        scope: "world",
        config: true,
        type: String,
        default: "auto",
        // Filled on ready, once compendiums are available
        choices: SR5_CompendiumUtility._compendiumChoices,
        onChange: () => SR5_CompendiumUtility._compendiumCache.clear()
      })
      // The "+": custom compendiums read after the main one (DjamZ, séance du 08/10). The first item found with a
      // power key still wins, so a custom compendium adds powers and weapons without doubling the official ones
      const fields = foundry.data.fields
      game.settings.register("sr5", `${category.setting}Extra`, {
        name: `SR5.SETTINGS_Compendium${label}Extra_T`,
        hint: "SR5.SETTINGS_CompendiumExtra_D",
        scope: "world",
        config: true,
        type: new fields.SetField(new fields.StringField({
          required: true, blank: false, choices: () => SR5_CompendiumUtility.extraCompendiumChoices()
        })),
        default: [],
        onChange: () => SR5_CompendiumUtility._compendiumCache.clear()
      })
    }
  }

  // The extra compendiums of a category, as saved (a Set once read, an array before)
  static getExtraCompendiumIds(categoryKey) {
    const category = SR5_CompendiumUtility.CATEGORIES[categoryKey]
    let value
    try {
      value = game.settings.get("sr5", `${category.setting}Extra`)
    } catch (_err) {
      return []
    }
    return [...(value ?? [])].filter(id => typeof id === "string" && id)
  }

  static refreshCompendiumChoices() {
    const choices = SR5_CompendiumUtility._compendiumChoices
    for (const key of Object.keys(choices)) delete choices[key]
    choices.auto = game.i18n.localize("SR5.SETTINGS.CompendiumAuto")
    for (const pack of game.packs.filter(p => p.documentName === "Item")) {
      choices[pack.collection] = `${pack.title} (${pack.collection})`
    }
    // Keep a saved choice selectable even if its compendium is no longer available
    for (const category of Object.values(SR5_CompendiumUtility.CATEGORIES)) {
      const value = game.settings.get("sr5", category.setting)
      if (!(value in choices)) choices[value] = game.i18n.format("SR5.SETTINGS.CompendiumMissing", {
        name: value
      })
    }
  }

  // The compendiums read for a category, in order: the first that provides a key wins. The main choice (or the
  // official ones), then the extra compendiums added by the GM (lot 9)
  static getCompendiumIds(categoryKey) {
    const ids = SR5_CompendiumUtility.getMainCompendiumIds(categoryKey)
    for (const id of SR5_CompendiumUtility.getExtraCompendiumIds(categoryKey)) if (!ids.includes(id)) ids.push(id)
    return ids
  }

  static getMainCompendiumIds(categoryKey) {
    const category = SR5_CompendiumUtility.CATEGORIES[categoryKey]
    const chosen = game.settings.get("sr5", category.setting)
    if (chosen && chosen !== "auto") return [inActiveMegapack(chosen)]
    const ids = []
    const megapack = SR5_CompendiumUtility.MEGAPACK
    if (activeMegapackId()) ids.push(megapack.pack)
    const language = game.settings.get("core", "language")
    if (!language) SR5_SystemHelpers.srLog(0, "Could not determine core language used in getCompendiumIds()")
    return ids.concat(category.defaults.map(name => `sr5-compendiums.${language}_${name}`))
  }

  //Get the items of a category from its configured compendium(s)
  //Return an array of items
  static async getCategoryItems(categoryKey) {
    // One actor creation asks for the same category several times: read the compendiums once
    const cached = SR5_CompendiumUtility._compendiumCache.get(categoryKey)
    if (cached && (Date.now() - cached.time < 10000)) return cached.documents

    const {
      itemType
    } = SR5_CompendiumUtility.CATEGORIES[categoryKey]
    const ids = SR5_CompendiumUtility.getCompendiumIds(categoryKey)
    const packs = ids.map(id => game.packs.get(id)).filter(Boolean)
    if (!packs.length) {
      // Tell the GM once per session: without it, actors are created without their base items/powers
      SR5_SystemHelpers.srLog(1, `No compendium among '${ids.join(", ")}' found, could not add items to actor`)
      SR5_CompendiumUtility.warnMissingCompendium(ids[0] ?? SR5_CompendiumUtility.MEGAPACK.pack)
      return []
    }

    const documents = []
    const provided = new Set()
    for (const [rank, pack] of packs.entries()) {
      // The Megapack holds every kind of item: read the index, load only the items that give something
      let index
      try {
        index = await pack.getIndex({
          fields: SR5_CompendiumUtility.INDEX_FIELDS
        })
      } catch (err) {
        SR5_SystemHelpers.srLog(1, `Compendium ${pack.collection} could not be indexed: ${err.message}`)
        continue
      }
      // Chosen on the index, then loaded in one request: one request per item took 26 s for the 85 creature powers
      // of a cold Megapack (measured), against half a second for the whole lot
      const chosen = []
      for (const entry of SR5_CompendiumUtility.inKeyOrder(index)) {
        if (entry.type !== itemType) continue
        const keys = SR5_CompendiumUtility.itemKeys(entry)
        if (!keys.length) continue
        // A fallback compendium only adds what the ones before it lack
        if (rank > 0 && keys.every(k => provided.has(k))) continue
        // A power is given once: first found wins. Save the Elemental Attack weapons, which share the power's key, one
        // per element: the gamemaster picks one (powerWeapons)
        if (keys.some(k => provided.has(k) && !(itemType === "itemWeapon" && k === SR5_CompendiumUtility.SHARED_WEAPON_KEY) &&SR5_CompendiumUtility.UNIQUE_CATEGORIES.includes(k.split(":")[0]))) continue
        for (const k of keys) provided.add(k)
        chosen.push(entry._id)
      }
      if (!chosen.length) continue
      const loaded = new Map((await pack.getDocuments({
        _id__in: chosen
      })).map(d => [d.id ?? d._id, d]))
      for (const id of chosen) if (loaded.has(id)) documents.push(loaded.get(id))
    }
    const entry = {
      time: Date.now(), documents
    }
    SR5_CompendiumUtility._compendiumCache.set(categoryKey, entry)
    // Gone once stale: the documents were held until the same category was asked again, for the whole session
    setTimeout(() => {
      if (SR5_CompendiumUtility._compendiumCache.get(categoryKey) === entry) SR5_CompendiumUtility._compendiumCache.delete(categoryKey)
    }, 10000)
    return documents
  }

  //The data of an item given to a new spirit or creature: a power that is always active (always-active.js)
  //comes switched on (arbitrage de DjamZ, H39), so that its effects (Immunity, Armor, Toughness…) count without a click
  static givenItem(item) {
    const data = item.toObject(false)
    if (isAlwaysActive(data)) data.system.isActive = true
    return data
  }

  // The first spirit created after the world loads waited for the Megapack's index (more than 15 s, 4 900 items).
  // The active GM reads it once on ready, in the background: nothing waits for it
  static preloadIndexes() {
    if (!game.user?.isGM || game.users?.activeGM?.id !== game.user.id) return null
    const ids = new Set(Object.keys(SR5_CompendiumUtility.CATEGORIES).flatMap(k => SR5_CompendiumUtility.getCompendiumIds(k)))
    const started = Date.now()
    return Promise.all([...ids].map(id => game.packs.get(id)?.getIndex({
      fields: SR5_CompendiumUtility.INDEX_FIELDS
    }).catch(() => null))).then(() => SR5_SystemHelpers.srLog(3, `Reference compendiums indexed in ${Date.now() - started} ms`))
  }

  //The "category:value" keys an item (or an index entry) carries in its systemEffects
  static itemKeys(item) {
    return Object.values(item.system?.systemEffects ?? {
    }).filter(e => SR5_CompendiumUtility.KEY_CATEGORIES.includes(e?.category) && e.value).map(e => `${e.category}:${e.value}`)
  }

  //Get base items
  static async getBaseItems(actorType, actorSubType, actorLevel, insectRace) {
    let baseItems = []

    if (actorType === "actorPc" || actorType === "actorGrunt") {
      const weapons = await SR5_CompendiumUtility.getCategoryItems("baseWeapons")
      baseItems = await SR5_CompendiumUtility.findBaseItemInCompendium(baseItems, weapons, actorType)
    }

    if (actorType === "actorSpirit") {
      const weapons = await SR5_CompendiumUtility.getCategoryItems("baseWeapons")
      const powers = await SR5_CompendiumUtility.getCategoryItems("creaturePowers")
      // A custom type borrows the natural weapon of the type it is based on.
      const weaponType = SR5_SpiritTypes.baseType(actorSubType) || actorSubType
      baseItems = await SR5_CompendiumUtility.findBaseItemInCompendium(baseItems, weapons, weaponType)
      baseItems = SR5_CompendiumUtility.addSpiritBareHands(baseItems, weapons, weaponType)
      baseItems = await SR5_CompendiumUtility.findBaseSpiritPowersInCompendium(baseItems, powers, actorSubType)
      // The race of an insect spirit gives powers and takes some away (Dark Terrors p. 22-34)
      if (insectRace) baseItems = SR5_CompendiumUtility.applyInsectRacePowers(baseItems, powers, weaponType, insectRace)
      baseItems = await SR5_CompendiumUtility.modifyBaseSpiritWeapon(baseItems, actorLevel)
      // The type's own items, after the Force was written into the inherited weapons: theirs follow the Force by
      // themselves (weapon-ratings.js) and keep what the type says
      baseItems = baseItems.concat(SR5_SpiritTypes.givenItems(actorSubType))
      // The weapons of its base powers (Elemental Attack of a spirit of fire, Engulf…) it does not hold yet
      baseItems = baseItems.concat(await SR5_CompendiumUtility.powerWeapons(baseItems, {
        force: Number(actorLevel) || 0, spiritType: actorSubType
      }))
    }

    if (actorType === "actorSprite") {
      const spritePowers = await SR5_CompendiumUtility.getCategoryItems("spritePowers")
      baseItems = await SR5_CompendiumUtility.findBaseItemInCompendium(baseItems, spritePowers, actorSubType)
      // A type registered by a module may name its own powers (sprite-types.js), wherever they are kept
      baseItems = baseItems.concat(await SR5_CompendiumUtility.givenSpritePowers(actorSubType, baseItems))
      // The Generalist sprite has no power of its own, only two optional ones chosen at compilation (Kill Code
      // p. 110): nothing found in a compendium that does hold sprite powers is the book, not a missing reference
      // The Generalist only: another type without powers still warns the GM (Romane)
      if (!baseItems.length && spritePowers.length && actorSubType === "generalist") return baseItems
    }

    // A spirit or a sprite that comes with nothing at all is almost always a
    // missing or misdirected reference compendium, not a badly written type.
    // Nothing on screen used to say so.
    if (!baseItems.length && (actorType === "actorSpirit" || actorType === "actorSprite")) {
      SR5_CompendiumUtility.warnEmptyBaseItems(actorType, actorSubType)
    }

    return baseItems
  }

  /**
	 * Tell the game master, once per compendium, that a reference compendium
	 * could not be found. Players are not told: it is not theirs to fix.
	 */
  static warnMissingCompendium(compendiumName) {
    if (!game.user?.isGM) return
    if (SR5_CompendiumUtility._warnedMissingCompendiums.has(compendiumName)) return
    SR5_CompendiumUtility._warnedMissingCompendiums.add(compendiumName)
    ui.notifications.warn(game.i18n.format("SR5.WARN_MissingCompendium", {
      name: compendiumName
    }), {
      permanent: true
    })
  }

  /** Tell the game master, once per power, that the compendium has no weapon for it. */
  static warnPowerWithoutWeapon(key, power) {
    if (!game.user?.isGM) return
    if (SR5_CompendiumUtility._warnedPowerWeapons.has(key)) return
    SR5_CompendiumUtility._warnedPowerWeapons.add(key)
    ui.notifications.warn(game.i18n.format("SR5.WARN_PowerWithoutWeapon", {
      power
    }))
  }

  /** Tell the game master, once per actor sub type, that nothing was found. */
  static warnEmptyBaseItems(actorType, actorSubType) {
    if (!game.user?.isGM) return
    const key = `${actorType}.${actorSubType}`
    if (SR5_CompendiumUtility._warnedEmptyBaseItems.has(key)) return
    SR5_CompendiumUtility._warnedEmptyBaseItems.add(key)
    ui.notifications.warn(game.i18n.localize("SR5.WARN_NoBaseItems"))
  }

  /** The powers a registered sprite type gives by UUID, minus those already found by name. Unreadable UUIDs are skipped. */
  static async givenSpritePowers(spriteType, already = [], {
    resolve = uuid => globalThis.fromUuid?.(uuid)
  } = {
  }) {
    const names = new Set(already.map(i => i.name))
    const given = []
    for (const uuid of spriteGivenPowers(spriteType)) {
      let doc = null
      try {
        doc = await resolve(uuid)
      } catch {
        doc = null
      }
      if (!doc || names.has(doc.name)) continue
      names.add(doc.name)
      given.push(SR5_CompendiumUtility.givenItem(doc))
    }
    return given
  }

  static async findBaseItemInCompendium(baseItems, compendium, actorType) {
    for (let i of compendium) {
      let systemEffects = i.system.systemEffects
      if (systemEffects.length) {
        for (let systemEffect of Object.values(systemEffects)) {
          if ((systemEffect.category === "baseOwnItem") && (systemEffect.value === actorType)) {
            let iObject = SR5_CompendiumUtility.givenItem(i)
            baseItems.push(iObject)
          }
        }
      }
    }
    return baseItems
  }

  // Every spirit of the book has Unarmed Combat among its skills (SR5 p. 305-307), but the compendiums only give the
  // bare hands to characters and grunts (retour d'un MJ, 29/10: spirits came without a weapon of their own). A spirit
  // takes the ones marked for it, else the characters' own, recognized by their key and by a damage that follows
  // Strength. A watcher has no physical form (SR5 p. 301)
  static addSpiritBareHands(baseItems, compendium, spiritType) {
    if (spiritType === "watcher") return baseItems
    const bareHands = owner => compendium.filter(i => i.type === "itemWeapon" && i.system?.damageValue?.isStrengthBased &&
      Object.values(i.system.systemEffects ?? {
      }).some(e => e?.category === "baseOwnItem" && e.value === owner))
    const found = bareHands("actorSpirit").length ? bareHands("actorSpirit") : bareHands("actorPc").slice(0, 1)
    const names = new Set(baseItems.map(i => i.name))
    return baseItems.concat(found.filter(i => !names.has(i.name)).map(i => SR5_CompendiumUtility.givenItem(i)))
  }

  // The weapons a spirit power brings, found in the base weapons by the power's key (SR5 p. 396-403): asked by DjamZ
  // on 29/10 for the optional powers, chosen at the summoning or dropped on the sheet afterwards
  static POWER_WEAPON_KEYS = ["elementalAttack", "naturalWeapon", "noxiousBreath", "corrosiveSpit", "engulfAir", "engulfWater", "engulfFire", "engulfEarth"]

  // The weapons whose values the book gives from the spirit's ratings. Elemental Attack: DV (Magic x 2)P, AP -(Magic),
  // range increment (Magic) (SR5 p. 397), read on the Magic at every preparation (weapon-ratings.js), the gamemaster's
  // adjustment included. Engulf, DV (Magic x 2), AP -(Magic) (SR5 p. 399), and
  // Corrosive Spit, DV (Magic x 2)P, AP -(Magic) (SR5 p. 402), the same. Natural Weapon of a spirit of beasts: DV
  // (Force)P, AP - (SR5 p. 307)
  static SHAPED_WEAPONS = {
    elementalAttack: system => {
      followMagic(system)
      system.damageType = "physical"
      for (const key of ["short", "medium", "long", "extreme"]) system.range[key].base = 0
    },
    engulfAir: followMagic,
    engulfWater: followMagic,
    engulfFire: followMagic,
    engulfEarth: followMagic,
    naturalWeapon: (system, force) => {
      system.damageValue.base = force
      system.damageValue.magicMultiplier = 0
      system.damageValue.isStrengthBased = false
      system.armorPenetration.base = 0
      system.damageType = "physical"
    },
    // A toxin whose Power is the Magic (SR5 p. 403, toxins.js): the weapon is kept as it is, its range follows the Body
    noxiousBreath: () => {},
    // Its range follows the Body (utilityItem.js)
    corrosiveSpit: followMagic,
  }

  /**
   * The weapons the powers of a spirit bring, those it holds already left out (by the power's key). An Elemental
   * Attack is of the spirit's element: fire for a spirit of fire, the gamemaster's choice for the others (DjamZ,
   * 29/10); closing the window gives none.
   * @param {object[]} items The spirit's items (data), its powers among them
   * @param {{force: number, spiritType: string, chooseElement?: Function}} options
   * @returns {Promise<object[]>} The weapons' data, to create
   */
  static async powerWeapons(items, {
    force, spiritType, chooseElement = SR5_CompendiumUtility.chooseElement
  }) {
    const held = new Set(items.filter(i => i.type === "itemWeapon").flatMap(i => isLegacyElementalAttack(i) ? ["elementalAttack"] : SR5_CompendiumUtility.spiritPowerKeys(i)))
    const wanted = [...new Set(items.filter(i => i.type === "itemPower").flatMap(i => SR5_CompendiumUtility.spiritPowerKeys(i)))]
      .filter(k => SR5_CompendiumUtility.POWER_WEAPON_KEYS.includes(k) && !held.has(k))
    if (!wanted.length) return []
    const weapons = (await SR5_CompendiumUtility.getCategoryItems("baseWeapons")).filter(i => i.type === "itemWeapon")
    const given = []
    for (const key of wanted) {
      let found = weapons.filter(w => SR5_CompendiumUtility.spiritPowerKeys(w).includes(key))
      // A compendium older than the powers' keys (Mégapack up to 2.0.27): the power stays, without its weapon
      if (!found.length) SR5_CompendiumUtility.warnPowerWithoutWeapon(key, items.find(i => i.type === "itemPower" && SR5_CompendiumUtility.spiritPowerKeys(i).includes(key))?.name ?? key)
      if (key === "elementalAttack" && found.length) {
        const elements = [...new Set(found.map(w => w.system.damageElement).filter(Boolean))]
        const baseType = SR5_SpiritTypes.baseType(spiritType) || spiritType
        // Asked even with a single element found: a spirit of air is never given fire unawares
        const element = (baseType === "fire" && elements.includes("fire")) ? "fire" : await chooseElement(elements)
        found = found.filter(w => w.system.damageElement === element)
      }
      if (!found.length) continue
      given.push(SR5_CompendiumUtility.givenItem(found[0]))
    }
    return SR5_CompendiumUtility.modifyBaseSpiritWeapon(given, force)
  }

  // The gamemaster picks the element of an Elemental Attack (SR5 p. 397: "defined for a specific elemental type").
  // Null when the window is closed
  static async chooseElement(elements) {
    const options = elements.map(e => `<option value="${e}">${game.i18n.localize(SR5.specialDamageTypes[e] ?? e)}</option>`).join("")
    const result = await foundry.applications.api.DialogV2.prompt({
      window: {
        title: game.i18n.localize("SR5.SpiritPowerElementalAttack")
      },
      content: `<p>${game.i18n.localize("SR5.ChooseElementalAttack")}</p><div class="form-group"><select name="element">${options}</select></div>`,
      ok: {
        label: game.i18n.localize("Confirm"), callback: (event, button) => button.form.elements.element.value
      },
      rejectClose: false,
    })
    return result || null
  }

  //Modify weapons based on Force for Spirit; the bare hands keep a damage that follows the spirit's Strength
  static async modifyBaseSpiritWeapon(baseItems, force) {
    for (let i of baseItems) {
      //An Elemental Attack of an old compendium gets its key: it is then the weapon of the power in everything
      if (isLegacyElementalAttack(i)) i.system.systemEffects = [...Object.values(i.system.systemEffects ?? {
      }), {
        category: "spiritPower", value: "elementalAttack"
      }]
      const shaped = i.type === "itemWeapon" && SR5_CompendiumUtility.spiritPowerKeys(i).find(k => k in SR5_CompendiumUtility.SHAPED_WEAPONS)
      if (shaped) SR5_CompendiumUtility.SHAPED_WEAPONS[shaped](i.system, Number(force) || 0)
      else if (i.type === "itemWeapon" && !i.system.damageValue?.isStrengthBased) {
        i.system.damageValue.base = force * 2
        i.system.armorPenetration.base = -force
        i.system.range.short.base = force
        i.system.range.medium.base = force * 2
        i.system.range.long.base = force * 3
        i.system.range.extreme.base = force * 4
      }
    }

    return baseItems
  }

  // Find base powers of a spirit
  static async findBaseSpiritPowersInCompendium(baseItems, compendium, spiritType) {
    let listName = `spiritBasePowers${spiritType}`
    let list
    for (let [key, value] of Object.entries(SR5)) {
      if (key === listName) list = value
    }
    if (!list) return baseItems

    for (let key of Object.keys(list)) {
      for (let i of compendium) {
        let systemEffects = i.system.systemEffects
        if (systemEffects.length) {
          for (let systemEffect of Object.values(systemEffects)) {
            if ((systemEffect.category === "spiritPower") && (systemEffect.value === key)) {
              let iObject = SR5_CompendiumUtility.givenItem(i)
              baseItems.push(iObject)
            }
          }
        }
      }
    }

    return baseItems
  }

  // The power items an insect race gives (flagged, so that a change of race takes them back), without those it
  // takes away (Dark Terrors p. 22-34)
  static insectRacePowerItems(compendium, baseType, insectRace) {
    const {
      added 
    } = insectRacePowers(baseType, insectRace)
    const items = []
    for (const key of added) {
      const found = compendium.find(i => Object.values(i.system.systemEffects ?? {
      }).some(e => e.category === "spiritPower" && e.value === key))
      if (!found) continue
      const iObject = SR5_CompendiumUtility.givenItem(found)
      iObject.flags = foundry.utils.mergeObject(iObject.flags ?? {
      }, {
        sr5: {
          insectRace: insectRace
        }
      })
      items.push(iObject)
    }
    return items
  }

  static spiritPowerKeys(item) {
    return Object.values(item.system?.systemEffects ?? {
    }).filter(e => e?.category === "spiritPower").map(e => e.value)
  }

  static applyInsectRacePowers(baseItems, compendium, baseType, insectRace) {
    const {
      removed 
    } = insectRacePowers(baseType, insectRace)
    const owned = new Set(baseItems.flatMap(i => SR5_CompendiumUtility.spiritPowerKeys(i)))
    const kept = baseItems.filter(i => !SR5_CompendiumUtility.spiritPowerKeys(i).some(k => removed.includes(k)))
    const added = SR5_CompendiumUtility.insectRacePowerItems(compendium, baseType, insectRace)
      .filter(i => !SR5_CompendiumUtility.spiritPowerKeys(i).some(k => owned.has(k)))
    return kept.concat(added)
  }

  //Add optional powers to an array of existing powers based on an itemSpirit
  static async addOptionalSpiritPowersFromItem(baseItems, optionalPowers) {
    let powers = await SR5_CompendiumUtility.getCategoryItems("creaturePowers")

    for (let value of Object.values(optionalPowers)) {
      if (value) {
        for (let i of powers) {
          let systemEffects = i.system.systemEffects
          if (systemEffects.length) {
            for (let systemEffect of Object.values(systemEffects)) {
              if ((systemEffect.category === "spiritPower") && (systemEffect.value === value)) {
                let iObject = SR5_CompendiumUtility.givenItem(i)
                baseItems.push(iObject)
              }
            }
          }
        }
      }
    }

    return baseItems
  }

  //Add optional powers to an array of existing powers based on an itemSprite
  static async addOptionalSpritePowersFromItem(baseItems, optionalPowers) {
    let powers = await SR5_CompendiumUtility.getCategoryItems("spritePowers")

    for (let value of Object.values(optionalPowers)) {
      if (value) {
        for (let i of powers) {
          let systemEffects = i.system.systemEffects
          if (systemEffects.length) {
            for (let systemEffect of Object.values(systemEffects)) {
              if ((systemEffect.category === "spritePower") && (systemEffect.value === value)) {
                let iObject = SR5_CompendiumUtility.givenItem(i)
                baseItems.push(iObject)
              }
            }
          }
        }
      }
    }

    return baseItems
  }
}