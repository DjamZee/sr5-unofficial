// The listeners of an open view of Network and Contacts: put on when it mounts, all taken off when it unmounts, so
// that a closed window leaves nothing behind (Léopoldine's memory work on the system, 28/10). Many changes come
// together (a sheet saved, a register written): the view is drawn again once, 120 ms after the last one.

/**
 * @param {string[]} hooks  the Foundry and system hooks to follow
 * @param {string[]} settings  the setting keys ("sr5.sr5Factions") whose change draws again
 * @param {Function} redraw
 * @returns {Function} stop: takes every listener off
 */
export function listenWhileMounted(hooks, settings, redraw){
  let timer = null
  const later = () => {
    clearTimeout(timer)
    timer = setTimeout(redraw, 120)
  }
  const onSetting = s => {
    if (settings.includes(s?.key)) later()
  }
  const ids = [
    ...hooks.map(h => [h, Hooks.on(h, later)]),
    ["updateSetting", Hooks.on("updateSetting", onSetting)],
    ["createSetting", Hooks.on("createSetting", onSetting)],
  ]
  return () => {
    clearTimeout(timer)
    for (const [h, id] of ids) Hooks.off(h, id)
  }
}
