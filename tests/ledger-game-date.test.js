import {
  describe, it, expect
} from "vitest"
import fs from "node:fs"

// Élise and DjamZ (01/11): a sheet does not mix 2070 and 2026. Every ledger line the system writes takes the date of the
// game from one function (system/calendar.js gameDate); nothing reads these dates to sort, wait or dedupe, only to show them.
const WRITERS = ["interface/credstick.js", "interface/shop.js", "interface/shop-orders.js", "interface/shop-vendor.js",
  "interface/shop-fence.js", "interface/trade.js", "interface/item-transfer.js", "interface/table-payout.js",
  "interface/network-contacts/nc-runs.js", "system/deadlines.js", "system/blood-magic.js", "interface/info-broker.js",
  "interface/contact-favors.js"]
const source = file => fs.readFileSync(`modules/${file}`, "utf8")

describe("the ledger lines carry the date of the game", () => {
  it.each(WRITERS)("%s reads it from gameDate, not from the real day", file => {
    expect(source(file)).toMatch(/gameDate\(\)/)
    expect(source(file)).not.toContain("new Date().toISOString().slice(0, 10)")
  })

  it("no line of account is written outside these files", () => {
    const lines = /type: *["']item(Nuyen|Karma)["']/
    const walk = dir => fs.readdirSync(dir, {
      withFileTypes: true
    }).flatMap(e => e.isDirectory() ? walk(`${dir}/${e.name}`) : e.name.endsWith(".js") ? [`${dir}/${e.name}`] : [])
    const writers = walk("modules").filter(f => lines.test(fs.readFileSync(f, "utf8"))).map(f => f.slice("modules/".length))
    const known = [...WRITERS, "interface/network-contacts/nc-runs-rules.js"]
    expect(writers.filter(f => !known.includes(f))).toEqual([])
  })

  it("the purchase's trace (shop-purchase) keeps the real moment: it is no ledger date, the shop's audit reads it", () => {
    expect(source("interface/shop-purchase.js")).toContain("date: now.toISOString()")
  })

  it("the public API gives it to the modules", () => {
    expect(source("hooks/init.js")).toMatch(/gameDate: \(\) => gameDate\(\)/)
  })

  it("a line with an empty date shows no \"Invalid Date\"", () => {
    const entity = source("entities/items/entityItem.js")
    expect(entity).toMatch(/itemData\.date \? new Date\(itemData\.date\) : null/)
    expect(entity).not.toMatch(/new Date\(itemData\.date\)\.toLocaleDateString/)
  })
})
