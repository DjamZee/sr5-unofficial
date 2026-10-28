// Aim at an icon from a crown (DjamZ, 28/10: "cibler les icônes matricielles via la couronne de PAN"). "Target" in the
// radial menu of an icon makes it the user's target, as a click on a token would: the token that carries the device is
// targeted on the scene, and the device itself is remembered, so that a Matrix action launched from the sheet (Data
// Spike, Hack on the Fly...) aims at it with no question to the defender. An icon with no token on the scene (a
// persona, a sprite, an IC elsewhere) is aimed at by its uuid alone, as rollMatrixActionOn does (A1): the user's
// targets are then released. The aim lives in the user's browser, as Foundry's targets do, and goes as soon as the
// user targets something else.

let aim = null

/**
 * Does an aim still stand against the user's targets? Aimed with a token: that token is her one target. Aimed with
 * no token: she targets nothing (a token targeted since then is what she aims at).
 * @param {Object|null} current     {nodeUuid, tokenId?, actorId?, itemUuid}
 * @param {Array<String>} targetIds the ids of the user's targeted tokens
 */
export function aimStands(current, targetIds = []){
  if (!current) return false
  if (current.tokenId) return targetIds.length === 1 && targetIds[0] === current.tokenId
  return targetIds.length === 0 && !!current.actorId
}

/**
 * The aim a target change leaves standing: a token targeted that is not the aimed one, or the aimed token released,
 * ends it.
 * @param {Object|null} current
 * @param {String} tokenId   the token whose target changed
 * @param {Boolean} targeted
 * @return {Object|null}
 */
export function aimAfterTarget(current, tokenId, targeted){
  if (!current) return null
  if (current.tokenId) return (targeted ? tokenId === current.tokenId : tokenId !== current.tokenId) ? current : null
  return targeted ? null : current
}

function targetIds(){
  return Array.from(game.user?.targets ?? []).map(t => t.id)
}

/** The aim of this browser, while it stands, or null */
export function currentPanAim(){
  return aimStands(aim, targetIds()) ? aim : null
}

/** The uuid of the icon aimed at, for the crown to mark it, or null */
export function aimedNodeUuid(){
  return currentPanAim()?.nodeUuid ?? null
}

/**
 * The target of a Matrix action launched outside the crown (roll-prepare.js): {tokenId, itemUuid} or {actorId,
 * itemUuid}, as getPanTargetData reads it; null when no aim stands.
 */
export function panAimTarget(){
  const current = currentPanAim()
  if (!current) return null
  return current.tokenId ? {
    tokenId: current.tokenId, itemUuid: current.itemUuid
  } : {
    actorId: current.actorId, itemUuid: current.itemUuid
  }
}

function redraw(){
  canvas?.sr5PanCrown?.refresh?.()
}

/**
 * Aim at an icon, or stop aiming at it when it already is.
 * @param {Object} node   a node of getGraph
 * @param {Object} target
 * @param {Object|null} target.token        the token that carries it on the scene (tokenOfNode)
 * @param {String|null} target.itemUuid     the device aimed at; none for the persona (aimedItemUuid)
 * @param {Object|null} [target.actor]      with no token, the actor named by the uuid (uuidTarget)
 * @return {Boolean} true when the icon is now aimed at
 */
export function togglePanAim(node, {
  token = null, itemUuid = null, actor = null
} = {
}){
  if (aimedNodeUuid() === node.uuid) {
    clearPanAim({
      release: true
    })
    return false
  }
  if (token) {
    token.setTarget(true, {
      releaseOthers: true, groupSelection: false
    })
    aim = {
      nodeUuid: node.uuid, tokenId: token.id, itemUuid
    }
  } else if (actor) {
    for (const targeted of Array.from(game.user?.targets ?? [])) targeted.setTarget(false, {
      releaseOthers: false, groupSelection: false
    })
    aim = {
      nodeUuid: node.uuid, actorId: actor.isToken ? actor.token.id : actor.id, itemUuid
    }
  } else return false
  ui.notifications?.info(game.i18n.format(token ? "SR5.INFO_PanAimed" : "SR5.INFO_PanAimedNoToken", {
    name: node.name ?? ""
  }))
  redraw()
  return true
}

/**
 * Stop aiming.
 * @param {Object} [options]
 * @param {Boolean} [options.release]  release the aimed token too (the user asked it, not a target of hers)
 */
export function clearPanAim({
  release = false
} = {
}){
  if (!aim) return
  const token = release && aim.tokenId ? canvas?.tokens?.get(aim.tokenId) : null
  aim = null
  if (token?.isTargeted) token.setTarget(false, {
    releaseOthers: false, groupSelection: false
  })
  redraw()
}

/** The hooks that end an aim: the user targets something else, or the scene goes */
export function registerPanAimHooks(){
  Hooks.on("targetToken", (user, token, targeted) => {
    if (!aim || user !== game.user) return
    const next = aimAfterTarget(aim, token?.id, targeted)
    if (next === aim) return
    aim = next
    redraw()
  })
  Hooks.on("canvasTearDown", () => {
    if (aim?.tokenId) aim = null
  })
}
