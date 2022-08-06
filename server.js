"use strict"
const fs = require('fs')
const { DateTime } = require('luxon')
const express = require('express')
const expressws = require('express-ws')
const bodyParser = require('body-parser')
const Logger =  require('./modules/Logger')
const swaggerUi = require('swagger-ui-express')

const serverStates = {
    error: -1,
    instanced: 0,
    initialized: 1,
    starting: 2,
    starting_connected: 3,
    started: 4,
    ready: 5,
    stopping: 6,
    stopped: 7
}

/**
 * Main class of Morrigan administration system.
 */
class Morrigan {
    settings = null
    log = (msg, level) => { level = level || 'info'; console.log(`${level}: ${msg}`) }
    port = 3000
    app = null
    serverInfo = null
    server = null
    logger = null
    components = null

    _updateInterval = null
    _serverRecord = null
    _instances = null
    _state = serverStates.error

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

        this._state = serverStates.instanced
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

        this.log('Setting up logging...')
        this.logger = new Logger(app, serverSettings.logger)
        this.log = this.logger.getLog()
        const log = this.log
        log('Finished setting up logging.')
        
        log('Loading components...')
        let componentSpecs = serverSettings.components || {}
        this.components = []
        Object.keys(componentSpecs).forEach(componentName => {

            let componentSpec = componentSpecs[componentName]
            if (!componentSpec.module) {
                log(`No module specified for component '${componentName}', skipping it...`)
                return
            }
        
            let module = null
        
            switch(typeof componentSpec.module) {
                case 'function':
                case 'object':
                    module = componentSpec.module
                    break
                case 'string':
                    try {
                        module = require(componentSpec.module)
                    } catch (e) {
                        log(`Unabled to load the module '${componentSpec.module}' defined by component '${componentName}':`)
                        log(e)
                        return
                    }
                    break;
            }
        
            log(`Registered component module '${componentSpec.module}' as '${componentName}'`)
        
            this.components.push({name: componentName, module: module, route: `/api/${componentName}`, specification: componentSpec })
        })

        let stateDir = serverSettings.stateDir || '/morrigan.server/state'
        log(`Reading server state (looking in '${stateDir}')...`)
        this.serverInfo = require('./server.info').build(stateDir)
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

        this._state = serverStates.initialized
    }

    /**
     * Starts this server instance.
     * 
     * This will cause the server to attempt a connection to the configured MongoDB instance.
     * 
     * If the connection succeeds, all loaded components will be configured using their .setup method.
     * 
     * If the 'setup' method has not been called, this method will attempt to call it in order to initialize the server.
     */
    async start() {
        if (this._state < serverStates.initialized) {
            try {
                this.log(`'start' method called, but server is not in an initialized state. Attempting to initialize...`)
                this.setup()
            } catch(e) {
                this.log(`Failed to initialize: ${JSON.stringify(e)}`)
                return
            }
        }

        this._state = serverStates.starting

        const serverInfo = this.serverInfo
        const serverSettings = this.settings
        const app = this.app
        const log = this.log
        const components = this.components
        const server = this.server
        const port = this.port

        if (!serverSettings.database) {
            log("No 'database' section specified in the server settings, unable to connect to database. Quitting.", 'error')
            return
        }

        if (!serverSettings.database.connectionString) {
            log("No 'connectionString' specified in 'database' section of the server settings, unable to connect to database. Quitting.", 'error')
            return
        }

        let dbname = serverSettings.database.dbname
        if (!dbname) {
            log("No 'dbname' specified in 'database' section of the server settings, server records will be stored in the database named 'test'.", 'warn')
            dbname = 'test'
        }

        // Establish connection to MongoDB:
        var database = null
        const mongoClient = require('mongodb').MongoClient
        mongoClient.connect(serverSettings.database.connectionString, { useUnifiedTopology: true }).then(async client => {
            this._state = serverStates.starting_connected

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
                router._morriganRootPath = c.route
                promises.push(c.module.setup(c.name, c.specification, router, environment))
            })
            await Promise.all(promises)
            log ('Setup Finished.')

            app.get('/api-docs', (req, res) => {

                let routes = this._buildApiDoc()

                res.setHeader('Content-Type', 'application/json')
                res.end(JSON.stringify(routes))
            })

            app.use('/api-docs/view', swaggerUi.serve, swaggerUi.setup(null, {
                swaggerOptions: {
                    url: '/api-docs'
                }
            }))

            server.listen(port, () => {
                log(`Listening on port ${port}.`)
            })

            this._state = serverStates.started

            log('Setting up instance reporting...')

            const instances = database.collection('morrigan.instances')
            this._instances = instances

            const selector = {id: serverInfo.id}
            let remoteRecord = await instances.findOne(selector)

            const serverRecord = {
                id: serverInfo.id,
                components: [],
                state: serverInfo,
                live: true,
                checkInTime: DateTime.now().toISO()
            }

            this.components.forEach(c => {
                let c2 = {}

                Object.keys(c).forEach(k => {
                    if (k === 'module') {
                        // Skip the loaded module.
                        return
                    }

                    if (k === 'specification') {
                        // Extract module spec and discard the rest to avoid trouble when storing the record:
                        let m = c[k].module
                        switch (typeof m) {
                            case 'function':
                            case 'object':
                                c2.module = 'anonymous'
                                break
                            case 'string':
                                c2.module = m
                                break
                        }
                        return
                    }

                    c2[k] = c[k]
                })

                serverRecord.components.push(c2)
            })

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

            this._state = serverStates.ready

        }).catch(err => {
            this._state = serverStates.error

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
     * This method does nothing if the server is not in the 'ready' state.
     * 
     * @param {string} stopReason Reason for the server stopping.
     */
    async stop(stopReason) {
        if (this._state < serverStates.started || this._state >= serverStates.stopping) {
            return
        }
        
        this._state = serverStates.stopping

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

        l('Stopping HTTP server instance...')
        this.server.close(async () => {

            l('HTTP server finished shutting down.')

            l('Stopping server record update interval...')
            clearInterval(this._updateInterval)
            
            const selector = {id: this.serverInfo.id}
            l('Updating server record...')
            const record = this._serverRecord
            record.checkInTime = DateTime.now().toISO()
            record.live = false
            record.stopReason = stopReason
            await this._instances.replaceOne(selector, record).then(() => {
                l('Instance record updated.')
            }).catch((err) => {
                l('Failed to update the instance record.', 'error')
                l(err)
            }).finally(() => {
                this._state = serverStates.stopped
                l('Bye!')
            })
        })
    }

    _buildApiDoc() {
        
        let doc = {
            openapi: '3.0.0',
            info: {
                title: `Morrigan Server API`,
                description: `Morrigan management server<br>
                    Version: ${this.serverInfo.version}<br>
                    Server ID: ${this.serverInfo.id}`,
                version: this.serverInfo.version
            },
            paths: {}
        }
        
        /*** Keys to extract from module's .openapi key ***/
        let openapiKeys = [
            { name: 'components', type: 'object', merge: (sourceObject, destinationObject) => {
                /**
                 * The 'components' key of the OpenAPI specification contains a set of mappings, so
                 * we expect the value for all keys to be of type 'object'.
                 */
                let componentsKeys = [
                    'schemas',
                    'responses',
                    'parameters',
                    'examples',
                    'requestBodies',
                    'headers',
                    'securitySchemas',
                    'links',
                    'callbacks'
                ]

                componentsKeys.forEach(componentKey => {
                    let sourceMap = sourceObject[componentKey]
                    if (!sourceMap) {
                        this.log(`Did not find key '${componentKey}'.`)
                        return
                    }

                    if (typeof sourceMap !== 'object') {
                        this.log(`Found key '${componentKey}', but it is not the expected type (expected 'object', found '${typeof sourceMap}')`)
                        return
                    }

                    if (!destinationObject[componentKey]) {
                        destinationObject[componentKey] = {}
                    }

                    Object.keys(sourceMap).forEach(k => {
                        destinationObject[componentKey][k] = sourceMap[k]
                    })
                })
            } },
            { name: 'security', type: 'array', merge: (sourceArray, destinationArray) => {
                sourceArray.forEach(v => destinationArray.push(v))
            } },
            { name: 'tags', type: 'array', merge: (sourceArray, destinationArray) => {
                sourceArray.forEach(v => destinationArray.push(v))
            } }
        ]

        /*** Include spec exported by modules ***/
        this.components.forEach(component => {

            let openapi = component.module.openapi

            if (openapi) {
                this.log(`Reading .openapi key on component ${component.name}`)
            } else {
                this.log(`No .openapi key exported by the '${component.name}'`)
                return
            }

            if (!Array.isArray(openapi)) {
                openapi = [openapi]
            }

            openapi.forEach(spec => {

                openapiKeys.forEach(key => {
                    let source = spec[key.name]
                    if (!source) {
                        this.log(`Did not find key '${key.name}' on .openapi declaration from '${component.name}'.`)
                        return
                    }

                    switch(key.type) {
                        case 'array':
                            if (!Array.isArray(source)) {
                                this.log(`Found key '${key.name}' on .openapi declaration from '${component.name}', but it does not match the expected type (expected '${key.type}' found '${typeof source}')`)
                                return
                            }
                            break
                        default:
                            if (typeof source !== key.type) {
                                this.log(`Found key '${key.name}' on .openapi declaration from '${component.name}', but it does not match the expected type (expected '${key.type}' found '${typeof source}')`)
                                return
                            }
                            break
                    }

                    let destination = doc[key.name]

                    if (destination === undefined) {
                        switch(key.type) {
                            case 'array':
                                destination = []
                                break
                            case 'object':
                                destination = {}
                                break
                        }

                        doc[key.name] = destination
                    }

                    key.merge(source, destination)
                })
            })
        })

        /*** Include spec from registered paths ***/

        // Check all middleware on app:
        this.app._router.stack.forEach(mw => {
            if (mw.name !== 'router') {
                // Ignore this mw if it's not a router
                return 
            }

            // Check each handler in the router's stack:
            mw.handle.stack.forEach(handler => {
                if (!handler.route) {
                    // We only handle routers with routes
                    return
                }

                let route = handler.route

                // Check each layer on the routes' stack.
                route.stack.forEach(layer => {
                    let fullPath = mw.handle._morriganRootPath + route.path

                    this.log(`Looking for .openapi declarations @ '${fullPath}...`, 'debug')

                    let spec = doc.paths[fullPath] || {}

                    let defaultSpec = {
                        responses: {
                            default: {
                                description: "Unknown: no .openapi object specified on the handler function."
                            }
                        }
                    }

                    let m = layer.method

                    if (!m) {
                        this.log(`No method decalred on layer, skipping.`)
                        return
                    }

                    let openapi = layer.handle['openapi'] || {}
                    
                    if (!openapi) {
                        this.log(`No .openapi declaration found for ${m.toUpperCase()} ${fullPath}. Adding default spec...`, 'debug')
                        // Default value for unspecified openapi spec:
                        spec[m] = defaultSpec
                    } else {
                        
                        if (openapi[m]) {
                            this.log(`Found .openapi declaration for '${m}' method.`, 'debug')
                            this.log(openapi[m], 'silly')
                            // Use the openapi spec declared on the handler: 
                            spec[m] = openapi[m]
                        } else {
                            this.log(`No .openapi declaration found for ${m.toUpperCase()} ${fullPath}.`, 'silly')
                            // Default value for unspecified openapi spec:
                            spec[m] = defaultSpec
                        }
                    }
                    doc.paths[fullPath] = spec
                })
            })
        })

        return doc
    }
}

module.exports = Morrigan