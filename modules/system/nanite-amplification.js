// Nanite amplification of a playable monad (house rule of the Concepteur, Whisper Nets p. 150 converted to SR5; arbitrage
// de DjamZ, 28/10: the physical amplification follows the mental one). The head case Attribute Boost of Stolen Souls
// p. 201 (naniteAttributeBoost, Stun equal to the hits) stays for the head cases. Here:
// - the boost is the hits, at most the Nanite Volume and +4 (the usual augmentation limit, SR5 p. 96);
// - it lasts as many combat turns as hits; then one box only if the attribute went over the metatype's natural
//   maximum (SR5 p. 68, Exceptional Attribute included): Physical for a physical attribute, Stun for a mental one;
// - then the Nanite Volume is lowered by the boost for one minute: 20 combat turns of 3 seconds (SR5 p. 160).
import {
  METATYPE_ATTRIBUTE_MAX
} from "../entities/actors/augmentationCap.js"

export const AMPLIFICATION_CAP = 4
export const AMPLIFICATION_VOLUME_TURNS = 20
export const AMPLIFICATION_VOLUME_TARGET = "system.specialAttributes.nanite.augmented"
const MENTAL = ["willpower", "logic", "intuition", "charisma"]

//The boost a test gives: its hits, at most the Nanite Volume (when the sheet has one) and +4
export function amplificationValue(hits, volume) {
  const cap = Number(volume) > 0 ? Math.min(Number(volume), AMPLIFICATION_CAP) : AMPLIFICATION_CAP
  return Math.max(0, Math.min(Math.floor(Number(hits) || 0), cap))
}

//The attribute an effect target raises (system.attributes.<key>.augmented), null for another target
export function amplifiedKey(target) {
  return /^system\.attributes\.(\w+)\.augmented$/.exec(target ?? "")?.[1] ?? null
}

export const amplificationDamageType = key => MENTAL.includes(key) ? "stun" : "physical"

//One box once the boost ends if the boosted rating went over the natural maximum; none for a metatype the table does not know
export function amplificationEndBoxes({
  metatype, key, augmented, exceptional = 0
}) {
  const max = METATYPE_ATTRIBUTE_MAX[metatype]?.[key]
  if (max === undefined) return 0
  return (Number(augmented) || 0) > max + exceptional ? 1 : 0
}

//What the end of an amplification effect does to this actor, read while the attribute still carries the boost
export function amplificationEnd(actor, effectData, metatype) {
  const key = Object.values(effectData?.customEffects ?? {
  }).map(e => amplifiedKey(e?.target)).find(k => k)
  if (!key) return null
  const items = Array.from(actor?.items ?? [])
  //Exceptional Attribute (SR5 p. 68), as the augmentation cap reads it (utilityActor.js)
  const exceptional = items.filter(i => i.type === "itemQuality").flatMap(i => Object.values(i.system?.customEffects ?? {
  })).filter(e => e?.target === `system.attributes.${key}.maximum`).reduce((sum, e) => sum + (Number(e.value) || 0), 0)
  const augmented = actor?.system?.attributes?.[key]?.augmented?.value
  return {
    key,
    damageType: amplificationDamageType(key),
    boxes: amplificationEndBoxes({
      metatype, key, augmented, exceptional
    }),
    volumeLoss: Math.max(0, Number(effectData.value) || 0),
  }
}

//The itemEffect that lowers the Nanite Volume for one minute
export function volumeLossEffect(name, label, loss) {
  return {
    name,
    type: "itemEffect",
    "system.target": label,
    "system.value": -loss,
    "system.type": "naniteAmplificationVolume",
    "system.duration": AMPLIFICATION_VOLUME_TURNS,
    "system.durationType": "round",
    "system.customEffects": {
      "0": {
        category: "characterSpecialAttributes", target: AMPLIFICATION_VOLUME_TARGET, type: "value", value: -loss, forceAdd: true
      }
    },
  }
}
