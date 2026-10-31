/**
 * A weapon whose DV or AP follows its bearer's ratings: the engulf of a spirit or an entity, VD (Magie x 2) and
 * PA -(Magie) (SR5 p. 399), and the natural weapons of the extraplanar entities, "VD (FOR + 2)P, PA -FOR" or
 * "PA -Puissance" (Howling Shadows p. 128 and following, the Erinye p. 138). A spirit's Magic is its Force.
 *
 * Read on the bearer at every preparation, never written into the weapon: a Force chosen again, or a Strength
 * raised by a power, changes the weapon at once.
 *
 * @param {object} itemData The weapon's system data
 * @param {object} actorData The bearer's system data
 * @param {boolean} astral True when the weapon is wielded in the astral, where Charisma stands for Strength
 * @returns {{target: string, label: string, value: number}[]} Modifiers for damageValue and armorPenetration
 */
export function weaponRatingModifiers(itemData, actorData, astral = false) {
  const modifiers = []
  const magic = Number(actorData?.specialAttributes?.magic?.augmented?.value) || 0
  const strength = Number(actorData?.attributes?.[astral ? "charisma" : "strength"]?.augmented?.value) || 0
  const strengthLabel = astral ? "SR5.Charisma" : "SR5.Strength"

  const multiplier = Number(itemData?.damageValue?.magicMultiplier) || 0
  if (multiplier > 0 && magic) modifiers.push({
    target: "damageValue", label: "SR5.Magic", value: magic * multiplier
  })

  switch (itemData?.armorPenetration?.linkedAttribute) {
    case "strength":
      if (strength) modifiers.push({
        target: "armorPenetration", label: strengthLabel, value: -strength
      })
      break
    case "magic":
      if (magic) modifiers.push({
        target: "armorPenetration", label: "SR5.Magic", value: -magic
      })
      break
  }
  return modifiers
}

/**
 * Makes a weapon of a spirit power follow its bearer's Magic: DV (Magic x 2), AP -(Magic).
 * @param {object} system The weapon's system data, changed in place
 */
export function followMagic(system) {
  system.damageValue.base = 0
  system.damageValue.magicMultiplier = 2
  system.armorPenetration.base = 0
  system.armorPenetration.linkedAttribute = "magic"
}

// The powers whose values the book gives from the Magic, and which were once written from the Force
const MAGIC_POWERS = ["elementalAttack", "corrosiveSpit", "engulfAir", "engulfWater", "engulfFire", "engulfEarth"]

// The ranged attacks of the creature powers, Complex actions whatever the firing mode (SR5 p. 397, 402, 403)
const COMPLEX_RANGED_POWERS = ["elementalAttack", "corrosiveSpit", "noxiousBreath"]

const powerKeys = itemData => Object.values(itemData?.systemEffects ?? {
}).filter(e => e?.category === "spiritPower").map(e => e.value)

const RANGE_STEPS = [["short", 1], ["medium", 2], ["long", 3], ["extreme", 4]]

/**
 * An Elemental Attack from a compendium older than the power's key (Mégapack up to 2.0.27, sr5-compendiums): recognized
 * by its name and its element, as it carries no key of a power. A weapon of the gamemaster's bears another name.
 * @param {object} item The weapon's data
 * @returns {boolean}
 */
export function isLegacyElementalAttack(item) {
  return item?.type === "itemWeapon" && !powerKeys(item.system).length && !!item.system?.damageElement &&
    /^(attaque élémentaire|elemental attack)/i.test(item.name ?? "")
}

/**
 * The range increment of an Elemental Attack, (Magic) metres (SR5 p. 397). A range written on the weapon by the
 * gamemaster stays.
 * @param {object} itemData The weapon's system data
 * @param {number} magic The bearer's Magic
 * @returns {object|null} The four ranges, or null when the weapon does not follow the Magic
 */
export function elementalAttackRange(itemData, magic) {
  if (!powerKeys(itemData).includes("elementalAttack")) return null
  if (RANGE_STEPS.some(([key]) => itemData.range?.[key]?.base)) return null
  return Object.fromEntries(RANGE_STEPS.map(([key, step]) => [key, magic * step]))
}

/**
 * The action of a ranged attack made with a creature power, or null for any other weapon.
 * @param {object} itemData The weapon's system data
 * @returns {{type: string, value: number, source: string}|null}
 */
export function powerAttackAction(itemData) {
  if (!powerKeys(itemData).some(k => COMPLEX_RANGED_POWERS.includes(k))) return null
  return {
    type: "complex", value: 1, source: "attack"
  }
}

/**
 * The migration of a spirit's weapon written from its Force, untouched since: it follows the Magic from now on. A
 * weapon the gamemaster changed is left alone.
 * @param {object} item The weapon's data
 * @param {number} force The spirit's Force
 * @returns {object|null} The changes to apply, or null
 */
export function magicPowerMigration(item, force) {
  const system = item?.system
  if (item?.type !== "itemWeapon" || !system || !force) return null
  if (!powerKeys(system).some(k => MAGIC_POWERS.includes(k))) return null
  if (system.damageValue?.magicMultiplier || system.damageValue?.base !== force * 2 || system.armorPenetration?.base !== -force) return null
  return {
    "system.damageValue.base": 0, "system.damageValue.magicMultiplier": 2,
    "system.armorPenetration.base": 0, "system.armorPenetration.linkedAttribute": "magic",
  }
}

/**
 * The second pass over a spirit's weapons: an old Elemental Attack, its values untouched (written from the Force, or the
 * zeros of a weapon dropped by hand), follows the Magic and gets the power's key, so a Complex action; a range written
 * from the Force gives way to the Magic. What the gamemaster changed is left alone.
 * @param {object} item The weapon's data
 * @param {number} force The spirit's Force
 * @returns {object|null} The changes to apply, or null
 */
export function elementalAttackMigration(item, force) {
  const system = item?.system
  if (item?.type !== "itemWeapon" || !system || !force) return null
  const legacy = isLegacyElementalAttack(item)
  if (!legacy && !powerKeys(system).includes("elementalAttack")) return null
  const changes = {
  }
  const bases = RANGE_STEPS.map(([key]) => system.range?.[key]?.base)
  if (RANGE_STEPS.every(([, step], i) => bases[i] === force * step)) {
    for (const [key] of RANGE_STEPS) changes[`system.range.${key}.base`] = 0
  }
  if (legacy) {
    const dv = system.damageValue?.base, ap = system.armorPenetration?.base
    const written = (dv === force * 2 && ap === -force) || (!dv && !ap)
    if (!written || system.damageValue?.magicMultiplier) return null
    Object.assign(changes, {
      "system.damageValue.base": 0, "system.damageValue.magicMultiplier": 2,
      "system.armorPenetration.base": 0, "system.armorPenetration.linkedAttribute": "magic",
      "system.systemEffects": [...Object.values(system.systemEffects ?? {
      }), {
        category: "spiritPower", value: "elementalAttack"
      }],
    })
  }
  return Object.keys(changes).length ? changes : null
}
