const fs = require('fs-extra')
const path = require('path')
const glob = require('glob')
const ttl2jsonld = require('@frogcat/ttl2jsonld').parse
const elasticsearch = require('@elastic/elasticsearch')
const esb = require('elastic-builder/src')
const jsonld = require('jsonld')
const context = require('./context_es')

require('dotenv').config()
const esIndex = process.env.ES_INDEX


async function collectData () {
	var data = []
	const files = glob.sync('data/*.ttl')
	for (const f of files) {
		console.log(`> Read and parse ${path.basename(f)} ...`)
		const ttlString = fs.readFileSync(f).toString()
		const j = await buildJSON(ttlString)
		// console.log(j.entries)
		// console.log("URL is this:", j.url)
		data.push({ url: j.url, entries: j.entries })
	}
	return data
};

async function buildJSON (ttlString) {
	const doc = ttl2jsonld(ttlString)
	const expanded = await jsonld.expand(doc)
	const compacted = await jsonld.compact(expanded, context.jsonld)

	var entries = ''
	var url = ''
	compacted['@graph'].forEach((graph, _) => {
		const { ...properties } = graph
		const type = Array.isArray(properties.type)
			? properties.type.find(t => ['Concept', 'ConceptScheme'])
			: properties.type
		const node = {
			...properties,
			type
		}
		node['@context'] = context.jsonld['@context']
		if (!(url.length > 0)) {
			if (node.type === 'ConceptScheme') {
				url = node.preferredNamespaceUri
			}
		}

		entries = `${entries}{ "index" : { "_index" : "${esIndex}" } }\n`
		entries = entries + JSON.stringify(node) + '\n'
	})
	return { entries: entries, url: url }
};

var esClient
if (process.env.ES_USER && process.env.ES_PASS) {
	esClient = new elasticsearch.Client({ node: `${process.env.ES_PROTO}://${process.env.ES_USER}:${process.env.ES_PASS}@${process.env.ES_HOST}:${process.env.ES_PORT}` })
} else {
	esClient = new elasticsearch.Client({ node: `${process.env.ES_PROTO}://${process.env.ES_HOST}:${process.env.ES_PORT}` })
}

async function deleteData (v) {
	const requestBody = esb.requestBodySearch()
		.query(esb.boolQuery()
			.should([ esb.termQuery('inScheme.id', v),
					  esb.termQuery('inScheme.id', 'http://' + v),
					  esb.termQuery('inScheme.id', 'https://' + v),
					  esb.termQuery('id', v),
					  esb.termQuery('id', 'http://' + v),
					  esb.termQuery('id', 'https://' + v)
			])
		)
	return esClient.deleteByQuery({
		index: esIndex,
		refresh: true,
		body: requestBody
	})
};

async function sendData (entries) {
	return esClient.bulk({
		index: esIndex,
		body: entries
	})
};

async function main() {
	const data = await collectData()
	data.forEach(async v => {
		await deleteData(v.url)
		.then(response => {
			if (response.statusCode !== 200) {
				console.log(`> Warning: Delete ${v.url} status != 200. Better check response:\n`, response)
			} else {
				console.log(`> ${v.url}: Successfully deleted ${response.body.deleted} documents from ES index.`)
			}
		})
		.catch(error => {
			console.error(`Failed populating ${esIndex} index of ES server when trying to delete ${v.url}. Abort!`, error)
		})

		await sendData(v.entries)
		.then(response => {
			if (response.statusCode !== 200) {
				console.log(`> Warning: SendData ${v.url} status != 200. Better check response:\n`, response)
			} else {
				console.log(`> ${v.url}: Successfully sent ${response.body.items.length} documents to ES index.`)
			}
		})
		.catch(error => {
			console.error(`Failed populating ${esIndex} index of ES server with ${v.url}. Abort!`, error)
		})
	})
}

main();
