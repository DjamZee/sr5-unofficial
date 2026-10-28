// Monad amplification (Whisper Nets p. 150, house rule of the Concepteur; arbitrage de DjamZ, 28/10): +4 at most,
// one box only past the natural maximum (Physical or Stun as the attribute), then the Nanite Volume lowered 1 minute.
import {
  describe, it, expect, vi, beforeEach, afterEach
} from 'vitest'

// config.js writes into CONFIG at import time, and the sheet builds on Foundry's actor sheet
vi.hoisted(() => {
  globalThis.CONFIG ??= {
  }
  globalThis.foundry.applications.sheets ??= {
    ActorSheetV2: class {
      _onRender(){}
    }
  }
  globalThis.foundry.abstract.TypeDataModel.migrateData ??= (source) => source

  // Stand-ins for Foundry's data fields. ArrayField and ObjectField cast a value as Foundry 13.351 does
  // (common/data/fields.mjs, ObjectField#_cast and ArrayField#_cast)
  class Field {
    constructor(options) {
      this.options = options
    }
    _cast(value) {
      return value
    }
  }
  class SchemaField extends Field {
    constructor(fields, options) {
      super(options)
      this.fields = fields
    }
  }
  class ObjectField extends Field {
    _cast(value) {
      return (value?.constructor === Object) ? value : {
      }
    }
  }
  class ArrayField extends Field {
    constructor(element, options) {
      super(options)
      this.element = element
    }
    _cast(value) {
      if (value?.constructor === Object) {
        const arr = []
        for (const [k, v] of Object.entries(value)) {
          const i = Number(k)
          if (Number.isInteger(i) && (i >= 0)) arr[i] = v
        }
        return arr
      }
      return value instanceof Array ? value : [value]
    }
  }
  globalThis.foundry.data = {
    fields: new Proxy({
      SchemaField, ArrayField, ObjectField
    }, {
      get: (target, name) => target[name] ?? Field
    })
  }
})

import {
  SR5Combat
} from '../modules/system/srcombat.js'
import {
  SR5_ActorHelper
} from '../modules/entities/actors/entityActor-helpers.js'
import {
  SR5_EntityHelpers
} from '../modules/entities/helpers.js'
import {
  amplificationValue, amplifiedKey, amplificationDamageType, amplificationEndBoxes
} from '../modules/system/nanite-amplification.js'

function collection(docs){
  const list = [...docs]
  list.get = (id) => list.find(d => d.id === id)
  return list
}

function monitor(max, damage){
  return {
    value: max, base: max, modifiers: [], actual: {
      value: damage, base: damage, modifiers: []
    }
  }
}

beforeEach(() => {
  globalThis.ui = {
    notifications: {
      info: vi.fn(), warn: vi.fn()
    }
  }
})
afterEach(() => {
  vi.restoreAllMocks()
})

function amplifiedActor({
  key = 'agility', augmented = 7, value = '3', stun = 0, physical = 0, metatype = 'human', exceptional = 0 
} = {
}){
  const amp = {
    id: 'amp', type: 'itemEffect', name: 'Amplification',
    system: {
      type: 'naniteAmplification', value, durationType: 'round', duration: 1,
      customEffects: {
        0: {
          category: 'characterAttributes', target: `system.attributes.${key}.augmented`, type: 'value', value: Number(value) 
        } 
      }
    },
    update: vi.fn(async () => {}),
  }
  const quality = {
    id: 'q', type: 'itemQuality', name: 'Attribut exceptionnel',
    system: {
      customEffects: exceptional ? {
        0: {
          target: `system.attributes.${key}.maximum`, value: exceptional 
        } 
      } : {
      } 
    }
  }
  return {
    id: 'a1', name: 'Test', type: 'actorPc', isToken: false, effects: [], items: collection([amp, quality]),
    system: {
      biography: {
        characterMetatype: metatype 
      },
      attributes: {
        [key]: {
          augmented: {
            value: augmented 
          } 
        } 
      },
      conditionMonitors: {
        stun: monitor(10, stun), physical: monitor(10, physical), overflow: monitor(4, 0)
      }, specialProperties: {
      }
    },
    update: vi.fn(async () => {}),
    deleteEmbeddedDocuments: vi.fn(async () => {}),
    createEmbeddedDocuments: vi.fn(async () => []),
  }
}

async function endAmplification(actor){
  vi.spyOn(SR5Combat, 'getActorFromCombatant').mockReturnValue(actor)
  vi.spyOn(SR5_EntityHelpers, 'deleteEffectOnActor').mockImplementation(async () => {})
  vi.spyOn(SR5_ActorHelper, 'createKoEffect').mockImplementation(async () => {})
  vi.spyOn(SR5_ActorHelper, 'createDeadEffect').mockImplementation(async () => {})
  await SR5Combat.manageTurnEnd({
    name: 'Test'
  })
}

describe('monad amplification, the boost', () => {
  it('is the hits, at most the Nanite Volume and +4', () => {
    expect(amplificationValue(3, 6)).toBe(3)
    expect(amplificationValue(6, 8)).toBe(4)
    expect(amplificationValue(5, 2)).toBe(2)
    expect(amplificationValue(5, undefined)).toBe(4)
    expect(amplificationValue(0, 6)).toBe(0)
  })
  it('reads the attribute of its target', () => {
    expect(amplifiedKey('system.attributes.logic.augmented')).toBe('logic')
    expect(amplifiedKey('system.specialAttributes.nanite.augmented')).toBe(null)
    expect(amplificationDamageType('logic')).toBe('stun')
    expect(amplificationDamageType('agility')).toBe('physical')
  })
  it('costs one box only past the natural maximum, Exceptional Attribute included', () => {
    expect(amplificationEndBoxes({
      metatype: 'human', key: 'agility', augmented: 6 
    })).toBe(0)
    expect(amplificationEndBoxes({
      metatype: 'human', key: 'agility', augmented: 7 
    })).toBe(1)
    expect(amplificationEndBoxes({
      metatype: 'human', key: 'agility', augmented: 7, exceptional: 1 
    })).toBe(0)
    expect(amplificationEndBoxes({
      metatype: 'troll', key: 'strength', augmented: 10 
    })).toBe(0)
    expect(amplificationEndBoxes({
      metatype: '', key: 'agility', augmented: 12 
    })).toBe(0)
  })
})

describe('end of a monad amplification', () => {
  it('past the maximum: one Physical box for a physical attribute, then the Nanite Volume lowered for 20 turns', async () => {
    const actor = amplifiedActor({
      key: 'agility', augmented: 7, value: '3', physical: 2 
    })
    await endAmplification(actor)
    const update = actor.update.mock.calls.at(-1)[0]
    expect(update['system.conditionMonitors.physical.actual.base']).toBe(3)
    expect(update['system.conditionMonitors.stun.actual.base']).toBe(0)
    const [[, docs]] = actor.createEmbeddedDocuments.mock.calls
    expect(docs[0]['system.duration']).toBe(20)
    expect(docs[0]['system.customEffects']['0'].target).toBe('system.specialAttributes.nanite.augmented')
    expect(docs[0]['system.customEffects']['0'].value).toBe(-3)
  })
  it('a mental attribute takes a Stun box', async () => {
    const actor = amplifiedActor({
      key: 'logic', augmented: 8, value: '2', stun: 1 
    })
    await endAmplification(actor)
    expect(actor.update.mock.calls.at(-1)[0]['system.conditionMonitors.stun.actual.base']).toBe(2)
  })
  it('under the maximum: no damage, the Nanite Volume still lowered', async () => {
    const actor = amplifiedActor({
      key: 'strength', augmented: 6, value: '2' 
    })
    await endAmplification(actor)
    expect(actor.update).not.toHaveBeenCalled()
    expect(actor.createEmbeddedDocuments).toHaveBeenCalledTimes(1)
  })
  it('leaves the head case boost to its own rule', async () => {
    const actor = amplifiedActor()
    actor.items[0].system.type = 'naniteAttributeBoost'
    await endAmplification(actor)
    expect(actor.createEmbeddedDocuments).not.toHaveBeenCalled()
    expect(actor.update.mock.calls.at(-1)[0]['system.conditionMonitors.stun.actual.base']).toBe(3)
  })
})
