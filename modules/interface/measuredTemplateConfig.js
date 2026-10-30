import {
  SR5 
} from "../config.js"
import {
  clampSceneNoise
} from "../system/scene-noise.js"

export default class SR5MeasuredTemplateConfig extends foundry.applications.sheets.MeasuredTemplateConfig {

  static PARTS = {
    ...foundry.applications.sheets.MeasuredTemplateConfig.PARTS,
    sr5tabs: {
      template: "systems/sr5/templates/interface/template-sr5-tabs.hbs" 
    }
  }

  static TABS = {
    sheet: {
      tabs: [
        {
          id: "main", icon: "fa-solid fa-ruler-combined", label: "CONTROLS.MeasureConfigHint" 
        },
        {
          id: "environmentalMod", icon: "fa-solid fa-cloud-sun-rain", label: "SR5.EnvironmentalModifiers" 
        },
      ],
      initial: "main"
    }
  }

  async _preparePartContext(partId, context, options) {
    context = await super._preparePartContext(partId, context, options)
    if (partId === "sr5tabs") {
      context.sr5lists = SR5
    }
    return context
  }

  //The zones are shortcuts: they fill the noise rating, which the GM may then change (SR5 p. 232-233)
  computeMatrixNoise(element) {
    const read = (name) => element?.querySelector(`[name="flags.sr5.${name}"]`)?.value ?? this.document.flags.sr5?.[name]
    return clampSceneNoise((parseInt(read("matrixSpam")) || 0) + (parseInt(read("matrixStatic")) || 0))
  }

  updateMatrixNoise(element) {
    const noiseField = element.querySelector('[name="flags.sr5.matrixNoise"]')
    if (noiseField) noiseField.value = this.computeMatrixNoise(element)
  }

  _prepareSubmitData(event, form, formData, updateData) {
    const submitData = super._prepareSubmitData(event, form, formData, updateData)
    const typed = form?.querySelector('[name="flags.sr5.matrixNoise"]')?.value
    foundry.utils.setProperty(submitData, "flags.sr5.matrixNoise", clampSceneNoise(typed ?? this.computeMatrixNoise(form)))
    return submitData
  }

  async _onRender(context, options) {
    await super._onRender(context, options)

    const matrixSpam = this.element.querySelector('[name="flags.sr5.matrixSpam"]')
    if (matrixSpam) matrixSpam.addEventListener("change", _ev => {
      this.updateMatrixNoise(this.element)
    })

    const matrixStatic = this.element.querySelector('[name="flags.sr5.matrixStatic"]')
    if (matrixStatic) matrixStatic.addEventListener("change", _ev => {
      this.updateMatrixNoise(this.element)
    })
  }
}
