// Called shots against a vehicle part (SR5 p. 206): a tire, a sensor, a window. They follow the normal called shot
// rules (-4, SR5 p. 196) with no DV limit; the gamemaster decides the exact effect from the DV dealt, mostly the part
// is destroyed. Only the flat tire is written in figures: -2 dice per flat tire on the piloting tests.

// The locations of SR5 p. 206, next to those of Run & Gun p. 129
export const VEHICLE_PART_LOCATIONS = ["tire", "sensor", "window"]

// SR5 p. 206: "les pneus crevés infligent un modificateur de -2 dés par pneu à plat pour les tests de pilotage"
export const FLAT_TIRE_PENALTY = -2

// SR5 p. 196: a called shot, -4 dice; SR5 p. 206 gives no other figure for a vehicle part
export const VEHICLE_PART_CALLED_SHOT_MOD = -4

// Each flat tire is its own effect on the vehicle: the second one adds its -2, and the one repaired is deleted alone
export function flatTireCount(items) {
  let count = 0
  for (const item of items ?? []) if (item?.type === "itemEffect" && item.system?.type === "tire") count++
  return count
}

// The nine called shot locations of a vehicle (Run & Gun p. 129, SR5 p. 206), as their effect and status are named
export const VEHICLE_CALLED_SHOT_EFFECTS = ["antenna", "axle", "doorLock", "engineBlock", "fuelTankBattery", "windowMotor", ...VEHICLE_PART_LOCATIONS]

// The status to take off the token once an effect item of a vehicle location is deleted: the last one of its type only
// (two flat tires, two effects, one status). null when nothing goes
export function vehicleStatusToRemove(deleted, remainingItems) {
  const type = deleted?.type === "itemEffect" ? deleted.system?.type : null
  if (!VEHICLE_CALLED_SHOT_EFFECTS.includes(type)) return null
  const left = (remainingItems ?? []).some(i => i?.type === "itemEffect" && i.system?.type === type && i.id !== deleted.id)
  return left ? null : type
}

export function flatTirePenalty(items) {
  const count = flatTireCount(items)
  return count ? count * FLAT_TIRE_PENALTY : 0
}
