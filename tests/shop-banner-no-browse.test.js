import {
  describe, it, expect, afterEach, vi
} from 'vitest'
import {
  SR5ShopVendor
} from '../modules/interface/shop-vendor.js'
import {
  vendorBanner
} from '../modules/system/item-workshop-apply.js'

// Ninon#7316 (31/10): at a player's, opening the shop wrote "banner folder … could not be read": a browse without the right
describe('the banner folder of an account without the right to browse files', () => {
  const saved = {
    game: globalThis.game, foundry: globalThis.foundry
  }
  afterEach(() => {
    globalThis.game = saved.game
    globalThis.foundry = saved.foundry
    SR5ShopVendor._bannerCache = undefined
    vi.restoreAllMocks()
  })

  const setUp = canBrowse => {
    const browse = vi.fn(async () => ({
      files: ['banners/Tuner-3.webp']
    }))
    globalThis.game = {
      ...saved.game,
      user: {
        can: right => right === 'FILES_BROWSE' && canBrowse
      },
      settings: {
        get: () => 'banners'
      },
    }
    globalThis.foundry = {
      ...saved.foundry,
      applications: {
        ...saved.foundry?.applications,
        apps: {
          FilePicker: {
            implementation: {
              browse
            }
          }
        }
      },
    }
    return browse
  }

  it('asks the server nothing and warns of nothing', async () => {
    const browse = setUp(false)
    const warn = vi.spyOn(console, 'warn')
    expect(await SR5ShopVendor.bannerFiles()).toEqual([])
    expect(browse).not.toHaveBeenCalled()
    expect(warn).not.toHaveBeenCalled()
  })

  it('keeps the banner, under its usual name', async () => {
    setUp(false)
    expect(await vendorBanner('tuner')).toMatch(/^banners\/.+1\.webp$/)
  })

  it('still reads the folder for an account with the right', async () => {
    const browse = setUp(true)
    expect(await SR5ShopVendor.bannerFiles()).toEqual(['banners/Tuner-3.webp'])
    expect(browse).toHaveBeenCalledWith('data', 'banners')
  })
})
