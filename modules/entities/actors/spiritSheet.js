import {
  isAlwaysActive
} from "../items/always-active.js"
import {
  ActorSheetSR5 
} from "./baseSheet.js"
import {
  SR5, SR5_BARRIER_RATINGS
} from "../../config.js"
import {
  SR5_SpiritTypes
} from "../items/spirit-types.js"
import {
  INSECT_RACES, isInsectCaste, insectRaceOptions
} from "../items/insect-races.js"
import {
  SR5_CompendiumUtility
} from "./utilityCompendium.js"

/**
 * An Actor sheet for spirit type actors in the Shadowrun 5 system.
 */
export class SR5SpiritSheet extends ActorSheetSR5 {
  constructor(...args) {
    super(...args)

    this._shownUntrainedSkills = false
    this._filters = {
      skills: ""
    }
  }

  static DEFAULT_OPTIONS = {
    classes: ["app", "window-app", "sr5", "actor", "spirit"],
    position: {
      width: 900, height: 618 
    },
    window: {
      resizable: true 
    },
  }

  static PARTS = {
    sheet: {
      template: "systems/sr5/templates/actors/spirit-sheet.hbs",
      root: true,
      scrollable: [".sr-panel"],
    },
  }

  async _prepareContext(options) {
    const context = await super._prepareContext(options)
    // Set at preparation, not a field of the spirit's model: the copy the sheet reads lost it, and the Magic line
    // showed neither its value nor the gamemaster's adjustment (retour d'un MJ, 29/10)
    context.system.activeSpecialAttribute = this.actor.system.activeSpecialAttribute

    this._prepareItems(context.actor)
    this._prepareSkills(context.actor)
    this._prepareHomunculusMaterials(context)

    return context
  }

  // SR5 p. 301: a homunculus picks its material in the Barrier Ratings table (SR5 p. 198), each shown with its ratings
  _prepareHomunculusMaterials(context) {
    // The templates read the base type, so that custom types based on a watcher or a homunculus behave like them
    context.spiritBaseType = SR5_SpiritTypes.baseType(this.actor.system.type)
    context.singleMonitor = SR5_SpiritTypes.hasSingleMonitor(this.actor.system.type)
    context.isHomunculus = context.spiritBaseType === "homunculus"
    // Insect castes take a race (Dark Terrors p. 22-34); its rules that are not automated are shown as a note
    if (isInsectCaste(context.spiritBaseType)) {
      context.insectRaces = insectRaceOptions()
      const race = INSECT_RACES[this.actor.system.insectRace]
      if (race?.note) context.insectRaceNote = game.i18n.localize(`SR5.InsectRace_${this.actor.system.insectRace}_D`)
    }
    if (!context.isHomunculus) return
    const structure = game.i18n.localize("SR5.Structure"), armor = game.i18n.localize("SR5.VehicleStat_ArmorShort")
    context.homunculusMaterials = {
    }
    for (let [key, ratings] of Object.entries(SR5_BARRIER_RATINGS)) {
      context.homunculusMaterials[key] = `${game.i18n.localize(SR5.barrierTypes[key])} (${structure} ${ratings.structure}, ${armor} ${ratings.armor})`
    }
    context.homunculusMaterials.other = game.i18n.localize("SR5.HomunculusMaterialOther")
  }

  _prepareSkills(actor) {
    const activeSkills = {
    }
    for (let [key, skill] of Object.entries(actor.system.skills)) {
      if (skill.rating.value > 0 || this._shownUntrainedSkills) activeSkills[key] = skill
    }
    actor.system.skills = activeSkills
  }

  _prepareItems(actor) {
    const weapons = []
    const spells = []
    const powers = []
    const externalEffects = []
    const traditions = []
    // The Foci block can be added to a spirit's sheet (retour d'un MJ, 29/10: its + created a focus never shown)
    const focuses = []

    // Iterate through items, allocating to containers
    for (let i of actor.items) {
      if (i.type === "itemSpell") spells.push(i)
      else if (i.type === "itemWeapon") weapons.push(i)
      else if (i.type === "itemPower") powers.push(i)
      else if (i.type === "itemEffect") externalEffects.push(i)
      else if (i.type === "itemTradition") traditions.push(i)
      else if (i.type === "itemFocus") focuses.push(i)
    }

    actor.weapons = weapons
    actor.spells = spells
    actor.powers = powers
    actor.externalEffects = externalEffects
    actor.traditions = traditions
    actor.focuses = focuses
  }

  /** @override */
  async _onDropItemCreate(item) {
    switch(item.type){
      case "itemTradition":
        for (let i of this.actor.items){
          if (i.type === "itemTradition") return ui.notifications.warn(game.i18n.localize('SR5.WARN_OnlyOneTradition'))
        }
        return super._onDropItemCreate(item)
      case "itemWeapon":
        this._activeUnlessOneIs(item, i => i.type === "itemWeapon" && i.system.category === item.system.category)
        return super._onDropItemCreate(item)
      case "itemPower": {
        if (isAlwaysActive(item)) item.system.isActive = true
        const created = await super._onDropItemCreate(item)
        if (!created) return created
        // The weapon the power brings (Elemental Attack, Natural Weapon…), unless the spirit holds it (DjamZ, 29/10)
        const held = [...this.actor.items.values()].map(i => (i.toObject ? i.toObject(false) : i))
        const weapons = await SR5_CompendiumUtility.powerWeapons([...held, item], {
          force: Number(this.actor.system?.force?.value) || 0, spiritType: this.actor.system?.type
        })
        if (weapons.length) await this.actor.createEmbeddedDocuments("Item", weapons)
        return created
      }
      // Switched on, as on a grunt's sheet
      case "itemFocus":
        item.system.isActive = true
        return super._onDropItemCreate(item)
      case "itemSpell":
      case "itemEffect":
        return super._onDropItemCreate(item)
      default:
        ui.notifications.info(game.i18n.localize('SR5.INFO_ForbiddenItemType'))
        return
    }
  }

}
