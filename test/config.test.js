const { loadConfig } = require("../src/common")

describe("Config Parsing", () => {
  it("Parses valid config file", () => {
    expect(
      loadConfig(
        "./test/data/config/config.yaml",
        "./test/data/config/config.example.yaml"
      )
    ).toStrictEqual({
      title: "Hello World",
      logo: "my-logo.png",
      tokenizer: "full",
      colors: {
        skoHubWhite: "rgb(255, 170, 170)",
        skoHubDarkGreen: "rgb(85, 0, 0)",
        skoHubMiddleGreen: "rgb(128, 21, 21)",
        skoHubLightGreen: "rgb(212, 106, 106)",
        skoHubThinGreen: "rgb(55, 250, 210)",
        skoHubBlackGreen: "rgb(5, 30, 30)",
        skoHubAction: "rgb(230, 0, 125)",
        skoHubNotice: "rgb(250, 180, 50)",
        skoHubDarkGrey: "rgb(155, 155, 155)",
        skoHubMiddleGrey: "rgb(200, 200, 200)",
        skoHubLightGrey: "rgb(235, 235, 235)",
      },
      fonts: {
        regular: {
          font_family: "Aladin",
          font_style: "normal",
          font_weight: 400,
          name: "aladin-v18-latin-regular",
        },
        bold: {
          font_family: "Alegreya Sans",
          font_style: "normal",
          font_weight: 700,
          name: "alegreya-sans-v24-latin-700",
        },
      },
    })
  })

  it("throws error if no title is provided", () => {
    expect(() =>
      loadConfig(
        "./test/data/config/config.invalid.yaml",
        "./test/data/config/config.example.yaml"
      )
    ).toThrow("A Title has to be provided! Please check your config.yaml")
  })

  it("does not replace the logo path if none is provided", () => {
    expect(
      loadConfig(
        "./test/data/config/config-no-logo.yaml",
        "./test/data/config/config.example.yaml"
      )
    ).toMatchObject({ logo: "" })
  })

  it("does replace tokenizer with default value, if none is provided", () => {
    expect(
      loadConfig(
        "./test/data/config/config-no-logo.yaml",
        "./test/data/config/config.example.yaml"
      )
    ).toMatchObject({ tokenizer: "full" })
  })

  it("does replace colors with default colors, if none or not all attributes are provided", () => {
    expect(
      loadConfig(
        "./test/data/config/config-not-all-colors.yaml",
        "./test/data/config/config.example.yaml"
      )
    ).toMatchObject({
      colors: {
        skoHubWhite: "rgb(255, 255, 255)",
        skoHubDarkGreen: "rgb(15, 85, 75)",
        skoHubMiddleGreen: "rgb(20, 150, 140)",
        skoHubLightGreen: "rgb(40, 200, 175)",
        skoHubThinGreen: "rgb(55, 250, 210)",
        skoHubBlackGreen: "rgb(5, 30, 30)",
        skoHubAction: "rgb(230, 0, 125)",
        skoHubNotice: "rgb(250, 180, 50)",
        skoHubDarkGrey: "rgb(155, 155, 155)",
        skoHubMiddleGrey: "rgb(200, 200, 200)",
        skoHubLightGrey: "rgb(235, 235, 235)",
      },
    })
  })

  it("does replace fonts with default fonts, if none or not all attributes are provided", () => {
    expect(
      loadConfig(
        "./test/data/config/config-not-all-fonts.yaml",
        "./test/data/config/config.example.yaml"
      )
    ).toMatchObject({
      fonts: {
        regular: {
          font_family: "Ubuntu",
          font_style: "normal",
          font_weight: 400,
          name: "ubuntu-v20-latin-regular",
        },
        bold: {
          font_family: "Ubuntu",
          font_style: "normal",
          font_weight: 700,
          name: "ubuntu-v20-latin-700",
        },
      },
    })
  })
})
