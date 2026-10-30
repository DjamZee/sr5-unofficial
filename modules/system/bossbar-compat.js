// Boss Bar (module by TheRipper93, id "bossbar", 4.0.0 for Foundry 13): a boss health bar on top of the screen.
// It reads ONE path, the same for every actor, under actor.system ("currentHpPath" / "maxHpPath", plus
// "woundsSystem" when the value counts damage). SR5 keeps its damage in different monitors: Physical and Stun
// for characters and most spirits, a single condition monitor for grunts, vehicles, drones, homunculi and AIs,
// the Matrix monitor for devices, sprites and agents. No path of the module fits them all, so the system
// prepares one: system.bossBar = {value, max}, the boxes LEFT of the monitor the world setting chooses.
// Optional: the setting is offered only when Boss Bar is active, and its default ("off") prepares nothing.
// Nothing of the module is changed; turning the setting on writes the module's own three path settings.
export const BOSS_BAR = "sr5BossBar"
export const BOSS_BAR_MODULE = "bossbar"
export const BOSS_BAR_MODES = ["off", "physical", "worst"]
export const BOSS_BAR_PATHS = {
  currentHpPath: "bossBar.value", maxHpPath: "bossBar.max", woundsSystem: false
}
// The module's own defaults, given back when the setting is turned off
const MODULE_DEFAULTS = {
  currentHpPath: "attributes.hp.value", maxHpPath: "attributes.hp.max", woundsSystem: false
}

export function bossBarActive(){
  return !!game.modules?.get(BOSS_BAR_MODULE)?.active
}

export function bossBarMode(){
  try {
    const mode = game.settings.get("sr5", BOSS_BAR)
    return BOSS_BAR_MODES.includes(mode) ? mode : "off"
  } catch {
    return "off"
  }
}

// One monitor read as {damage, max}; null when the actor does not have it
function monitor(conditionMonitors, key){
  const m = conditionMonitors?.[key]
  const max = Number(m?.value)
  if (!m || !(max > 0)) return null
  return {
    damage: Math.max(0, Number(m.actual?.value) || 0), max
  }
}

function left(m){
  return {
    value: Math.max(0, m.max - Math.min(m.damage, m.max)), max: m.max
  }
}

/**
 * The bar of an actor: the boxes left, and the boxes of the monitor.
 * "physical": the Physical monitor, or the single monitor of an actor who has no Physical one (condition, then Matrix).
 * "worst": the Physical or the Stun monitor, the one with the smaller share left (either one fills up and the
 * fight is over for the actor, SR5 p. 171).
 * @returns {{value: number, max: number}|null}
 */
export function bossBarMonitor(system, mode){
  if (!mode || mode === "off") return null
  const monitors = system?.conditionMonitors
  const physical = monitor(monitors, "physical")
  if (!physical) {
    const single = monitor(monitors, "condition") ?? monitor(monitors, "matrix")
    return single ? left(single) : null
  }
  const stun = mode === "worst" ? monitor(monitors, "stun") : null
  if (!stun) return left(physical)
  const p = left(physical), s = left(stun)
  return s.value / s.max < p.value / p.max ? s : p
}

// Called at the end of the actor's preparation, on every client: the module reads the bar where it draws it
export function prepareBossBar(actor){
  const mode = bossBarMode()
  // The prepared data outlives a preparation: a bar left by the setting turned off is taken away
  const bar = mode !== "off" && bossBarActive() ? bossBarMonitor(actor.system, mode) : null
  if (bar) actor.system.bossBar = bar
  else if (actor.system && "bossBar" in actor.system) delete actor.system.bossBar
}

// The module keeps no hook on its settings: its bar is drawn again with the actors prepared anew
function refreshBars(){
  for (const actor of game.actors ?? []) actor.prepareData()
  for (const token of game.scenes?.viewed?.tokens ?? []) if (!token.actorLink) token.actor?.prepareData()
  ui.bossBar?.render?.()
}

async function writeModulePaths(paths){
  for (const [key, value] of Object.entries(paths)) {
    try {
      if (game.settings.get(BOSS_BAR_MODULE, key) !== value) await game.settings.set(BOSS_BAR_MODULE, key, value)
    } catch (error) {
      console.error(`SR5 | Boss Bar setting ${key}`, error)
    }
  }
}

// The paths are written once, by the active GM; turned off, the module's defaults come back only over ours
export async function onBossBarModeChange(mode){
  if (bossBarActive() && game.users?.activeGM?.isSelf) {
    if (mode !== "off") await writeModulePaths(BOSS_BAR_PATHS)
    else if (game.settings.get(BOSS_BAR_MODULE, "currentHpPath") === BOSS_BAR_PATHS.currentHpPath) await writeModulePaths(MODULE_DEFAULTS)
  }
  refreshBars()
}

export function registerBossBarSettings(){
  game.settings.register("sr5", BOSS_BAR, {
    name: "SR5.SETTINGS_BossBar_T",
    hint: "SR5.SETTINGS_BossBar_D",
    scope: "world",
    config: false,
    default: "off",
    type: String,
    choices: {
      off: "SR5.SETTINGS_BossBar_Off",
      physical: "SR5.SETTINGS_BossBar_Physical",
      worst: "SR5.SETTINGS_BossBar_Worst",
    },
    onChange: mode => onBossBarModeChange(mode),
  })
}

// At "init", core has not yet marked the modules active (measured on Foundry 13): the setting is shown at "ready"
export function registerBossBarHooks(){
  Hooks.once("ready", () => {
    const setting = game.settings.settings.get(`sr5.${BOSS_BAR}`)
    if (setting) setting.config = bossBarActive()
  })
}
