// Noise of a scene or an area template, shared by their sheets, the rolls and the indicators.

// SR5 p. 232-233: the Noise of a place is a rating, 0 or more, read as a malus by the matrix tests. The GM may
// type any value; up to 36, the highest the shortcuts give (spam zone 6 + static zone 6 + a phenomenon of Force 24)
export const SCENE_NOISE_MAX = 36

export function clampSceneNoise(value){
  return Math.max(0, Math.min(SCENE_NOISE_MAX, Math.trunc(Number(value)) || 0))
}

// The scene whose Noise and background count reach an actor's roll: the one of its token, as the indicator shows it
// to whoever looks at that scene. An unlinked token's actor has its own scene; a linked actor is read on the viewed
// scene when it has a token there (the GM rolls for whom they look at), else on the active scene, where the players
// are. No token at all: the active scene, which the Noise of a matrix test has always read.
export function actorRollScene(actor){
  if (actor?.isToken && actor.token?.parent) return {
    scene: actor.token.parent, hasToken: true
  }
  const hasActorToken = scene => !!scene?.tokens?.some?.(t => t.actorId === actor?.id)
  const viewed = globalThis.canvas?.scene
  if (actor && hasActorToken(viewed)) return {
    scene: viewed, hasToken: true
  }
  const active = globalThis.game?.scenes?.active ?? null
  return {
    scene: active, hasToken: !!actor && hasActorToken(active)
  }
}
