import {
  SR5_SystemHelpers
} from "../../system/utilitySystem.js"

// Where an actor brought out of a sheet goes in the sidebar: a spirit, a drone, a sprite, an agent, a contact, a bag
// put down or left on a body. DjamZ (2026-10-28): next to the sheet that made it, rather than lost at the root.
// A world setting picks between the creator's folder (default), one shared "Temporary actors" folder, and the root.
//
// The sub-actor goes into a folder that already exists, or into the temporary one, made at the root: no folder is
// ever nested deeper, so Foundry's maximum depth (CONST.FOLDER_MAX_DEPTH) cannot be reached by this.

export const SUBACTOR_FOLDER_SETTING = "sr5SubActorFolder"
export const SUBACTOR_FOLDER_MODES = ["creator", "temporary", "root"]
// The temporary folder is found by this flag, not by its name: a GM may rename or translate it
export const TEMPORARY_FOLDER_FLAG = "temporaryActors"

export function registerSubActorFolderSetting() {
  game.settings.register("sr5", SUBACTOR_FOLDER_SETTING, {
    name: "SR5.SETTINGS_SubActorFolder_T",
    hint: "SR5.SETTINGS_SubActorFolder_D",
    scope: "world",
    config: true,
    default: "creator",
    type: String,
    choices: Object.fromEntries(SUBACTOR_FOLDER_MODES.map(mode => [mode, `SR5.SETTINGS_SubActorFolder_${mode}`])),
  })
}

function subActorFolderMode() {
  try {
    const mode = game.settings.get("sr5", SUBACTOR_FOLDER_SETTING)
    return SUBACTOR_FOLDER_MODES.includes(mode) ? mode : "creator"
  } catch {
    return "creator"
  }
}

// The world actor behind a sheet: a token's own actor sits in its base actor's folder; one read from a compendium
// sits in no folder of the world
function worldActorOf(creator) {
  if (!creator || creator.pack) return null
  if (creator.isToken) return creator.token?.baseActor ?? game.actors?.get(creator.id) ?? null
  return creator
}

function creatorFolderId(creator) {
  const folder = worldActorOf(creator)?.folder
  return folder && folder.type === "Actor" && game.folders?.get(folder.id) ? folder.id : null
}

export function findTemporaryFolder() {
  return game.folders?.find(f => f.type === "Actor" && f.getFlag?.("sr5", TEMPORARY_FOLDER_FLAG)) ?? null
}

// Two spirits summoned in the same moment made two folders: one creation at a time
let pendingTemporaryFolder = null

async function temporaryFolderId() {
  const found = findTemporaryFolder()
  if (found) return found.id
  // A player cannot make a folder: the creation goes through the GM (createSidekick socket), and without one the
  // actor stays at the root
  if (!Folder.implementation.canUserCreate(game.user)) return null
  pendingTemporaryFolder ??= Folder.implementation.create({
    name: game.i18n.localize("SR5.SubActorTemporaryFolder"),
    type: "Actor",
    flags: {
      sr5: {
        [TEMPORARY_FOLDER_FLAG]: true
      }
    },
  }).finally(() => pendingTemporaryFolder = null)
  try {
    return (await pendingTemporaryFolder)?.id ?? null
  } catch (e) {
    SR5_SystemHelpers.srLog(1, `Temporary actors folder not created: ${e}`)
    return null
  }
}

/**
 * The folder id a sub-actor made by `creator` goes into, or null for the root. Never throws: a folder that cannot
 * be had leaves the actor at the root, as before.
 */
export async function subActorFolderId(creator) {
  try {
    const mode = subActorFolderMode()
    if (mode === "root") return null
    if (mode === "creator") {
      const id = creatorFolderId(creator)
      if (id) return id
    }
    return await temporaryFolderId()
  } catch (e) {
    SR5_SystemHelpers.srLog(1, `Sub-actor folder not found: ${e}`)
    return null
  }
}

// The actor data with its folder set, for Actor.createDocuments
export async function withSubActorFolder(data, creator) {
  const folder = await subActorFolderId(creator)
  return folder ? {
    ...data, folder
  } : data
}
