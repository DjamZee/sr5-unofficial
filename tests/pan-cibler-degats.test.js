import {
  describe, it, expect
} from 'vitest'
import {
  aimStands, aimAfterTarget
} from '../modules/canvas/pan-crown/pan-aim.js'

// DjamZ, 28/10: aim at an icon from its crown, and adjust its Matrix damage there

// config.js writes CONFIG.statusEffects while it is being imported
globalThis.CONFIG ??= {
}
const {
  ownMonitorDocumentOf, adjustedMonitorBase, menuMonitorOf
} = await import('../modules/canvas/pan-crown/pan-radial-menu.js')

describe('an icon aimed at from the crown', () => {
  const withToken = {
    nodeUuid: 'Actor.a.Item.deck', tokenId: 'T1', itemUuid: 'Actor.a.Item.deck'
  }
  const noToken = {
    nodeUuid: 'Actor.s', actorId: 's', itemUuid: null
  }

  it('stands while its token is the one target', () => {
    expect(aimStands(withToken, ['T1'])).toBe(true)
    expect(aimStands(withToken, [])).toBe(false)
    expect(aimStands(withToken, ['T1', 'T2'])).toBe(false)
    expect(aimStands(withToken, ['T2'])).toBe(false)
  })

  it('with no token, stands while nothing is targeted', () => {
    expect(aimStands(noToken, [])).toBe(true)
    expect(aimStands(noToken, ['T1'])).toBe(false)
    expect(aimStands(null, [])).toBe(false)
  })

  it('goes when the user targets something else, or releases its token', () => {
    expect(aimAfterTarget(withToken, 'T1', true)).toBe(withToken)
    expect(aimAfterTarget(withToken, 'T2', false)).toBe(withToken)
    expect(aimAfterTarget(withToken, 'T2', true)).toBeNull()
    expect(aimAfterTarget(withToken, 'T1', false)).toBeNull()
    expect(aimAfterTarget(noToken, 'T1', true)).toBeNull()
    expect(aimAfterTarget(noToken, 'T1', false)).toBe(noToken)
  })
})

describe('the Matrix damage adjusted from the crown', () => {
  const monitor = (base, boxes = 10) => ({
    conditionMonitors: {
      matrix: {
        value: boxes, actual: {
          base, value: base
        }
      }
    }
  })

  it('belongs to the owner and the gamemaster, as on the sheet', () => {
    const item = {
      isOwner: true, system: monitor(2)
    }
    const node = {
      uuid: 'Item.x'
    }
    expect(ownMonitorDocumentOf(node, {
      resolve: () => item, isGM: false
    })).toBe(item)
    expect(ownMonitorDocumentOf(node, {
      resolve: () => ({
        ...item, isOwner: false
      }), isGM: false
    })).toBeNull()
    const foreign = {
      ...item, isOwner: false
    }
    expect(ownMonitorDocumentOf(node, {
      resolve: () => foreign, isGM: true
    })).toBe(foreign)
    // A module's icon is not the system's to write
    expect(ownMonitorDocumentOf({
      uuid: 'Item.x', contributed: true
    }, {
      resolve: () => item, isGM: true
    })).toBeNull()
  })

  it('falls back on the actor when the device has no monitor of its own (a persona)', () => {
    const actor = {
      isOwner: true, system: monitor(1, 9)
    }
    const persona = {
      isOwner: true, system: {
      }, actor
    }
    expect(ownMonitorDocumentOf({
      uuid: 'Item.p'
    }, {
      resolve: () => persona, isGM: false
    })).toBe(actor)
    expect(menuMonitorOf({
      uuid: 'Item.p'
    }, {
      resolve: () => persona, isGM: false
    })).toEqual({
      damage: 1, boxes: 9
    })
  })

  it('adds or takes away one box, never under 0 nor past the monitor (SR5 p. 228)', () => {
    expect(adjustedMonitorBase({
      system: monitor(2)
    }, 1)).toBe(3)
    expect(adjustedMonitorBase({
      system: monitor(2)
    }, -1)).toBe(1)
    expect(adjustedMonitorBase({
      system: monitor(0)
    }, -1)).toBeNull()
    expect(adjustedMonitorBase({
      system: monitor(10)
    }, 1)).toBeNull()
    expect(adjustedMonitorBase({
      system: {
      }
    }, 1)).toBeNull()
  })
})
