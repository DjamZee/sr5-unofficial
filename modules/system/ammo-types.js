// Custom ammunition types (itemAmmunitionType): those of the world and those of the active compendiums (Mégapack,
// Lite, sr5-compendiums), read by the ammunition menus and by the rolls that apply a type's effects.

// A type is known to the weapons by this slug of its name ("Uranium appauvri" -> "uranium_appauvri")
export function ammoTypeSlug(name){
  return String(name ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "")
}

// The compendium types, loaded once after the world is ready, so that opening a sheet never waits on a pack
let compendiumTypes = []
let loading = null

export async function loadCompendiumAmmoTypes(){
  if (loading) return loading
  loading = (async () => {
    const found = []
    for (const pack of globalThis.game?.packs ?? []){
      if (pack.documentName !== "Item") continue
      const ids = pack.index.filter(e => e.type === "itemAmmunitionType").map(e => e._id)
      if (!ids.length) continue
      try {
        found.push(...await pack.getDocuments({
          _id__in: ids
        }))
      } catch (e) {
        //A pack this user may not read: its types stay out of the menus
        console.warn(`SR5 | Ammunition types of ${pack.collection} not read`, e)
      }
    }
    //The Mégapack, the Lite and sr5-compendiums also hold a copy of each type built in the system ("Normales", "APDS"):
    //the menus offer it already under that name, so only the types the system lacks (Argent, HaDeS…) are kept
    const SR5 = globalThis.CONFIG?.SR5 ?? {
    }
    const builtIn = new Set(Object.values({
      ...SR5.allAmmunitionTypes, ...SR5.grenadeTypes
    }).map(key => globalThis.game.i18n.localize(key).toLowerCase()))
    compendiumTypes = found.filter(item => !builtIn.has(String(item.name).toLowerCase()))
  })()
  try {
    await loading
  } finally {
    loading = null
  }
}

// An edited or reindexed pack: read again (the world's types are read live)
export function sr5HookCompendiumAmmoTypes(pack){
  if (pack?.documentName === "Item") loadCompendiumAmmoTypes()
}

// The world's types first, then those of the compendiums whose name no world type already has: a type imported in the
// world, and maybe changed there, wins over its compendium copy, and the Mégapack and the Lite give the same type once
export function ammoTypeItems(){
  const result = [], slugs = new Set()
  const world = (globalThis.game?.items ?? []).filter(i => i.type === "itemAmmunitionType")
  for (const item of [...world, ...compendiumTypes]){
    const slug = ammoTypeSlug(item.name)
    if (!slug || slugs.has(slug)) continue
    slugs.add(slug)
    result.push(item)
  }
  return result
}

// The real document of a type, read without waiting (an update hook cannot). fromUuidSync gives only the index entry of a
// compendium item out of the pack's cache (system: {source}, or no system at all), never its effects: the types read at
// load stand in for it. null: not known yet, the caller must not write effects from it
export function ammoTypeDocumentSync(uuid){
  if (!uuid) return null
  const found = globalThis.fromUuidSync?.(uuid, {
    strict: false
  })
  if (found instanceof globalThis.foundry.abstract.Document) return found.type === "itemAmmunitionType" ? found : null
  return compendiumTypes.find(i => i.uuid === uuid) ?? null
}

export function findAmmoTypeBySlug(slug){
  if (!slug) return undefined
  return ammoTypeItems().find(i => ammoTypeSlug(i.name) === slug)
}

// The actors were prepared before the compendium types were read: those whose weapon uses a type neither built in nor
// of the world get its effects now
export function refreshCustomAmmoWeapons(){
  if (!compendiumTypes.length) return
  const builtIn = globalThis.CONFIG?.SR5?.allAmmunitionTypes ?? {
  }
  const world = new Set((globalThis.game?.items ?? []).filter(i => i.type === "itemAmmunitionType").map(i => ammoTypeSlug(i.name)))
  const usesOne = item => {
    const type = item.type === "itemWeapon" ? item.system?.ammunition?.type : null
    return !!type && !builtIn[type] && !world.has(type)
  }
  const actors = [...(globalThis.game?.actors ?? [])]
  for (const scene of globalThis.game?.scenes ?? []) for (const token of scene.tokens ?? []) if (!token.actorLink && token.actor) actors.push(token.actor)
  for (const actor of actors){
    if (!actor.items?.some?.(usesOne)) continue
    actor.prepareData()
    if (actor.sheet?.rendered) actor.sheet.render()
  }
  for (const item of globalThis.game?.items ?? []) if (usesOne(item)) item.prepareData()
}

// For the tests
export function setCompendiumAmmoTypes(items){
  compendiumTypes = items
}
