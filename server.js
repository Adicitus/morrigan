"use strict"
const fs = require('fs')
const { DateTime } = require('luxon')
const express = require('express')
const expressws = require('express-ws')
const bodyParser = require('body-parser')
const Logger =  require('./modules/Logger')

/**
 * Main class of Morrigan administration system.
 */
class Morrigan {
    settings = null
    log = null
    port = 1337
    app = null
    serverInfo = null
    server = null
    logger = null
    components = null

    #_updateInterval = null
    #_serverRecord = null
    #_instances = null

    /**
     * Main constructor.
     * 
     * Takes Morrigan server configuration settings as an object (see server.settings.sample.js for a full list of settings).
     * @param {Object} settings Morrigan server configuration settings.
     */
    constructor(settings) {
        this.settings = settings

        if (settings.http && settings.http.port) {
            this.port = settings.http.port
        }
    }

    /**
     * Performs pre-start configuration steps.
     * 
     * - Loads and sets up logging module.
     * - Loads and installs the components.
     * - Loads server info.
     * - Configures a HTTP(S) server with Express WebSocket.
     * @returns 
     */
    setup() {

        const serverSettings = this.settings
        const app = this.app = express()

        console.log('Setting up logging...')
        this.logger = new Logger()
        this.logger.setup(app, serverSettings.logger)
        this.log = this.logger.getLog()
        const log = this.log
        log('Finished setting up logging.')
        
        log('Loading components...')
        this.components = []
        Object.keys(serverSettings.components).forEach(componentName => {

            let componentSpec = serverSettings.components[componentName]
            if (!componentSpec.module) {
                log(`No module specified for component '${componentName}', skipping it...`)
                return
            }
        
            let module = null
        
            try {
                module = require(componentSpec.module)
            } catch (e) {
                log(`Unabled to load the module '${componentSpec.module}' defined by component '${componentName}':`)
                log(e)
                return
            }
        
            log(`Registered component module '${componentSpec.module}' as '${componentName}'`)
        
            this.components.push({name: componentName, module: module, route: `/${componentName}`, specification: componentSpec })
        })

        log(`Reading server state (looking in '${serverSettings.stateDir}')...`)
        this.serverInfo = require('./server.info').build(serverSettings.stateDir)
        log('Finished reading server state.')
        log(`Running Morrigan server version ${this.serverInfo.version}.`)

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

        this.server = server

        // Apply WebSocket logic to the application/server:
        expressws(app, server)

        // All request bodies should be treated as 'application/json':
        app.use(bodyParser.json())

        // Add middleware from components:
        this.components.forEach(component => {
            let m = component.module
            if (m.getMiddleware) {
                log(`Adding middleware from '${component.name}'...`)
                app.use(m.getMiddleware())
            }
        })
    }

    /**
     * Starts this server instance.
     * 
     * This will cause the server to attempt a connection to the configured MongoDB instance.
     * 
     * If the connection succeeds, all loaded components will be configured using their .setup method.
     */
    async start() {

        const serverInfo = this.serverInfo
        const serverSettings = this.settings
        const app = this.app
        const log = this.log
        const components = this.components
        const server = this.server
        const port = this.port

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
                let router = express.Router()
                app.use(c.route, router)
                promises.push(c.module.setup(c.name, c.specification, router, environment))
            })
            await Promise.all(promises)
            log ('Setup Finished.')

            server.listen(port, () => {
                log(`Listening on port ${port}.`)
            })

            log('Setting up instance reporting...')

            const instances = database.collection('morrigan.instances')
            this._instances = instances

            const selector = {id: serverInfo.id}
            let remoteRecord = await instances.findOne(selector)

            const serverRecord = {
                id: serverInfo.id,
                settings: serverSettings,
                state: serverInfo,
                live: true,
                checkInTime: DateTime.now().toISO()
            }

            this._serverRecord = serverRecord

            if (remoteRecord == null) {
                log('Registering instance...')
                await instances.insertOne(serverRecord)
            } else {
                log('Updating instance record...')
                await instances.replaceOne(selector, serverRecord)
            }

            this._updateInterval = setInterval(async () => {
                serverRecord.checkInTime = DateTime.now().toISO()
                instances.replaceOne(selector, serverRecord)
            }, 30000)

            log('Finished instance reporting setup.')

        }).catch(err => {
            log('Error while connecting to DB:')
            log(err)
            if (err.stack) {
                log(err.stack)
            }
        })
    }

    /**
     * Stops the server and all loaded components.
     * 
     * The stopReaason argument can be as short as a signal name (SIGTERM, SIGHUP), a more detailed message or even an object.
     * It will be included in the final entity record for this server.
     * 
     * @param {string} stopReason Reason for the server stopping.
     */
    async stop(stopReason) {
        const l = this.log

        l('Calling onShutdown methods on components...')
        let promises = []
        this.components.forEach(c => {
            if (c.module.onShutdown) {
                promises.push(c.module.onShutdown(stopReason))
            }
        })
        l('Waiting for components to finish shutting down...')
        await Promise.all(promises)
        l('Components finished shutting down.')

        l('Stopping server record update interval...')
        clearInterval(this._updateInterval)
        
        const selector = {id: this.serverInfo.id}
        l('Updating server record...')
        const record = this._serverRecord
        record.checkInTime = DateTime.now().toISO()
        record.live = false
        record.stopReason = stopReason
        await this._instances.replaceOne(selector, record)
        l('Bye!')
        process.exit()
    }
}

module.exports = Morrigan