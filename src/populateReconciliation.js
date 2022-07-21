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
	const files = glob.sync('data/**/*.ttl')
	for (const f of files) {
		const tenant = path.dirname(f).split(path.sep)[1]
		console.log(`> Read and parse ${tenant}/${path.basename(f)} ...`)
		if (!/[a-zA-Z0-9]/.test(tenant.slice(0,1))) {
			console.log(`> Invalid data: tenant must start with a letter or a number. Instead, its value is: ${tenant}`)
			continue
		}
		const ttlString = fs.readFileSync(f).toString()
		const j = await buildJSON(ttlString, tenant)
		if (!/[a-zA-Z0-9]/.test(j.vocab.slice(0,1))) {
			console.log(`> Invalid data: vocab must start with a letter or a number. Instead, its value is: ${j.vocab}`)
			continue
		}
		data.push({ tenant: j.tenant, vocab: j.vocab, entries: j.entries })
	}
	return data
};

async function buildJSON (ttlString, tenant) {
	const doc = ttl2jsonld(ttlString)
	const expanded = await jsonld.expand(doc)
	const compacted = await jsonld.compact(expanded, context.jsonld)

	var entries = ''
	var vocab = ''

	compacted['@graph'].forEach((graph, _) => {
		const { ...properties } = graph
		const type = Array.isArray(properties.type)
			? properties.type.find(t => ['Concept', 'ConceptScheme'])
			: properties.type
		const node = {
			...properties,
			type
		}
		if (node.type === 'ConceptScheme') {
			vocab = node.id.substring(0, node.id.lastIndexOf('/'))
		} else if (node.type === 'Concept') {
			vocab = node.inScheme[0].id.substring(0, node.inScheme[0].id.lastIndexOf('/'))
		}
		node['vocab'] = vocab
		node['tenant'] = tenant
		node['@context'] = context.jsonld['@context']

		entries = `${entries}{ "index" : { "_index" : "${esIndex}" } }\n`
		entries = entries + JSON.stringify(node) + '\n'
	})
	return { tenant: tenant, vocab: vocab, entries: entries }
};

var esClient
if (process.env.ES_USER && process.env.ES_PASS) {
	esClient = new elasticsearch.Client({ node: `${process.env.ES_PROTO}://${process.env.ES_USER}:${process.env.ES_PASS}@${process.env.ES_HOST}:${process.env.ES_PORT}` })
} else {
	esClient = new elasticsearch.Client({ node: `${process.env.ES_PROTO}://${process.env.ES_HOST}:${process.env.ES_PORT}` })
}

async function deleteData (tenant, vocab) {
	const requestBody = esb.requestBodySearch()
		.query(esb.boolQuery()
			.must([ ...(vocab && [esb.termQuery('vocab', vocab)]),
					...(tenant && [esb.termQuery('tenant', tenant)])
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
		await deleteData(v.tenant, v.vocab)
		.then(response => {
			if (response.statusCode !== 200) {
				console.log(`> Warning: Delete ${v.tenant}/${v.vocab} status != 200. Better check response:\n`, response)
			} else {
				console.log(`> ${v.tenant}/${v.vocab}: Successfully deleted ${response.body.deleted} documents from ES index.`)
			}
		})
		.catch(error => {
			console.error(`Failed populating ${esIndex} index of ES server when trying to delete ${v.tenant}/${v.vocab}. Abort!`, error)
		})

		await sendData(v.entries)
		.then(response => {
			if (response.statusCode !== 200) {
				console.log(`> Warning: SendData ${v.tenant}/${v.vocab} status != 200. Better check response:\n`, response)
			} else {
				console.log(`> ${v.tenant}/${v.vocab}: Successfully sent ${response.body.items.length} documents to ES index.`)
			}
		})
		.catch(error => {
			console.error(`Failed populating ${esIndex} index of ES server with ${v.tenant}/${v.vocab}. Abort!`, error)
		})
	})
}

main();
