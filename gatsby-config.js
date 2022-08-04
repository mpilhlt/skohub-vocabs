require("dotenv").config()

module.exports = {
  siteMetadata: {
    title: `SkoHub-Vocabs`,
    description: `Static site generator for Simple Knowledge Management Systems (SKOS)`,
    author: `@gatsbyjs`,
  },
  // assetPrefix: '__GATSBY_RELATIVE_PATH__',
  // pathPrefix: '.',
  pathPrefix: `${process.env.BASEURL || ''}`,
  plugins: [
    `gatsby-plugin-emotion`,
    {
      resolve: `gatsby-source-filesystem`,
      options: {
        name: `images`,
        path: `${__dirname}/src/images`,
      },
    },
    `gatsby-transformer-sharp`,
    `gatsby-plugin-sharp`,
    // `gatsby-plugin-relative-paths`,
    // `@wardpeet/gatsby-plugin-static-site`,
    {
      resolve: `gatsby-source-filesystem`,
      options: {
        name: 'data',
        path: `${__dirname}/data`,
      },
    },
  ],
}
