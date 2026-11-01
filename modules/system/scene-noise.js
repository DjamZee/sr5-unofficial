// Noise of a scene or an area template, shared by their sheets, the rolls and the indicators.

// SR5 p. 232-233: the Noise of a place is a rating, 0 or more, read as a malus by the matrix tests. The GM may
// type any value; up to 36, the highest the shortcuts give (spam zone 6 + static zone 6 + a phenomenon of Force 24)
export const SCENE_NOISE_MAX = 36

export function clampSceneNoise(value){
  return Math.max(0, Math.min(SCENE_NOISE_MAX, Math.trunc(Number(value)) || 0))
}

// Foundry empties the canvas when the scene on it is deleted, or deactivated with no other to take over: no canvasReady
// follows, and canvas.scene names the scene gone until the teardown ends, with no hook to tell when (Edmond, 01/11).
// The hooks of that moment note it; a next scene drawn (canvasInit) lifts the note.
let sceneLeavingCanvas = null
export function noteSceneLeavingCanvas(sceneId){
  sceneLeavingCanvas = sceneId
}

// The scene on the canvas, none when Foundry is removing it
export function viewedScene(){
  const viewed = globalThis.canvas?.scene ?? null
  return viewed?.id === sceneLeavingCanvas ? null : viewed
}

// The scene whose Noise and background count reach an actor's roll: the one of its token, as the indicator shows it
// to whoever looks at that scene. An unlinked token's actor has its own scene; a linked actor is read on the viewed
// scene when it has a token there (the GM rolls for whom they look at), else on the active scene, where the players
// are. No token on either: the active scene, whose Noise a matrix test has always read, and no background count. A
// token on some other scene is not looked for: a token forgotten there cannot be told from a character standing there.
export function actorRollScene(actor){
  if (actor?.isToken && actor.token?.parent) return {
    scene: actor.token.parent, hasToken: true
  }
  const hasActorToken = scene => !!scene?.tokens?.some?.(t => t.actorId === actor?.id)
  const viewed = viewedScene()
  if (actor && hasActorToken(viewed)) return {
    scene: viewed, hasToken: true
  }
  const active = globalThis.game?.scenes?.active ?? null
  return {
    scene: active, hasToken: !!actor && hasActorToken(active)
  }
}

// The scene the indicator shows (SR5 p. 232-233: the Noise of the place the persona is in). The GM, who rolls for whom
// they look at: the viewed scene. A player: the viewed scene when a token of theirs stands there (character, drone,
// spirit, sprite), else the one their character's roll reads, else the viewed scene. One indicator cannot be right for
// all their actors at once: its tooltip names the scene.
export function indicatorScene(){
  const viewed = viewedScene()
  const user = globalThis.game?.user
  if (user?.isGM || viewed?.tokens?.some?.(t => t.actor?.isOwner)) return viewed
  return (user?.character ? actorRollScene(user.character).scene : null) ?? viewed
}
