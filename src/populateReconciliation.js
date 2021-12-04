const fs = require('fs-extra')
const path = require('path')
const ttl2jsonld = require('@frogcat/ttl2jsonld').parse;
const elasticsearch = require('@elastic/elasticsearch')
const jsonld = require('jsonld')
const context = require('./context_es')

// TODO: Don't add redundant concepts.
//       Maybe launch a delete query to ES for the currently processed tenant/vocab first?

require('dotenv').config()
const index = process.env.ES_INDEX

const filepath = path.resolve(__dirname, '../data/polmat.ttl')
const tenant = 'rg-mpg-de'
const vocab = path.basename(filepath, path.extname(filepath))

async function buildData (ttl) {
	const doc = ttl2jsonld(ttl)
	const expanded = await jsonld.expand(doc)
	const compacted = await jsonld.compact(expanded, context.jsonld)

	var entries = ''
	compacted['@graph'].forEach((graph, i) => {
		const { ...properties } = graph
		const type = Array.isArray(properties.type)
			? properties.type.find(t => ['Concept', 'ConceptScheme'])
			: properties.type
		const node = {
			...properties,
			type,
			tenant: tenant,
			vocab: vocab
		}
		node['@context'] = context.jsonld['@context']
		entries = entries + `{ "index" : { "_index" : "${index}" } }` + '\n'
		entries = entries + JSON.stringify(node) + '\n'

	})
	return entries
};

var esClient
if (process.env.ES_USER && process.env.ES_PASS) {
	esClient = new elasticsearch.Client({ node: `${process.env.ES_PROTO}://${process.env.ES_USER}:${process.env.ES_PASS}@${process.env.ES_HOST}:${process.env.ES_PORT}` })
} else {
	esClient = new elasticsearch.Client({ node: `${process.env.ES_PROTO}://${process.env.ES_HOST}:${process.env.ES_PORT}` })
}

async function sendData (data) {
	esClient.bulk({
		index: index,
		body: data
	})
	.then(response => {
		if (response.statusCode !== 200) {
			console.log('Status != 200. Better check response:\n', response)
		} else {
			console.log('> Done.', response.body.items.length, 'concepts successfully sent to ES server.')
		}

	})
	.catch(error => {
		console.error('Failed to send data to ES server', error)
	})
};

async function main() {
	const ttlString = fs.readFileSync(filepath).toString()
	await buildData(ttlString)
	.then(data => { sendData(data) })
}

main();
