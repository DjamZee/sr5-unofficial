import {
  describe, it, expect
} from 'vitest'
import {
  MAX_FAVORITES, tradeOf, shareOf, viewOf, seesDetails, toggleFavorite, favorsLabel, filterContacts, groupContacts,
  reputationWord, knownFactions, answerIntroduction, pruneIntroductions, withDiscovery, withAccess, visibleAccesses,
  visibleShops, withShopDiscovered, recentDiscoveries, dots, accessFromLanding, shareFromLanding, tradeFromLanding,
  introductionFromLanding, mergeLandingRegisters
} from '../modules/interface/network-contacts/nc-rules.js'

// Network and Contacts, taken out of landing-metroplexes-sr5 1.8.0 (its tests, tests/contacts.test.js and
// tests/reseau.test.js, carried over). Loyalty 1-6 and Influence 1-12: SR5 p. 57 and 100
describe('trade of a contact', () => {
  it.each([
    ["Fixer · Downtown", "fixers"], ["Mr. Johnson", "fixers"], ["Faussaire d'identités", "gear"],
    ["Garde du corps", "gear"], ["Doc des rues · Puyallup", "health"], ["Marchande de talismans", "health"],
    ["Courtière en informations", "info"], ["Pirate trideo", "info"], ["Barman ork · Big Rhino", "street"],
    ["Inspecteur, Knight Errant", "law"], ["Coyote · frontière Salish", "transport"], ["Street Doc", "health"],
    ["Bartender", "street"], ["Smuggler", "transport"],
  ])('%s → %s', (type, trade) => expect(tradeOf(type)).toBe(trade))

  it('start of a word only, empty = other, the owner\'s choice wins', () => {
    expect(tradeOf("Imagerie")).toBe("other")
    expect(tradeOf("")).toBe("other")
    expect(tradeOf("Fixer", "transport")).toBe("transport")
    expect(tradeOf("Fixer", "nonsense")).toBe("fixers")
  })
})

describe('sharing and view', () => {
  const mine = new Set(["vesper"])
  const c = (share, ownerId = "brick") => ({
    ownerId, share
  })
  it('private by default; the owner and the gamemaster see all', () => {
    expect(shareOf(undefined)).toEqual({
      level: "private", to: "team", partners: []
    })
    expect(viewOf(c(undefined), {
      mine
    })).toBe(null)
    expect(viewOf(c(undefined, "vesper"), {
      mine
    })).toBe("full")
    expect(viewOf(c(undefined), {
      gm: true
    })).toBe("full")
  })
  it('a portrait hides Loyalty and favors, details show them; partners only when named', () => {
    expect(viewOf(c({
      level: "portrait"
    }), {
      mine
    })).toBe("portrait")
    expect(seesDetails("portrait")).toBe(false)
    expect(seesDetails(viewOf(c({
      level: "details"
    }), {
      mine
    }))).toBe(true)
    expect(viewOf(c({
      level: "details", to: "partners", partners: ["other"]
    }), {
      mine
    })).toBe(null)
    expect(viewOf(c({
      level: "details", to: "partners", partners: ["vesper"]
    }), {
      mine
    })).toBe("details")
  })
})

describe('favorites, favors, filters', () => {
  it('twelve favorites at most, the 13th refused', () => {
    const full = Array.from({
      length: MAX_FAVORITES
    }, (_, i) => `u${i}`)
    expect(toggleFavorite(full, "x")).toEqual({
      list: full, refused: true
    })
    expect(toggleFavorite(full, "u3").list).toHaveLength(11)
    expect(toggleFavorite([], "a")).toEqual({
      list: ["a"], refused: false
    })
  })
  it('favors chip', () => {
    expect(favorsLabel(2)).toBe("+2")
    expect(favorsLabel(-3)).toBe("−3")
    expect(favorsLabel(0)).toBe("0")
  })
  const contacts = [
    {
      uuid: "1", name: "Bix", typeText: "Fixer", trade: "fixers", ownerId: "a", mine: true, influence: 4, loyalty: 3, chips: 1, view: "full", factionId: ""
    },
    {
      uuid: "2", name: "Doc", typeText: "Doc", trade: "health", ownerId: "b", mine: false, influence: 2, loyalty: 5, chips: -1, view: "portrait", factionId: "f"
    },
    {
      uuid: "3", name: "Ana", typeText: "Taxi", trade: "transport", ownerId: "b", mine: false, influence: 6, loyalty: 2, chips: 0, view: "details", factionId: ""
    },
  ]
  it('a filter on Loyalty or favors never reveals what the viewer may not see', () => {
    expect(filterContacts(contacts, {
      loyalty: 4
    }).map(c => c.uuid)).toEqual([])
    expect(filterContacts(contacts, {
      favors: "owing"
    }).map(c => c.uuid)).toEqual([])
    expect(filterContacts(contacts, {
      favors: "owed"
    }).map(c => c.uuid)).toEqual(["1"])
    expect(filterContacts(contacts, {
      from: "me"
    }).map(c => c.uuid)).toEqual(["1"])
    expect(filterContacts(contacts, {
    }, ["1"]).map(c => c.uuid)).toEqual(["2", "3"])
  })
  it('grouped by trade in the book\'s order, or sorted', () => {
    expect(groupContacts(contacts).map(g => g.trade)).toEqual(["fixers", "health", "transport"])
    expect(groupContacts(contacts, "influence")[0].contacts.map(c => c.uuid)).toEqual(["3", "1", "2"])
    expect(groupContacts(contacts, "loyalty")[0].contacts.map(c => c.uuid)).toEqual(["1", "3", "2"])
  })
})

describe('factions and introductions', () => {
  it('the word follows the step of Cutting Aces p. 160, the sign below', () => {
    expect(reputationWord(12, 1)).toBe("friendly")
    expect(reputationWord(-12, -1)).toBe("hostile")
    expect(reputationWord(3)).toBe("favorable")
    expect(reputationWord(-3)).toBe("wary")
    expect(reputationWord(0)).toBe("neutral")
  })
  it('a player sees the factions she belongs to, moved or revealed; a private contact stays unnamed', () => {
    const registry = {
      factions: [{
        id: "f1", name: "Ancients", members: ["vesper"], contacts: ["c1"]
      }, {
        id: "f2", name: "Yakuza", contacts: []
      }, {
        id: "f3", name: "Lone Star", contacts: []
      }],
      log: [{
        factionId: "f1", actorId: "vesper", delta: 2
      }, {
        factionId: "f2", actorId: "vesper", delta: 1, pending: true
      }],
    }
    const out = knownFactions(registry, {
      mine: new Set(["vesper"]), revealed: ["f3"], contacts: new Map([["c1", {
        name: "Spike", view: null
      }]])
    })
    expect(out.map(f => f.id)).toEqual(["f1", "f3"])
    expect(out[0]).toMatchObject({
      score: 2, member: true, through: null, throughPrivate: true
    })
  })
  it('an introduction goes partner → gamemaster → accepted, and the closed ones are pruned', () => {
    const d = {
      id: "x", state: "partner"
    }
    expect(answerIntroduction(d, {
      by: "gm", accept: true
    })).toBe(null)
    const next = answerIntroduction(d, {
      by: "partner", accept: true
    })
    expect(next.state).toBe("gm")
    expect(answerIntroduction(next, {
      by: "gm", accept: true
    }).state).toBe("accepted")
    expect(answerIntroduction(d, {
      by: "partner", accept: false
    }).state).toBe("refused")
    const many = Array.from({
      length: 40
    }, (_, i) => ({
      id: `${i}`, state: "refused", date: i
    }))
    expect(pruneIntroductions([...many, {
      id: "open", state: "gm"
    }])).toHaveLength(31)
  })
})

describe('network', () => {
  it('a mark on a host adds the access at once, once per character', () => {
    let list = withDiscovery([], {
      host: "h", actorId: "a", name: "Renraku", id: "1", date: 5
    })
    expect(list).toHaveLength(1)
    expect(list[0]).toMatchObject({
      host: "h", pcs: ["a"], by: "a", play: "book"
    })
    expect(withDiscovery(list, {
      host: "h", actorId: "a"
    })).toBe(null)
    list = withDiscovery(list, {
      host: "h", actorId: "b"
    })
    expect(list[0].pcs).toEqual(["a", "b"])
  })
  it('a player sees the accesses of her characters; one without a character is hidden, the gamemaster\'s', () => {
    const list = [withAccess([], {
      id: "1", name: "A", pcs: ["a"]
    })[0], withAccess([], {
      id: "2", name: "B", pcs: []
    })[0]]
    expect(visibleAccesses(list, {
      mine: new Set(["a"])
    }).map(a => a.id)).toEqual(["1"])
    expect(visibleAccesses(list, {
      gm: true
    }).map(a => [a.id, a.hidden])).toEqual([["1", false], ["2", true]])
  })
  it('a shop is known by a client, a discovery or the setting; a client shows her best Loyalty', () => {
    const shops = [
      {
        key: "k1", name: "Bob", open: true, clients: [{
          actorId: "a", loyalty: 2
        }, {
          actorId: "a", loyalty: 4
        }]
      },
      {
        key: "k2", name: "Cid", open: true, clients: []
      },
      {
        key: "k3", name: "Dan", open: false, clients: []
      },
    ]
    const mine = new Set(["a"])
    expect(visibleShops(shops, {
      mine
    }).map(b => [b.key, b.loyalty])).toEqual([["k1", 4]])
    expect(visibleShops(shops, {
      mine, discovered: [{
        key: "k3", pcs: ["a"], date: 1
      }]
    }).map(b => b.key)).toEqual(["k1", "k3"])
    expect(visibleShops(shops, {
      mine, allOpen: true
    }).map(b => b.key)).toEqual(["k1", "k2"])
    expect(withShopDiscovered([{
      key: "k3", pcs: ["a"], date: 1
    }], {
      key: "k3", pcs: ["a"]
    })).toBe(null)
  })
  it('the discoveries, latest first, what a module adds included', () => {
    const out = recentDiscoveries({
      accesses: [{
        id: "1", name: "A", date: 3
      }], shops: [{
        key: "k", name: "S", date: 5, known: true
      }], extra: [{
        name: "Place", date: 4
      }]
    })
    expect(out.map(d => d.kind)).toEqual(["shop", "place", "access"])
    expect(dots(2)).toBe("●●○")
  })
})

describe('migration from landing-metroplexes-sr5', () => {
  const landing = {
    acces: {
      liste: [{
        id: "a1", nom: "Renraku", type: "serveur", hote: "Actor.h", pj: ["p1"], jeu: "noeuds", indice: "6", par: "p1", date: 9
      }]
    },
    boutiquesDecouvertes: {
      liste: [{
        cle: "Actor.v|s1", pj: ["p1"], date: 7
      }]
    },
    factionsRevelees: {
      ids: ["f1"]
    },
    demandes: {
      liste: [{
        id: "d1", de: "p2", userId: "u2", contact: "Item.c", proprietaire: "p1", message: "hi", etat: "mj", date: 3
      }]
    },
  }
  it('every field of an access, a sharing, a sorting and a request is carried over', () => {
    expect(accessFromLanding(landing.acces.liste[0])).toMatchObject({
      id: "a1", name: "Renraku", type: "server", host: "Actor.h", pcs: ["p1"], play: "nodes", rating: "6", by: "p1", date: 9
    })
    expect(accessFromLanding({
      nom: "Haven", type: "paradis"
    }).type).toBe("haven")
    expect(shareFromLanding({
      niveau: "carnet", pour: "partenaires", vers: ["p2"]
    })).toEqual({
      level: "details", to: "partners", partners: ["p2"]
    })
    expect(shareFromLanding({
      niveau: "portrait"
    })).toEqual({
      level: "portrait", to: "team", partners: []
    })
    expect(tradeFromLanding("matos")).toBe("gear")
    expect(tradeFromLanding("")).toBe("")
    expect(introductionFromLanding(landing.demandes.liste[0])).toMatchObject({
      from: "p2", owner: "p1", state: "gm"
    })
  })
  it('merging adds Landing\'s entries, keeps the system\'s, and done twice changes nothing', () => {
    const empty = {
      accesses: [], shops: [], revealed: [], introductions: []
    }
    const once = mergeLandingRegisters(landing, empty)
    expect(once.accesses).toHaveLength(1)
    expect(once.shops).toEqual([{
      key: "Actor.v|s1", pcs: ["p1"], date: 7
    }])
    expect(once.revealed).toEqual(["f1"])
    expect(once.introductions).toHaveLength(1)
    expect(mergeLandingRegisters(landing, once)).toEqual(once)
    // An access changed in the system is not overwritten by Landing's older copy
    const edited = {
      ...once, accesses: [{
        ...once.accesses[0], name: "Renraku (edited)"
      }]
    }
    expect(mergeLandingRegisters(landing, edited).accesses[0].name).toBe("Renraku (edited)")
  })
  it('a world without Landing\'s data gives back the system\'s as it is', () => {
    const system = {
      accesses: [{
        id: "x"
      }], shops: [], revealed: ["f9"], introductions: []
    }
    expect(mergeLandingRegisters({
    }, system)).toEqual(system)
  })
})
