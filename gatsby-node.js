/* eslint-disable no-console */
/**
 * Implement Gatsby's Node APIs in this file.
 *
 * See: https://www.gatsbyjs.org/docs/node-apis/
 */
const jsonld = require("jsonld")
const n3 = require("n3")
const { DataFactory } = n3
const { namedNode } = DataFactory
const path = require("path")
const fs = require("fs-extra")
const { Index, Document } = require("flexsearch")
const omitEmpty = require("omit-empty")
const { i18n, getFilePath, parseLanguages } = require("./src/common")
const context = require("./src/context")
const queries = require("./src/queries")
const types = require("./src/types")

require("dotenv").config()
require("graceful-fs").gracefulify(require("fs"))

const languages = new Set()
const languagesByCS = {}
const inverses = {
  "http://www.w3.org/2004/02/skos/core#narrower":
    "http://www.w3.org/2004/02/skos/core#broader",
  "http://www.w3.org/2004/02/skos/core#broader":
    "http://www.w3.org/2004/02/skos/core#narrower",
  "http://www.w3.org/2004/02/skos/core#related":
    "http://www.w3.org/2004/02/skos/core#related",
  "http://www.w3.org/2004/02/skos/core#hasTopConcept":
    "http://www.w3.org/2004/02/skos/core#topConceptOf",
  "http://www.w3.org/2004/02/skos/core#topConceptOf":
    "http://www.w3.org/2004/02/skos/core#hasTopConcept",
}

jsonld.registerRDFParser("text/turtle", (ttlString) => {
  const quads = new n3.Parser().parse(ttlString)
  const store = new n3.Store()
  store.addQuads(quads)
  quads.forEach((quad) => {
    quad.object.language &&
      languages.add(quad.object.language.replace("-", "_"))
    inverses[quad.predicate.id] &&
      store.addQuad(
        quad.object,
        namedNode(inverses[quad.predicate.id]),
        quad.subject,
        quad.graph
      )
  })
  return store.getQuads()
})

const createData = ({ path, data }) =>
  fs.outputFile(`public${path}`, data, (err) => err && console.error(err))

const getTurtleFiles = function (dirPath, arrayOfFiles) {
  const files = fs.readdirSync(dirPath)
  arrayOfFiles = arrayOfFiles || []

  files.forEach(function (file) {
    if (fs.statSync(dirPath + "/" + file).isDirectory()) {
      arrayOfFiles = getTurtleFiles(dirPath + "/" + file, arrayOfFiles)
    } else {
      file.endsWith(".ttl") &&
        arrayOfFiles.push(path.join(__dirname, dirPath, "/", file))
    }
  })
  return arrayOfFiles
}

/**
 * Exports an index and saves it
 * @param {object} index
 * @param {object} conceptScheme
 * @param {string} language
 *
 **/
const exportIndex = (index, conceptScheme, language) => {
  index.export(function (key, data) {
    const path = getFilePath(
      (conceptScheme.id.endsWith("/")
        ? conceptScheme.id.slice(0, -1)
        : conceptScheme.id) + `-cs/search/${language}/${key}`,
      `json`
    )
    createData({
      path,
      data: data !== undefined ? data : "",
    })
  })
}

exports.onPreBootstrap = async ({ createContentDigest, actions, getNode }) => {
  const { createNode, createNodeField } = actions
  const ttlFiles = getTurtleFiles("./data", [])
  if (ttlFiles.length === 0)
    throw new Error(`
    ⛔ Data folder is empty, aborting. 
      Add some turtle files to data folder to get beautiful rendered vocabs.
    `)
  console.info(`Found these turtle files:`)
  ttlFiles.forEach((e) => console.info(e))
  for (const f of ttlFiles) {
    const ttlString = fs.readFileSync(f).toString()
    const doc = await jsonld.fromRDF(ttlString, { format: "text/turtle" })
    const compacted = await jsonld.compact(doc, context.jsonld)

    const conceptSchemeIds = compacted["@graph"]
      .filter((node) => node.type === "ConceptScheme")
      .map((n) => n.id)
    conceptSchemeIds.forEach((id) => {
      languagesByCS[id] = parseLanguages(compacted["@graph"])
    })

    // eslint-disable-next-line no-loop-func
    await compacted["@graph"].forEach((graph) => {
      const {
        narrower,
        narrowerTransitive,
        narrowMatch,
        broader,
        broaderTransitive,
        broadMatch,
        exactMatch,
        closeMatch,
        related,
        relatedMatch,
        inScheme,
        topConceptOf,
        hasTopConcept,
        member,
        ...properties
      } = graph
      const type = Array.isArray(properties.type)
        ? properties.type.find((t) => [
            "Concept",
            "ConceptScheme",
            "Collection",
          ])
        : properties.type

      const inSchemeNodes = [...(inScheme || []), ...(topConceptOf || [])]

      const nodeIds = inSchemeNodes.map((o) => o.id)
      const inSchemeFiltered = inSchemeNodes.filter(
        ({ id }, index) => !nodeIds.includes(id, index + 1)
      )
      const node = {
        ...properties,
        type,
        children: (narrower || hasTopConcept || []).map(
          (narrower) => narrower.id
        ),
        parent: (broader && broader.id) || null,
        /**
         * to also display concept schemes outside of skohub vocabs we need a dedicated
         * field. This field is inSchemeAll.
         * inScheme___NODE is linked in types.js with ConceptScheme type. Therefore
         * a concept scheme not present in the graphql data layer would not be found and not
         * be shown on the concepts page.
         */
        inSchemeAll:
          inSchemeFiltered.map((inScheme) => ({ id: inScheme.id })) || null,
        // topConceptOf nodes are also set to inScheme to facilitate parsing and filtering later
        inScheme___NODE:
          inSchemeFiltered.map((inScheme) => inScheme.id) || null,
        topConceptOf___NODE:
          (topConceptOf || []).map((topConceptOf) => topConceptOf.id) || null,
        narrower___NODE: (narrower || []).map((narrower) => narrower.id),
        narrowerTransitive___NODE: (narrowerTransitive || []).map(
          (narrowerTransitive) => narrowerTransitive.id
        ),
        narrowMatch,
        hasTopConcept___NODE: (hasTopConcept || []).map(
          (topConcept) => topConcept.id
        ),
        broader___NODE: (broader && broader.id) || null,
        broaderTransitive___NODE:
          (broaderTransitive && broaderTransitive.id) || null,
        broadMatch,
        exactMatch,
        closeMatch,
        related___NODE: (related || []).map((related) => related.id),
        relatedMatch,
        internal: {
          contentDigest: createContentDigest(graph),
          type,
        },
        member___NODE: (member || []).map((member) => member.id),
      }
      if (type === "Concept") {
        Object.assign(node, {})
      }
      ;["Concept", "ConceptScheme", "Collection"].includes(type) &&
        createNode(node)
    })
  }
  // add language information to concept schemes
  Object.keys(languagesByCS).forEach((id) => {
    const node = getNode(id)
    createNodeField({
      node,
      name: "languages",
      value: Array.from(languagesByCS[id]),
    })
  })
}

exports.sourceNodes = async ({ actions }) => {
  const { createTypes } = actions
  createTypes(types(languages))
}

exports.createPages = async ({ graphql, actions: { createPage } }) => {
  const memberOf = {}

  // Build collection pages
  const collections = await graphql(queries.allCollection(languages))
  await Promise.all(
    collections.data.allCollection.edges.map(async ({ node: collection }) => {
      // store collection membership for concepts
      collection.member.forEach((m) => {
        if (memberOf.hasOwnProperty(m.id)) {
          memberOf[m.id].push(collection)
        } else {
          memberOf[m.id] = [collection]
        }
      })

      const json = omitEmpty(Object.assign({}, collection, context.jsonld))
      const jsonld = omitEmpty(Object.assign({}, collection, context.jsonld))
      languages.forEach((language) =>
        createPage({
          path: getFilePath(collection.id, `${language}.html`),
          component: path.resolve(`./src/components/Collection.jsx`),
          context: {
            language,
            node: collection,
          },
        })
      )
      createData({
        path: getFilePath(collection.id, "json"),
        data: JSON.stringify(json, null, 2),
      })
      createData({
        path: getFilePath(collection.id, "jsonld"),
        data: JSON.stringify(jsonld, null, 2),
      })
    })
  )

  const {
    data: {
      site: {
        siteMetadata: { tokenizer },
      },
    },
  } = await graphql(queries.tokenizer)
  const conceptSchemes = await graphql(queries.allConceptScheme(languages))

  conceptSchemes.errors && console.error(conceptSchemes.errors)

  await Promise.all(
    conceptSchemes.data.allConceptScheme.edges.map(
      async ({ node: conceptScheme }) => {
        const languagesOfCS = languagesByCS[conceptScheme.id]
        const indexes = Object.fromEntries(
          [...languagesOfCS].map((l) => {
            const index = new Document({
              tokenize: tokenizer,
              charset: "latin",
              id: "id",
              document: {
                id: "id",
                // store: ["prefLabel", "altLabel"], /*  not working when importing, bug in flexsearch */
                index: [
                  "notation",
                  "prefLabel",
                  "altLabel",
                  "hiddenLabel",
                  "definition",
                  "example",
                ],
              },
            })
            return [l, index]
          })
        )

        const conceptsInScheme = await graphql(
          queries.allConcept(conceptScheme.id, languages)
        )
        const embeddedConcepts = []
        conceptsInScheme.data.allConcept.edges.forEach(({ node: concept }) => {
          const json = omitEmpty(Object.assign({}, concept, context.jsonld))
          const jsonld = omitEmpty(Object.assign({}, concept, context.jsonld))

          if (getFilePath(concept.id) === getFilePath(conceptScheme.id)) {
            /**
             * embed concepts in concept scheme
             * hashURIs have to be embedded in the concept scheme directly
             * since we can't add a dedicated .json for them 'cause of the way their URI is structured.
             * E.g. http://example.org/hashURIConceptScheme.de.html#concept1
             *                                                  ^--- its always the concept scheme where
             *                                                        we end when looking for a .json
             */
            embeddedConcepts.push({ json, jsonld })
          } else {
            // create pages and data
            languagesOfCS.forEach((language) =>
              createPage({
                path: getFilePath(concept.id, `${language}.html`),
                component: path.resolve(`./src/components/Concept.jsx`),
                context: {
                  language,
                  node: concept,
                  collections: memberOf.hasOwnProperty(concept.id)
                    ? memberOf[concept.id]
                    : [],
                },
              })
            )
            createData({
              path: getFilePath(concept.id, "json"),
              data: JSON.stringify(json, null, 2),
            })
            createData({
              path: getFilePath(concept.id, "jsonld"),
              data: JSON.stringify(jsonld, null, 2),
            })
          }
          // add labels to index
          languagesOfCS.forEach((language) => {
            const document = {
              id: concept.id,
              prefLabel: i18n(language)(concept.prefLabel),
              ...(concept.altLabel &&
                Object.hasOwn(concept.altLabel, language) && {
                  altLabel: i18n(language)(concept.altLabel),
                }),
              ...(concept.hiddenLabel &&
                Object.hasOwn(concept.hiddenLabel, language) && {
                  hiddenLabel: i18n(language)(concept.hiddenLabel),
                }),
              ...(concept.definition &&
                Object.hasOwn(concept.definition, language) && {
                  definition: i18n(language)(concept.definition),
                }),
              ...(concept.example &&
                Object.hasOwn(concept.example, language) && {
                  example: i18n(language)(concept.example),
                }),
              notation: concept.notation,
            }
            indexes[language].add(document)
          })
        })
        languagesOfCS.forEach((language) =>
          createPage({
            path: getFilePath(conceptScheme.id, `${language}.html`),
            component: path.resolve(`./src/components/ConceptScheme.jsx`),
            context: {
              language,
              node: conceptScheme,
              embed: embeddedConcepts,
            },
          })
        )
        createData({
          path: getFilePath(conceptScheme.id, "json"),
          data: JSON.stringify(
            omitEmpty(Object.assign({}, conceptScheme, context.jsonld), null, 2)
          ),
        })
        createData({
          path: getFilePath(conceptScheme.id, "jsonld"),
          data: JSON.stringify(
            omitEmpty(Object.assign({}, conceptScheme, context.jsonld), null, 2)
          ),
        })
        // create index files
        languagesOfCS.forEach((language) =>
          exportIndex(indexes[language], conceptScheme, language)
        )
      }
    )
  )

  // Build index pages
  languages.forEach((language) =>
    createPage({
      path: `/index.${language}.html`,
      component: path.resolve(`./src/components/index.jsx`),
      context: {
        language,
        conceptSchemes: conceptSchemes.data.allConceptScheme.edges.map(
          (node) => node.node
        ),
        languagesByCS: Object.fromEntries(
          Object.entries(languagesByCS).map(([key, value]) => {
            return [key, Array.from(value)]
          })
        ),
      },
    })
  )
}

exports.onCreateWebpackConfig = ({ actions }) => {
  actions.setWebpackConfig({
    resolve: {
      fallback: {
        fs: false,
        crypto: require.resolve("crypto-browserify"),
        stream: require.resolve("stream-browserify"),
      },
    },
  })
}
