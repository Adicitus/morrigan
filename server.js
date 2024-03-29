"use strict"
const fs = require('fs')
const { DateTime } = require('luxon')
const express = require('express')
const expressws = require('express-ws')
const bodyParser = require('body-parser')
const swaggerUi = require('swagger-ui-express')

const StateStore = require('@adicitus/morrigan.utils.statestore')
const DataStore  = require('@adicitus/morrigan.utils.datastore')

const Logger =  require(`${__dirname}/logger`)

const serverStates = {
    error: -1,
    instanced: 0,
    initializing: 1,
    initialized: 2,
    starting: 3,
    starting_connected: 4,
    started: 5,
    ready: 6,
    stopping: 7,
    stopped: 8
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

    _eventHandlers = {
        error: [],
        initializing: [],
        initialized: [],
        starting: [],
        starting_connected: [],
        started: [],
        ready: [],
        stopping: [],
        stopped: []
    }

    /**
     * Returns a list of all event names.
     * 
     * @returns A list of all available event names.
     */
    eventNames() {
        return Object.keys(this._eventHandlers)
    }

    /**
     * Registers a handler function to be called when the named event is emitted.
     * 
     * @param {string} eventName Name of the event to register a handler for.
     * @param {function} handler Handler to call when the event triggers.
     */
    on(eventName, handler) {
        if (!Object.keys(this._eventHandlers).includes(eventName)) {
            throw `Invalid event name for Morrigan server: ${eventName}` 
        }

        if (typeof handler !== 'function') {
            throw `Invalid event handler provided (expected a function, found '${typeof handler}')` 
        }

        this._eventHandlers[eventName].push(handler)
    }

    /**
     * Unregisters a handle for the given event.
     * 
     * @param {string} eventName Name of the event to unregister the handler for.
     * @param {function} handler Handler previously registered for this event. 
     */
    off(eventName, handler) {
        if (!Object.keys(this._eventHandlers).includes(eventName)) {
            throw `Invalid event name for Morrigan server: ${eventName}` 
        }

        this._eventHandlers[eventName] = this._eventHandlers[eventName].filter( h => h !== handler)
    }

    _emitEvent(eventName, eventArgs) {

        if (!Object.keys(this._eventHandlers).includes(eventName)) {
            throw `Invalid event name for Morrigan server: ${eventName}` 
        }
        
        this._eventHandlers[eventName].forEach(handler => {
            typeof handler === 'function' && handler(eventName, eventArgs)
        })
    }

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
     * Retrieves the current state of the server.
     * @returns Current state
     */
    getState() {
        return this._state
    }

    /**
     * Performs pre-start configuration steps.
     * 
     * - Loads and sets up logging module.
     * - Loads and installs the components.
     * - Loads server info.
     * - Configures a HTTP(S) server with Express WebSocket.
     */
    async setup(callback) {

        if (this._state >= serverStates.initialized) {
            throw "Call to .setup rejected: Server is already initialized."
        }

        if (this._state === serverStates.initializing) {
            throw "Call to .setup rejected: Server is already initializing."
        }

        this._state = serverStates.initializing
        this._emitEvent('initializing')

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
        this._rootStore = await StateStore(stateDir)
        this.serverInfo = await (require('./server.info').build(this._rootStore))
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
                try {
                    app.use(m.getMiddleware())
                } catch (e) {
                    log(`An unexpected exception occurred while adding middleware from '${component.name}': ${e}`)
                }
            }
        })
        this._state = serverStates.initialized
        this._emitEvent('initialized')

        typeof callback === 'function' && callback()
    }

    /**
     * Starts this server instance.
     * 
     * This will cause the server to attempt a connection with the configured MongoDB connection string.
     * 
     * If the connection succeeds, all loaded components will be configured using their .setup method.
     * 
     * If the 'setup' method has not been called, this method will attempt to call it in order to initialize the server.
     */
    async start(callback) {

        const self = this

        if (this._state < serverStates.initialized) {
            if (this._state == serverStates.initializing) {
                // Wait for server initialization to finish:
                await new Promise(resolve => {
                    self.on('initialized', () => {
                        resolve()
                    })
                })
            } else {
                try {
                    this.log(`'start' method called, but server is not in an initialized state. Attempting to initialize...`)
                    await this.setup()
                } catch(e) {
                    this._state = serverStates.error
                    this.log(`Failed to initialize: ${JSON.stringify(e)}`)
                    this.error = e
                    return
                }
            }
        }

        const serverInfo = this.serverInfo
        const serverSettings = this.settings
        const app = this.app
        const log = this.log
        const server = this.server
        const port = this.port

        this._state = serverStates.starting
        this._emitEvent('starting')
        log('Starting server...')

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
        
        const environment = {
            log,
            info: serverInfo
        }

        log("Establish connection to MongoDB...")

        var datastore = null
        try {
            datastore = await DataStore(serverSettings.database.connectionString, { dbName: serverSettings.database.dbname })
            this._state = serverStates.starting_connected
            this._emitEvent('starting_connected')

            log('MongoDB server connected.')
            log(`Using DB '${serverSettings.database.dbname}'.`)

            this._rootDataStore = datastore
            environment.db = datastore
        } catch (err) {
            this._state = serverStates.error
            this._emitEvent('error', err)

            log('Error while connecting to DB:', 'error')
            log(err)
            if (err.stack) {
                log(err.stack)
            }

            this.error = err
            typeof callback === 'function' && callback(err)
        }

        
        if (environment.db === undefined) {
            log(`Connection to DB failed: ${this.error}`, 'error')
            return
        }

        log("Settings up HTTP(S) listener...")
        let listenPromise = new Promise(resolveHttp => {
            server.listen(port, async () => {
                log(`Listening on port ${port}.`)

                this._state = serverStates.started
                this._emitEvent('started')
                
                let protocol = this.settings.http && this.settings.http.secure ? 'https' : 'http'
                let hostname = this.settings.http && this.settings.http.hostname ? this.settings.http.hostname : (server.address().address)
                environment.baseUrl = `${protocol}://${hostname}:${port}`
    
                log(`API base URL: ${environment.baseUrl}`, 'info')

                resolveHttp()
            })
        })

        listenPromise.catch(err => {
            this._state = serverStates.error
            this.error = err
            environment.log(`An error occurred while starting HTTP listener: ${err.message}`, 'error')
            environment.log(err, 'error')
            typeof callback === 'function' && callback(err)
        })

        await listenPromise

        if (environment.baseUrl === undefined) {
            log(`Failed to start HTTP listener: ${this.error}`)
            return
        }

        // Setup all of the loaded components:
        await this._executeComponentHooks('setup', async (c) => {
            
            let router = express.Router()
            app.use(c.route, router)
            router._morrigan = { route: c.route }

            c.specification.endpointUrl = environment.baseUrl + c.route
            log(`Building environment for component '${c.name}' (${c.specification.endpointUrl})`, 'info')
            let env = Object.assign({}, environment)
            env.state = await this._rootStore.getStore(c.name, 'delegate')
            env.db = await env.db.getDataStore(c.name, 'delegate')

            return [c.name, c.specification, router, env]
        })

        log("Setting up OpenAPI endpoint (@ '/api-docs')...")
        app.get('/api-docs', (req, res) => {

            let routes = this._buildApiDoc()

            res.setHeader('Content-Type', 'application/json')
            res.end(JSON.stringify(routes))
        })
        log("OpenAPI setup finished.")

        log("Setting up SwaggerUI (@ '/api-docs/view')")
        app.use('/api-docs/view', swaggerUi.serve, swaggerUi.setup(null, {
            swaggerOptions: {
                url: '/api-docs'
            }
        }))
        log("SwaggerUI setup finished.")
        

        log('Setting up instance reporting...')

        const instances = await this._rootDataStore.collection('morrigan.instances')
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

        log("Server is READY.")
        self._state = serverStates.ready
        this._emitEvent('ready')

        typeof callback === 'function' && callback()
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
     * @param {function} callback Function to call once method completes.
     */
    async stop(stopReason, callback) {
        if (this._state !== serverStates.ready) {
            typeof callback === 'function' && callback()
            return
        }
        
        this._state = serverStates.stopping
        this._emitEvent('stopping')

        await this._executeComponentHooks('onShutdown', (c) => {
            return [ stopReason ]
        })

        this.log('Stopping HTTP server instance...')
        await new Promise(resolve => {
            this.server.close(resolve)
        })
        this.log('HTTP server finished shutting down.')

        this.log('Stopping server record update interval...')
        clearInterval(this._updateInterval)
        
        this.log('Updating server record...')
        const selector = {id: this.serverInfo.id}
        const record = this._serverRecord
        record.checkInTime = DateTime.now().toISO()
        record.live = false
        record.stopReason = stopReason
        await this._instances.replaceOne(selector, record).then(() => {
            this.log('Instance record updated.')
        }).catch((err) => {
            this.log('Failed to update the instance record.', 'error')
            this.log(err)
        })

        this.log("Closing connection to DB...")
        await this._rootDataStore.discard()

        this._state = serverStates.stopped
        this._emitEvent('stopped')
        typeof callback === 'function' && callback()
        this.log('Bye!')
    }

    /**
     * Helper function to call a specified method ('hook') on all the loaded components.
     * 
     * To allow dynamic generation of arguments, this function takes a function as it's second argument.
     * 
     * @param {string} hookName Name of the hook method to call.
     * @param {function} hookArgsCallback Function used to generate an array of arguments that should be passed to the method.
     */
    async _executeComponentHooks(hookName, hookArgsCallback) {

        this.log(`Calling .${hookName} methods on components...`)
        var promises = []
        for(const i in this.components) {
            const component = this.components[i]
            if (typeof component.module[hookName] === 'function') {
                try {
                    let hookArgs = []
                    let promise = null

                    if (typeof hookArgsCallback === 'function') {
                        let p = null
                        switch (hookArgsCallback.constructor.name) {
                            case 'AsyncFunction':
                                p = hookArgsCallback(component)
                                break
                            case 'Function':
                                p = new Promise(resolve => {
                                    resolve(hookArgsCallback(component))
                                })
                                break
                        }
                        try {
                            hookArgs = await p
                        } catch (err) {
                            this.log(`An error occurred while preparing arguments for hook '${hookName}' on component '${component.name}': ${err}`)
                            hookArgs = []
                        }
                    }

                    switch(component.module[hookName].constructor.name) {
                        case 'AsyncFunction':
                            promise = component.module[hookName](...hookArgs)
                            break
                        case 'Function':
                            promise = new Promise(resolve => {
                                component.module[hookName](...hookArgs)
                                resolve()
                            })
                            break
                    }
                    let self = this
                    promise.catch(err => {
                        self._handleComponentError(hookName, component, err)

                    })
                    promises.push(promise)
                } catch (err) {
                    this._handleComponentError(hookName, component, err)
                    this.log(`An unhandled exception was thrown when calling .${hookName} on component '${component.name}'`, 'error')
                    this.log(err, 'error')
                }
            }
        }
        this.log('Waiting for component hooks to finish...')
        await Promise.allSettled(promises)
        this.log('Component hooks finished.')
    }

    _handleComponentError(key, componentRecord, error) {
        if (!this._errors) {
            this._errors = {}
        }

        if (!this._errors[componentRecord.name]) {
            this._errors[componentRecord.name] = {}
        }

        if (!this._errors[componentRecord.name][key]) {
            this._errors[componentRecord.name][key] = []
        }

        this._lastError = error
        this._errors[componentRecord.name][key].push(error)
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
                    'securitySchemes',
                    'links',
                    'callbacks'
                ]

                componentsKeys.forEach(componentKey => {
                    let sourceMap = sourceObject[componentKey]
                    if (!sourceMap) {
                        this.log(`Did not find key '${componentKey}' in components.`, 'debug')
                        return
                    }

                    if (typeof sourceMap !== 'object') {
                        this.log(`Found key '${componentKey}', but it is not the expected type (expected 'object', found '${typeof sourceMap}')`, 'warn')
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
                this.log(`Reading .openapi key on component ${component.name}`, 'debug')
            } else {
                this.log(`No .openapi key exported by the '${component.name}'`, 'debug')
                return
            }

            if (!Array.isArray(openapi)) {
                openapi = [openapi]
            }

            openapi.forEach(spec => {

                openapiKeys.forEach(key => {
                    let source = spec[key.name]
                    if (!source) {
                        this.log(`Did not find key '${key.name}' on .openapi declaration from '${component.name}'.`, 'debug')
                        return
                    }

                    switch(key.type) {
                        case 'array':
                            if (!Array.isArray(source)) {
                                this.log(`Found key '${key.name}' on .openapi declaration from '${component.name}', but it does not match the expected type (expected '${key.type}' found '${typeof source}')`, 'warn')
                                return
                            }
                            break
                        default:
                            if (typeof source !== key.type) {
                                this.log(`Found key '${key.name}' on .openapi declaration from '${component.name}', but it does not match the expected type (expected '${key.type}' found '${typeof source}')`, 'warn')
                                return
                            }
                            break
                    }

                    this.log(`Reading key '${key.name}' on .openapi declaration from '${component.name}'.`, 'debug')

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

        /**
         * Helper function to explore the Express application to discover endpoints. 
         * 
         * @param {object} router Expressjs handle object. This may be a router of an endpoint. For the first call this should be the global router for the application.
         * @param {string} basePath The endpoint path that we have accumulated so far. 
         * @param {object} doc The complete OpenAPI specification document. Paths will be added to this when discovered.
         * @param {object} log Logging function. 
         * @returns The object passed into the 'doc' parameter.
         */
        function _mapEndpoints(router, basePath, doc, log) {

            if (!router.stack) {
                return doc
            }

            router.stack.forEach(layer => {
                if (layer.name === 'router') {
                    // This is not an endpoint, recurse and look for endpoints there
                    return _mapEndpoints(layer.handle, (layer.handle._morrigan.route) ? basePath + layer.handle._morrigan.route : basePath, doc, log)
                }


                if (!layer.route) {
                    return doc
                }

                let route = layer.route

                route.stack.forEach(layer => {

                    let fullPath = basePath + route.path

                    log(`Looking for .openapi declarations @ '${fullPath}...`, 'debug')

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
                        this.log(`No method declared on layer, skipping.`, 'debug')
                        return
                    }

                    let openapi = layer.handle['openapi'] || {}
                    
                    if (!openapi) {
                        this.log(`No .openapi declaration found for ${m.toUpperCase()} ${fullPath}. Adding default spec...`, 'debug')
                        // Default value for unspecified openapi spec:
                        spec[m] = defaultSpec
                    } else {
                        
                        if (openapi[m]) {
                            log(`Found .openapi declaration for '${m}' method.`, 'debug')
                            try {
                                this.log(JSON.stringify(openapi[m]), 'silly')
                            } catch { /* NOOP */ }
                            // Use the openapi spec declared on the handler: 
                            spec[m] = openapi[m]
                        } else {
                            log(`No .openapi declaration found for ${m.toUpperCase()} ${fullPath}.`, 'silly')
                            // Default value for unspecified openapi spec:
                            spec[m] = defaultSpec
                        }
                    }
                    doc.paths[fullPath] = spec
                })
            })
        }

        let self = this

        _mapEndpoints(this.app._router, '', doc, (msg, level) => { self.log(msg, level) })

        return doc
    }
}


Object.keys(serverStates).forEach(k => Morrigan[k.toUpperCase()] = serverStates[k])

module.exports = Morrigan