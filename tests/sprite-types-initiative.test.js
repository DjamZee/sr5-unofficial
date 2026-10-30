import {
  describe, it, expect
} from 'vitest'
import {
  registerSpriteType, spriteInitiativeBonus, spriteMatrixModifiers
} from '../modules/entities/actors/sprite-types.js'

// What a sprite type adds to the matrix initiative score: a constant, and optionally the Level once more
// (a type whose score is (Level x 3) + x, where the book's (Level x 2) + x comes from Level + Data Processing).

describe('spriteInitiativeBonus', () => {
  it('the book types: nothing, the Generalist included (Kill Code p. 110: its + 1 is its Data Processing)', () => {
    expect(spriteInitiativeBonus('courier', 5)).toBe(0)
    expect(spriteInitiativeBonus('generalist', 5)).toBe(0)
  })
  // Level + Data Processing + the type's bonus = the book's (Level x 2) + x (SR5 p. 261, Kill Code p. 100 VO / 110 VF)
  it('each book type reaches its (Level x 2) + x', () => {
    const book = {
      courier: 1, crack: 2, data: 4, fault: 1, machine: 3, companion: 0, generalist: 1
    }
    for (const [type, x] of Object.entries(book)) {
      for (const level of [1, 4, 6]) {
        const score = level + level + (spriteMatrixModifiers(type).dataProcessing ?? 0) + spriteInitiativeBonus(type, level)
        expect(score, `${type} ${level}`).toBe(level * 2 + x)
      }
    }
  })
  it('a registered type with initiativePerLevel', () => {
    registerSpriteType('tpNovaTest', {
      label: 'Nova', matrix: {
        dataProcessing: 1, initiative: 0
      }, initiativePerLevel: 1
    })
    expect(spriteInitiativeBonus('tpNovaTest', 4)).toBe(4)
    registerSpriteType('tpBadPerLevel', {
      label: 'x', initiativePerLevel: 'oops'
    })
    expect(spriteInitiativeBonus('tpBadPerLevel', 4)).toBe(0)
  })
  it('an unknown type: nothing', () => {
    expect(spriteInitiativeBonus('nope', 6)).toBe(0)
  })
})
