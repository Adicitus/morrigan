"use strict"
const morgan = require('morgan')
const fs = require('fs')
const { DateTime } = require('luxon')

process.title = "morrigan.server"

const serverSettings = require('./server.settings')

var port = 1337
if (serverSettings.http && serverSettings.http.port) {
    port = serverSettings.http.port
}

console.log('Setting up logging...')
const logger =  require('./modules/logger')
if (serverSettings.logger) {
    logger.setup(serverSettings.logger)
}
const log = logger.log

log('Finished setting up logging.')

log(`Reading server state (looking in '${serverSettings.stateDir}')...`)
const serverInfo = require('./server.info').build(serverSettings.stateDir)
log('Finished reading server state.')

const express = require('express')
const expressws = require('express-ws')
const bodyParser = require('body-parser')


/**
 * Use the components array to specify which components to use and which order to configure them in.
 * Components will be configured by calling their .setup method once the database is connected.
 * 
 * Loading the components here will prevent the server from starting in case there are any issues
 * with loading the modules (this is the indended behavior: fail fast).
 */
const auth = require('./modules/auth')
const components = [
    {module: auth, route: '/auth'},
    {module: require('./modules/core'), route: '/api'}
]

// App is defined here since it wil be needed when creating the server.
var app = express()

var server = null
if (serverSettings.http) {
    if (serverSettings.http.secure === true) {
        log('Creating as HTTPS server...')

        let options = {}

        // Defaults
        let certType = 'pem'

        if (serverSettings.http.certType) {
            certType = serverSettings.http.certType
        }

        switch(certType) {
            case 'pem': {
                let certPath = `${__dirname}/cert.pem`
                if (serverSettings.http.certPath) {
                    certPath = serverSettings.http.certPath
                }
                
                if (!fs.existsSync(certPath)) {
                    log(`Missing certificate (expected '${certPath}')`)
                    return
                }

                let keyPath = `${__dirname}/cert.pem`
                if (serverSettings.http.keyPath) {
                    keyPath = serverSettings.http.keyPath
                }

                if (!fs.existsSync(keyPath)) {
                    log(`Missing private key (expected '${keyPath}')`)
                    return
                }

                try {
                    options.cert = fs.readFileSync(certPath)
                    options.key = fs.readFileSync(keyPath)
                } catch(e) {
                    log('An exception occured while trying to load certificates:')
                    log(e)
                    return
                }
                break
            }

            default: {
                log(`Unexpected certificate type: ${certType}`)
                return
            }
        }

        server = require('https').createServer(options, app)
    }
}

if (!server) {
    log('Creating as HTTP server...')
    server = require('http').createServer(app)
}

// Apply WebSocket logic to the application/server:
expressws(app, server)

// Setup request logging:
app.use(
    morgan(
        '--> :remote-addr :method :url :status - :res[content-length]b :response-time ms',
        {
            stream: {
                write: (msg) => log(msg.trim())
            }
        }
    )
)

// All request bodies should be treated as 'application.json':
app.use(bodyParser.json())

// Add middleware to verify authentication and make authorization details
// available to downstreams handlers:
app.use(auth.mw_verify)


// Establish connection to MongoDB:
var database = null
const mongoClient = require('mongodb').MongoClient
mongoClient.connect(serverSettings.database.connectionString, { useUnifiedTopology: true }).then(async client => {
    log('MongoDB server connected.')
    log(`Using DB '${serverSettings.database.dbname}'.`)
    database = client.db(serverSettings.database.dbname)


    const environment = {
        db: database,
        info: serverInfo,
        log: log,
        settings: serverSettings
    }

    log('Setting up components...')
    let promises = []
    components.forEach(c => {
        promises.push(c.module.setup(c.route, app, environment))
    })
    await Promise.all(promises)
    log ('Setup Finished.')

    server.listen(port, () => {
        log(`Listening on port ${port}.`)
    })

    log('Setting up instance reporting...')

    const instances = database.collection('morrigan.instances')

    const selector = {id: serverInfo.id}
    let remoteRecord = await instances.findOne(selector)

    const serverRecord = {
        id: serverInfo.id,
        settings: serverSettings,
        state: serverInfo,
        live: true,
        checkInTime: DateTime.now().toISO()
    }

    if (remoteRecord == null) {
        log('Registering instance...')
        await instances.insertOne(serverRecord)
    } else {
        log('Updating instance record...')
        await instances.replaceOne(selector, serverRecord)
    }

    const updateInterval = setInterval(async () => {
        serverRecord.checkInTime = DateTime.now().toISO()
        instances.replaceOne(selector, serverRecord)
    }, 30000)

    const handleSignal = async (e) => {
        log(`Shutdown signal received: ${e}`)
        log('Updating instance record...')
        clearInterval(updateInterval)

        log('Calling onShutdown methods on componets...')
        let promises = []
        components.forEach(c => {
            if (c.module.onShutdown) {
                promises.push(c.module.onShutdown(e))
            }
        })
        await Promise.all(promises)

        serverRecord.checkInTime = DateTime.now().toISO()
        serverRecord.live = false
        serverRecord.stopReason = e
        await instances.replaceOne(selector, serverRecord)
        log('Bye!')
        process.exit()
    }

    process.on('SIGTERM', handleSignal)
    process.on('SIGINT',  handleSignal)
    process.on('SIGHUP',  handleSignal)

    log('Finished instance reporting setup.')

}).catch(err => {
    log('Error while connecting to DB:')
    log(err)
    if (err.stack) {
        log(err.stack)
    }
})