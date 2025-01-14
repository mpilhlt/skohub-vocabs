const yaml = require("js-yaml")
const fs = require("fs")

const i18n = (lang) => (localized) => localized[lang] || ""

const getFilePath = (url, extension) => {
  let path = url
    .replace(/^https?:\//, "")
    .split("#")
    .shift()
  path.endsWith("/") && (path += "index")
  return extension ? `${path}.${extension}` : path
}

/**
Get File Path for Gatsby Link component
@param {string} path
@param {string} extension
@returns {string} linkPath
@example
// returns "../1.de.html"
getLinkPath("http://w3id.org/class/hochschulfaecher/1", "de.html")
**/
const getLinkPath = (path, extension) => {
  const linkPath = "../" + getFilePath(path).split("/").pop() + "." + extension
  return linkPath
}

/**
Replaces the last part (Filepath) of a given url with the last part (Filepath) of another url
@param {string} url
@param {string} replaceId
@param {string} [extension] - extension to be added
@returns {string} path
**/
const replaceFilePathInUrl = (url, replaceId, extension) => {
  // we use getFilePath function to add a missing "index" if necessary
  const path = getFilePath(url)
    .replace(/\/[^\/]*$/, "/" + getFilePath(replaceId).split("/").pop())
    .split("#")
    .shift()
  return extension ? `${path}.${extension}` : path
}

const getPath = (url) => url.replace(/^https?:\/\//, "")

const getFragment = (url) => new URL(url).hash

const getDomId = (url) => {
  const fragment = getFragment(url)
  return fragment ? fragment.substr(1) : url
}

/**
 * Parses languages from a json ld graph (Concept or Concept Scheme)
 * @param {array} graph
 * @returns {array} languages - found languages
 */
const parseLanguages = (graph) => {
  const languages = new Set()
  const parse = (arrayOfObj) => {
    for (let obj of arrayOfObj) {
      // Concept Schemes
      obj?.title &&
        Object.keys(obj.title).forEach((l) => obj.title[l] && languages.add(l))
      // Concepts
      obj?.prefLabel &&
        Object.keys(obj.prefLabel).forEach(
          (l) => obj.prefLabel[l] && languages.add(l)
        )
      obj?.altLabel &&
        Object.keys(obj.altLabel).forEach(
          (l) => obj.altLabel[l] && languages.add(l)
        )
      obj?.hiddenLabel &&
        Object.keys(obj.hiddenLabel).forEach(
          (l) => obj.hiddenLabel[l] && languages.add(l)
        )
      obj?.hasTopConcept && parse(obj.hasTopConcept)
      obj?.narrower && parse(obj.narrower)
    }
  }
  parse(graph)
  return languages
}

/**
 * Loads and parses the config file.
 * If no configFile is provided it will use the default config file.
 * @param {string} configFile
 * @param {string} defaultFile
 * @returns {object} config
 */
const loadConfig = (configFile, defaultFile) => {
  let userConfig
  const defaults = yaml.load(fs.readFileSync(defaultFile, "utf8"))

  try {
    userConfig = yaml.load(fs.readFileSync(configFile, "utf8"))
  } catch (e) {
    // eslint-disable-next-line no-console
    // TODO when #253 is further investigated this might be turned on again
    // console.log("no user config provided, using default config")
    userConfig = defaults
  }

  if (!userConfig.ui.title) {
    throw Error("A Title has to be provided! Please check your config.yaml")
  }

  /* the values for these attributes are necessary
  for SkoHub Vocabs to work correctly. Therefore we use
  default values from config.example.yaml if there are 
  no values provided
  */
  const config = {
    title: userConfig.ui.title,
    logo: userConfig.ui.logo || "",
    tokenizer: userConfig.tokenizer || defaults.tokenizer,
    colors: userConfig.ui.colors || defaults.ui.colors,
    fonts: userConfig.ui.fonts || defaults.ui.fonts,
    searchableAttributes:
      userConfig.searchableAttributes || defaults.searchableAttributes,
  }

  // check if all relevant colors are contained, otherwise use default colors
  const checkColors = () => {
    const neededColors = [
      "skoHubWhite",
      "skoHubDarkColor",
      "skoHubMiddleColor",
      "skoHubLightColor",
      "skoHubThinColor",
      "skoHubBlackColor",
      "skoHubAction",
      "skoHubNotice",
      "skoHubDarkGrey",
      "skoHubMiddleGrey",
      "skoHubLightGrey",
    ]
    if (neededColors.every((r) => Object.keys(config.colors).includes(r))) {
      return true
    } else {
      // eslint-disable-next-line no-console
      // console.log("some needed colors are not defined, using default colors")
      return false
    }
  }

  const checkFonts = () => {
    const neededProps = ["font_family", "font_style", "font_weight", "name"]
    if (
      neededProps.every((r) => Object.keys(config.fonts.regular).includes(r)) &&
      neededProps.every((r) => Object.keys(config.fonts.bold).includes(r))
    ) {
      return true
    } else {
      // eslint-disable-next-line no-console
      // console.log(
      //   "Some necessary font props were not given, using default fonts"
      // )
      return false
    }
  }

  if (!checkColors()) {
    config.colors = defaults.ui.colors
  }

  if (!checkFonts()) {
    config.fonts = defaults.ui.fonts
  }
  return config
}

module.exports = {
  i18n,
  getPath,
  getFilePath,
  replaceFilePathInUrl,
  getFragment,
  getDomId,
  getLinkPath,
  parseLanguages,
  loadConfig,
}
