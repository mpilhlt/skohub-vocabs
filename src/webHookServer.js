
const Koa = require('koa')
const Router = require('koa-router')
const bodyParser = require('koa-bodyparser')
const { v4: uuidv4 } = require("uuid")
const fs = require('fs-extra')
const glob = require('glob')
const util = require('util')
const exec = require('child_process').exec
const spawn = require('child_process').spawn
const fetch = require("node-fetch")

const {
  getHookGitHub,
  getHookGitLab,
  getHookSkoHub,
  isValid,
  getRepositoryFiles,
} = require('./common')
const { resolve } = require('path')
const { reject } = require('lodash')

require('dotenv').config()
require('colors')

const { PORT, SECRET, BUILD_URL } = process.env
const app = new Koa()
const router = new Router()

const webhooks = []
let processingWebhooks = false

const getFile = async (file, repository) => {

  if (!file || !repository) {
    throw new Error('Missing parameters for getFile')
  }

  try {
    const response = await fetch(file.url)
    const data = await response.text()
    const path = `data/${repository}/`
    await fs.outputFile(`${path}${file.path}`, data)
    console.info("Created file:".green, file.path)
  } catch (error) {
    console.error(error)
  }
}

router.post('/build', async (ctx) => {
  const { body, headers } = ctx.request
  const doReconcile = (!(ctx.request.query === undefined) && !(ctx.request.query.doreconc === undefined))

  let hook
  if (headers['x-github-event']) {
    hook = getHookGitHub(headers, body, SECRET)
  } else if (headers['x-gitlab-event']) {
    hook = getHookGitLab(headers, body, SECRET)
  } else if (headers['x-skohub-event']) {
    hook = getHookSkoHub(headers, body, SECRET)
  } else {
    console.warn('Bad request, the event header is missing')
    ctx.status = 400
    ctx.body = 'Bad request, the event header is missing'
    return
  }

  // Check if the given signature is valid
  if (!hook.isSecured) {
    console.warn('Bad request, the token is incorrect')
    ctx.status = 400
    ctx.body = 'Bad request, the token is incorrect'
    return
  }

  // If the given event is valid, push webhook event to processing queue
  if (isValid(hook)) {
    const id = uuidv4()
    const { type, repository, headers, ref, filesURL } = hook
    webhooks.push({
      id,
      body,
      repository,
      headers,
      date: new Date().toISOString(),
      status: "processing",
      log: [],
      type,
      filesURL,
      ref,
      doReconcile
    })
    const tasks = doReconcile ? 'Build and reconc. population' : 'Build'
    ctx.status = 202
    ctx.body = `${tasks} triggered: ${BUILD_URL}?id=${id}`
    console.log(`${tasks} triggered`)
  } else {
    ctx.status = 400
    ctx.body = 'Payload was invalid, build not triggered'
    console.log('Payload was invalid, build not triggered')
  }
})

const processWebhooks = async () => {
  if (processingWebhooks === false) {
    if (webhooks.length > 0) {
      processingWebhooks = true
      const webhook = webhooks.shift()
      const doReconcile = webhook.doReconcile
      console.log(`Processing webhook from ${webhook.repository}...`.green)
      console.info("doReconcile: " + doReconcile)

      // Fetch files
      try {
        // Fetch urls for the repository files
        const files = await getRepositoryFiles(webhook)

        // see https://github.com/eslint/eslint/issues/12117
        // Fetch each one of the repository files
        // eslint-disable-next-line no-unused-vars
        for (const file of files) {
          await getFile({url: file.url, path: file.path}, webhook.repository)
        }
      } catch (error) {
        // If there is an error fetching the files,
        // stop the current webhook and return
        console.error(error)
        webhook.log.push({
          date: new Date(),
          text: error.message,
          warning: true
        })
        webhook.status = "error"
        fs.writeFile(`${__dirname}/../dist/build/${webhook.id}.json`, JSON.stringify(webhook))
        processingWebhooks = false
        return
      }

      // Define repositoryURL
      let repositoryURL = ''
      if (webhook.type === 'github') {
        repositoryURL = `GATSBY_RESPOSITORY_URL=https://github.com/${webhook.repository}`
      } else if (webhook.type === 'gitlab') {
        repositoryURL = `GATSBY_RESPOSITORY_URL=https://gitlab.com/${webhook.repository}`
      }

      const files = glob.sync('data/**/*.ttl')
      if (files) {
        const ref = webhook.ref.replace('refs/', '')
        const buildCmd = {
          env: {
            BASEURL: `/${webhook.repository}/${ref}/${repositoryURL}`,
             CI: 'true'
          },
          cmd: 'npm',
          paras: ['run', 'build']
        }
        const reconcCmd = {
          env: {
            BASEURL: `/${webhook.repository}/${ref}/${repositoryURL}`,
             CI: 'true'
          },
          cmd: 'node',
          paras: ['src/populateReconciliation.js']
        }

        // Call the processing function(s)
        // When all the processing functions are resolved...
        await Promise.all([
          runBuild(webhook, buildCmd, 'gatsby'),
          // A promise that either is resolved by the async reconcile function or - if !doReconcile - immediately
          ( doReconcile ? runBuild(webhook, reconcCmd, 'reconcile') : Promise.resolve() )
        ])
        .catch(error => {
          console.error(`Error during build or populate-reconc step. Abort!`, error)
        })
        cleanUp(webhook) // ... then clean up downloaded and temporary files.
      } else {
        console.warn("No files to process found in filesystem. Finishing...")
        cleanUp(webhook)
      }
    }
  }
}

async function runBuild(webhook, command, processName) {
  console.log(`Running ${processName} build ...`)

  return new Promise(async (resolve, reject) => {
    const process = spawn(command.cmd, command.paras, { env: command.env });
    process.on('data', (data) => {
      console.log(`${processName}Log: ` + data.toString())
      webhook.log.push({
        date: new Date(),
        text: data.toString()
      })
      fs.writeFile(`${__dirname}/../dist/build/${webhook.id}.json`, JSON.stringify(webhook))
      resolve(data)
    });
    process.on('error', (err) => {
      console.log(`${processName}Error: ` + err.toString())
      if (
        !err.toString().includes('Deprecation') &&
        !err.toString().includes('warning') &&
        !err.toString().includes('lscpu')
      ) {
        webhook.log.push({
          date: new Date(),
          text: err.toString(),
          warning: true
        })
        webhook.status = "error"
        fs.writeFile(`${__dirname}/../dist/build/${webhook.id}.json`, JSON.stringify(webhook))
      }
      reject(err)
    });
    process.on('close', async (code) => {
      if ((code !== 0)) {
        console.log(`${processName}Error: Build finished with error code ` + code.toString())
        webhook.status = `${processName} build failed`
        webhook.log.push({
          date: new Date(),
          text: `${processName} build failed`
        })
        fs.writeFile(`${__dirname}/../dist/build/${webhook.id}.json`, JSON.stringify(webhook))
        console.info(`${processName} build failed`.red)
        reject(code)
      } else {
        if (webhook.status !== "error") {
          webhook.status = `${processName} build complete`
          webhook.log.push({
            date: new Date(),
            text: `${processName} build finished`
          })
          fs.writeFile(`${__dirname}/../dist/build/${webhook.id}.json`, JSON.stringify(webhook))
          console.info(`${processName} build finished`.green)
          resolve(code)
        } else {
          webhook.status = `${processName} build failed`
          webhook.log.push({
            date: new Date(),
            text: `${processName} build failed`
          })
          fs.writeFile(`${__dirname}/../dist/build/${webhook.id}.json`, JSON.stringify(webhook))
          console.info(`${processName} build failed`.red)
          reject()
        }
      }
    });
  });
}

function cleanUp(webhook) {
  console.log('Cleaning up...')
  const ref = webhook.ref.replace('refs/', '')

  fs.readdirSync(`${__dirname}/../data/`)
    .filter(filename => filename !== '.gitignore')
    .forEach(filename => fs.removeSync(`${__dirname}/../data/${filename}`))
  fs.removeSync(`${__dirname}/../dist/${webhook.repository}/${ref}/`)
  if (fs.existsSync(`${__dirname}/../public/`)) {
    fs.moveSync(`${__dirname}/../public/`, `${__dirname}/../dist/${webhook.repository}/${ref}/`)
  }

  processingWebhooks = false
}

app
  .use(bodyParser())
  .use(router.routes())
  .use(router.allowedMethods())

const server = app.listen(PORT, () => console.info(`⚡ Listening on localhost:${PORT}`.green))

// Loop to processing requests
setInterval(() => {
  processWebhooks()
}, 1)

module.exports = { server, getFile }
