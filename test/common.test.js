/* eslint no-console: 0 */ // --> OFF
import { describe, expect, it } from "vitest"
const {
  i18n,
  getFilePath,
  replaceFilePathInUrl,
  getLinkPath,
} = require("../src/common")

describe("Translate", () => {
  it("Translates a localized string", () => {
    const localized = { en_us: null, en: null, de: "Südostasien und Ozeanien" }
    expect(i18n("de")(localized)).toBe("Südostasien und Ozeanien")
  })

  it("Should return an empty string", () => {
    const localized = { en_us: null, en: null, de: null }
    expect(i18n("de")(localized)).toBe("")
  })
})

describe("getFilePath", () => {
  it("Should return a valid path", () => {
    expect(
      getFilePath("http://w3id.org/class/hochschulfaecher/S393#", "html")
    ).toBe("/w3id.org/class/hochschulfaecher/S393.html")
  })
})

describe("replaceFilePathinUrl", () => {
  it("Should replace the file path", () => {
    expect(
      replaceFilePathInUrl(
        "http://w3id.org/class/hochschulfaecher/2",
        "http://w3id.org/class/hochschulfaecher/1"
      )
    ).toBe("/w3id.org/class/hochschulfaecher/1")
  })
})

describe("replaceFilePathinUrl with extension", () => {
  it("Should replace the file path and add an extension", () => {
    expect(
      replaceFilePathInUrl(
        "http://w3id.org/class/hochschulfaecher/2",
        "http://w3id.org/class/hochschulfaecher/1",
        "json"
      )
    ).toBe("/w3id.org/class/hochschulfaecher/1.json")
  })
})

describe("getLinkPath", () => {
  it("convert file path to gatsby link", () => {
    expect(
      getLinkPath("http://w3id.org/class/hochschulfaecher/1", "de.html")
    ).toBe("../1.de.html")
  })
})
