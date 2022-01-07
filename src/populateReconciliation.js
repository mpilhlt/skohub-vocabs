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

const tenant = 'rg-mpg-de'

async function collectData () {
	var data = []
	const files = glob.sync('data/*.ttl')
	for (const f of files) {
		console.log(`> Read and parse ${path.basename(f)} ...`)
		const vocab = path.basename(f, path.extname(f)).replace(/ /g,"_")
		const ttlString = fs.readFileSync(f).toString()
		const entries = await buildJSON(ttlString, tenant, vocab)
		data.push({ vocab: { tenant, vocab }, entries: entries })
	}
	return data
};

async function buildJSON (ttlString, tenant, vocab) {
	const doc = ttl2jsonld(ttlString)
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
		entries = entries + `{ "index" : { "_index" : "${esIndex}" } }` + '\n'
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

async function deleteData (v) {
	const requestBody = esb.requestBodySearch()
		.query(esb.boolQuery()
			.must(esb.termQuery('tenant', v.tenant))
			.must(esb.termQuery('vocab', v.vocab))
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
		await deleteData(v.vocab)
		.then(response => {
			if (response.statusCode !== 200) {
				console.log(`> Warning: Delete ${v.vocab.tenant}/${v.vocab.vocab} status != 200. Better check response:\n`, response)
			} else {
				console.log(`> ${v.vocab.tenant}/${v.vocab.vocab}: Successfully deleted ${response.body.deleted} documents from ES index.`)
			}
		})
		.catch(error => {
			console.error(`Failed populating ${esIndex} index of ES server with ${v.vocab.tenant}/${v.vocab.vocab}. Abort!`, error)
		})

		await sendData(v.entries)
		.then(response => {
			if (response.statusCode !== 200) {
				console.log(`> Warning: SendData ${v.vocab.tenant}/${v.vocab.vocab} status != 200. Better check response:\n`, response)
			} else {
				console.log(`> ${v.vocab.tenant}/${v.vocab.vocab}: Successfully sent ${response.body.items.length} documents to ES index.`)
			}
		})
		.catch(error => {
			console.error(`Failed populating ${esIndex} index of ES server with ${v.vocab.tenant}/${v.vocab.vocab}. Abort!`, error)
		})
	})
}

main();
