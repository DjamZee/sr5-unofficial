//Effects that REPLACE a value instead of adding to it (valueReplace, ratingReplace, hitsReplace, netHitsReplace).
//Animal Sense and Eyes of the Pack (Street Grimoire p. 106) make the net hits the Limit of Perception; the No Future
//instruments (No Future p. 152) give the Limit of Performance.

export function isReplaceEffectType(type){
  return typeof type === "string" && type.endsWith("Replace")
}

//The value an effect gave in place of the computed one, read from the modifiers, or undefined. Two of them (two
//instruments) keep the highest
export function replacedValue(modifiers){
  if (!Array.isArray(modifiers)) return undefined
  const values = modifiers.filter(m => m?.replace).map(m => Number(m.value) || 0)
  return values.length ? Math.max(...values) : undefined
}

//The modifier a replacing effect leaves on its target. A target whose base is a number (an attribute, the Limit of a
//sense) keeps "− base + value", so that base + modifiers gives the value; a skill Limit has the KEY of its linked Limit
//as base ("socialLimit"), a text: its modifier is the value itself, read by replacedValue()
export function replaceModifierValue(base, value){
  if (typeof base !== "number") return value
  return -Math.max(base, 0) + value
}

//The base of an attribute (character or vehicle) is only set from its natural value AFTER the item effects: a replacing
//effect then read a base of 0, and the Axle called shot ("Vitesse réduite à 1", Run & Gun p. 129) gave Speed 3 + 1 = 4.
//The modifier keeps the value it aims at (replaceTo); once the base is known, it is worked out again against it
//The value a replacing effect aims at, only when it is written in figures (a number, or a text that reads as one);
//null, "", a missing or unreadable value give undefined: no target, nothing worked out again
export function replaceTarget(value){
  if (value === null || value === undefined) return undefined
  if (typeof value === "string" && value.trim() === "") return undefined
  const n = Number(value)
  return Number.isFinite(n) ? n : undefined
}

export function reanchorReplaceModifiers(property){
  if (typeof property?.base !== "number" || !Array.isArray(property.modifiers)) return
  for (const m of property.modifiers) {
    if (!m?.replace || typeof m.replaceTo !== "number") continue
    const value = replaceModifierValue(property.base, m.replaceTo) * m.replaceMultiplier
    if (!isNaN(value)) m.value = value
  }
}

//Quadriplegic (Better Than Bad p. 125): the physical attributes but Body are "réduites à 0", and the character "ne
//peut tirer aucun bénéfice des augmentations ou améliorations affectant les attributs physiques". The quality replaces
//the natural rating with 0; an implant, a spell, an adept power or a drug still added to the augmented one, and a replace
//on the augmented rating depended on the order of the items. An attribute an effect replaces with 0 (natural or
//augmented) is locked: the source of that effect, or null. A replace without a value in figures (Mystic Aptitude: null)
//has no replaceTo and locks nothing
export function zeroLockSource(attribute){
  for (const property of [attribute?.natural, attribute?.augmented]) {
    const lock = (property?.modifiers ?? []).find(m => m?.replace && m.replaceTo === 0)
    if (lock) return lock.source ?? ""
  }
  return null
}

//Locks the augmented rating: every modifier that would raise it (a positive one, a multiplier above 1) counts for nothing
//and keeps its own value in ignoredValue, for the help; the penalties still apply in full. Capping the total instead let
//the ignored augmentations absorb a penalty (Body 4 + 4 of augmentations − 2 stayed at 4, Pauline#4382). A lock modifier
//says why, with a ceiling as a safeguard (0, or the natural rating of Body under Quadriplegic: quadriplegicSource).
//updateAttributes runs twice (after the armor encumbrance) and a replace is worked out again in between: the
//modifiers are cleared on every run, the lock modifier is put once
//Also used, under Quadriplegic, for the physical initiative dice and the Physical limit (arbitrage de DjamZ, 05/11): the
//Physical limit takes its base as ceiling; the dice none (null: no ceiling), since keep(m) spares a modifier that is no
//augmentation (a grunt's printed profile) and a ceiling at the base would cut it
export function lockAugmentedAtZero(augmented, label, ceiling = 0, keep = null){
  if (!Array.isArray(augmented?.modifiers)) return
  for (const m of augmented.modifiers) {
    if (!m || m.type === "attributeLock" || keep?.(m)) continue
    const value = Number(m.value)
    if (m.isMultiplier ? value > 1 : value > 0) {
      m.ignoredValue = m.value
      m.value = m.isMultiplier ? 1 : 0
    }
  }
  //Already there from a previous run: its ceiling follows the base of this run
  const lock = augmented.modifiers.find(m => m?.type === "attributeLock")
  if (lock) {
    lock.ceiling = ceiling; return
  }
  augmented.modifiers.push({
    source: label, type: "attributeLock", value: 0, isMultiplier: false, ceiling
  })
}

//A replace with 0 already on a character attribute (natural or augmented) wins over a replace that comes after it, whatever
//its value: otherwise the later one cleared it, and Quadriplegic hung on the order of the items (a cyberlimb's Agility 5
//put after the quality, Pauline#4382). Only for a player character or a grunt, on system.attributes.<key>.natural or
//.augmented: a vehicle keeps "the last replace wins"
export function zeroReplaceHolds(modifiers, target, actorType){
  if (actorType !== "actorPc" && actorType !== "actorGrunt") return false
  if (!/^system\.attributes\.[a-zA-Z]+\.(natural|augmented)$/.test(target ?? "")) return false
  return (modifiers ?? []).some(m => m?.replace && m.replaceTo === 0)
}

//Body under Quadriplegic: it keeps its rating, but no augmentation counts while the quality is on the sheet ("pas
//d'augmentation possible tant que le défaut n'est pas racheté et une lourde opération de reconstruction réalisée",
//arbitrage de DjamZ, 05/11, on Better Than Bad p. 125). Nothing in the data marks Body: the quality is told by its
//effects, ONE item replacing with 0 the natural Agility, Reaction AND Strength. Its name, or null. Only the natural
//ratings count: a called shot or a spell bringing one augmented rating down to 0 is no Quadriplegic
export const QUADRIPLEGIC_ATTRIBUTES = ["agility", "reaction", "strength"]
export function quadriplegicSource(attributes){
  const sources = QUADRIPLEGIC_ATTRIBUTES.map(key => new Set((attributes?.[key]?.natural?.modifiers ?? [])
    .filter(m => m?.replace && m.replaceTo === 0).map(m => m.source)))
  for (const source of sources[0]) if (sources.every(s => s.has(source))) return source ?? ""
  return null
}
