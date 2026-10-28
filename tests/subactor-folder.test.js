import {
  describe, it, expect, beforeEach, vi
} from 'vitest'

// A spirit, a drone, a bag… brought out of a sheet goes next to it in the sidebar (DjamZ, 28/10): the sheet's folder,
// or one "Temporary actors" folder for a sheet at the root or from a compendium, found by its flag

vi.mock('../modules/system/utilitySystem.js', () => ({
  SR5_SystemHelpers: {
    srLog: vi.fn()
  },
}))

const {
  subActorFolderId, withSubActorFolder, TEMPORARY_FOLDER_FLAG
} = await import('../modules/entities/actors/subactor-folder.js')

let folders, mode, isGM, created

function folder(id, flags = {
}) {
  return {
    id, type: 'Actor', flags,
    getFlag: (scope, key) => flags[scope]?.[key],
  }
}

beforeEach(() => {
  folders = [folder('f1')]
  mode = 'creator'
  isGM = true
  created = 0
  globalThis.game = {
    ...globalThis.game,
    user: {
      get isGM() { return isGM }
    },
    folders: {
      get: id => folders.find(f => f.id === id),
      find: fn => folders.find(fn),
    },
    actors: {
      get: () => null
    },
    settings: {
      ...globalThis.game?.settings,
      get: () => mode
    },
    i18n: {
      ...globalThis.game?.i18n, localize: k => k
    },
  }
  globalThis.Folder = {
    implementation: {
      canUserCreate: user => user.isGM,
      create: async data => {
        created++
        await Promise.resolve()
        const f = folder(`tmp${created}`, data.flags)
        folders.push(f)
        return f
      },
    },
  }
})

const inFolder = {
  folder: {
    id: 'f1', type: 'Actor'
  }
}
const atRoot = {
  folder: null
}

describe('folder of a sub-actor', () => {
  it('goes into the folder of the sheet', async () => {
    expect(await subActorFolderId(inFolder)).toBe('f1')
  })

  it('a token actor uses its base actor folder', async () => {
    expect(await subActorFolderId({
      isToken: true, token: {
        baseActor: inFolder
      }
    })).toBe('f1')
  })

  it('a sheet at the root makes the temporary folder once, then reuses it', async () => {
    const [a, b] = await Promise.all([subActorFolderId(atRoot), subActorFolderId(atRoot)])
    expect(a).toBe('tmp1')
    expect(b).toBe('tmp1')
    expect(await subActorFolderId(atRoot)).toBe('tmp1')
    expect(created).toBe(1)
    expect(folders.at(-1).flags.sr5[TEMPORARY_FOLDER_FLAG]).toBe(true)
  })

  it('finds the temporary folder by its flag, renamed or not', async () => {
    folders.push(folder('renamed', {
      sr5: {
        [TEMPORARY_FOLDER_FLAG]: true
      }
    }))
    expect(await subActorFolderId(atRoot)).toBe('renamed')
    expect(created).toBe(0)
  })

  it('a sheet from a compendium goes to the temporary folder', async () => {
    expect(await subActorFolderId({
      ...inFolder, pack: 'world.pnj'
    })).toBe('tmp1')
  })

  it('"temporary" mode ignores the sheet folder', async () => {
    mode = 'temporary'
    expect(await subActorFolderId(inFolder)).toBe('tmp1')
  })

  it('"root" mode leaves the actor at the root, as before', async () => {
    mode = 'root'
    expect(await withSubActorFolder({
      name: 'x'
    }, inFolder)).toEqual({
      name: 'x'
    })
  })

  it('a player who cannot make a folder leaves the actor at the root, without error', async () => {
    isGM = false
    expect(await subActorFolderId(atRoot)).toBeNull()
    expect(created).toBe(0)
  })

  it('a failed creation falls back to the root', async () => {
    Folder.implementation.create = async () => { throw new Error('refused') }
    expect(await subActorFolderId(atRoot)).toBeNull()
  })
})
