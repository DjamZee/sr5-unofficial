import {
  mountContacts
} from "./nc-contacts.js"
import {
  mountNetwork
} from "./nc-network.js"
import {
  ncEnabled
} from "./nc-registry.js"

// The window of the Network or of the Contacts, for everyone (the token controls' buttons, or Landing's GM window and
// API). The view mounts at each render and unmounts when the window closes: no listener stays behind.

const MOUNTS = {
  network: mountNetwork, contacts: mountContacts
}

export class SR5NetworkContactsWindow extends foundry.applications.api.ApplicationV2 {

  static DEFAULT_OPTIONS = {
    classes: ["sr5-nc-window"],
    window: {
      resizable: true
    },
  }

  /** Opens (or brings to front) the window "network" or "contacts". */
  static open(mode){
    if (!MOUNTS[mode]) return null
    if (!ncEnabled()) return ui.notifications.warn(game.i18n.localize("SR5.NC_Disabled"))
    const id = `sr5-nc-${mode}`
    const [title, icon] = mode === "network" ? ["SR5.NC_Networks", "fa-network-wired"] : ["SR5.NC_Contacts", "fa-address-book"]
    // Made for the deck's page: the window is large
    const position = {
      width: Math.min(1500, window.innerWidth - 80), height: Math.min(900, window.innerHeight - 80)
    }
    const app = foundry.applications.instances.get(id) ?? new SR5NetworkContactsWindow({
      id, mode, window: {
        title, icon: `fa-solid ${icon}`
      }, position
    })
    return app.render({
      force: true
    })
  }

  constructor(options){
    super(options)
    this.mode = options.mode
  }

  async _renderHTML(){
    return `<div class="sr5-nc-frame"><div class="sr5-nc-main sr5-nc"></div><div class="sr5-nc-side sr5-nc"></div></div>`
  }

  _replaceHTML(result, content){
    // The view draws itself again: it is mounted once per render of the window
    this.view?.unmount()
    content.innerHTML = result
    this.view = MOUNTS[this.mode]({
      main: content.querySelector(".sr5-nc-main"), side: content.querySelector(".sr5-nc-side")
    })
  }

  _onClose(options){
    this.view?.unmount()
    this.view = null
    return super._onClose?.(options)
  }
}
