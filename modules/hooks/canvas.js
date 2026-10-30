import {
  SR5_EffectArea
} from "../system/effectArea.js"
import {
  SR5_Jammer
} from "../system/jammer.js"
import {
  SR5_EntityHelpers
} from "../entities/helpers.js"
import {
  noteRemovedAreaTemplate
} from "../system/areaEffectScene.js"

//A linked actor reads the background count of the viewed scene when it has a token there (actorRollScene): on each
//scene change, prepare again those of the new scene and of the one left, the count being 0 or not
let previousSceneId = null
export function sr5HookCanvasReady(data) {
  const prepared = new Set()
  const left = previousSceneId && previousSceneId !== data.scene?.id ? game.scenes.get(previousSceneId) : null
  previousSceneId = data.scene?.id ?? null
  const tokens = [...(data.scene?.tokens ?? []), ...(left?.tokens ?? [])]
  for (let token of tokens){
    const actor = token.actorLink ? token.actor : null
    if (!actor?.isOwner || prepared.has(actor.id)) continue
    prepared.add(actor.id)
    actor.prepareData()
    if (actor.sheet?.rendered) actor.sheet.render()
  }
}

//The matrix noise and background count of a template only count on its own scene, and for a linked actor that
//scene is read from the canvas when the actor is prepared (SR5_EffectArea.isPreparedAreaEffectOffScene): on
//a scene change, prepare again the actors that carry one
export function sr5HookCanvasReadyAreaEffects() {
  for (let actor of game.actors ?? []){
    if (!actor.items.some(i => i.system?.type === "areaEffect" && SR5_EffectArea.templateSceneId(i))) continue
    actor.prepareData()
    if (actor.sheet?.rendered) actor.sheet.render()
  }
}

//Tokens placed before the vision ranges were converted to the scene's units keep a range in meters until
//their vision is switched again : fix those of the scene being shown, once, by a single GM
export async function sr5HookCanvasReadyVisionRanges(canvasData) {
  const designated = game.users?.activeGM
  if (designated ? !designated.isSelf : !game.user.isGM) return
  const scene = canvasData?.scene
  const updates = SR5_EntityHelpers.visionRangeUpdatesOfScene(scene)
  if (updates.length) await scene.updateEmbeddedDocuments("Token", updates)
}

//The template hooks run on every GM: the active one alone gives and lifts their effects, or two GMs connected gave each
//token two copies, its noise counted twice (Marta's measure)
export async function sr5HookDrawMeasuredTemplate(template) {
  if (!game.users?.activeGM?.isSelf) return
  await SR5_EffectArea.initiateTemplateEffect(template)
}

export async function sr5HookDeleteMeasuredTemplate(templateDocument) {
  //On every client: the resistance may be applied on a player's
  noteRemovedAreaTemplate(templateDocument)
  if (!game.users?.activeGM?.isSelf) return
  if (templateDocument.flags?.sr5?.jammerUuid) return SR5_Jammer.refreshScene(templateDocument.parent)
  await SR5_EffectArea.removeTemplateEffect(templateDocument)
}

export async function sr5HookUpdateMeasuredTemplate(templateDocument) {
  if (!game.users?.activeGM?.isSelf) return
  if (templateDocument.flags?.sr5?.jammerUuid) return SR5_Jammer.refreshScene(templateDocument.parent)
  await SR5_EffectArea.checkUpdatedTemplateEffect(templateDocument)
}

//The cone of a directional jammer (SR5 p. 443), on whatever scene it was placed, viewed or not
export function sr5HookCreateMeasuredTemplate(templateDocument) {
  if (templateDocument.flags?.sr5?.jammerUuid) SR5_Jammer.refreshScene(templateDocument.parent)
}

export async function sr5HookUpdateScene(data) {
  //relaunch prepare Data of all actor when a scene is modified, so background count and other effect are correctly applied without needing to manualy refresh an actor
  if (!game.user.isGM) return
  for (let token of data.tokens){
    token.actor.prepareData()
    if (token.actor.sheet.rendered) token.actor.sheet.render()
  }
}
