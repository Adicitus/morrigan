const fs = require('fs')
const Morrigan = require('../server')
const SwaggerParser = require('@apidevtools/swagger-parser')
const testComponent = require('./testComponent')
const errorComponent = require('./errorComponent')
const errorComponentSync = require('./errorComponent')
const assert = require('assert')

const dataDir = `${__dirname}/data`

if (fs.existsSync(dataDir)) {
    fs.rmSync(dataDir, { recursive: true })
}

describe("Morrigan server", async () => {

    var mongoDbServer = null
   
    before(async () => {
        // Instantiation of a in-memory MOngoDB server to use for testing:
        const { MongoMemoryServer } = await import('mongodb-memory-server')
        mongoDbServer = await MongoMemoryServer.create()
    })

    describe("Lifecycle", () => {

        let server = null
        let flags = {
            error: false,
            initializing: false,
            initialized: false,
            starting: false,
            starting_connected: false,
            ready: false,
            stopping: false,
            stopped: false
        }
        
        let settings = {

            stateDir: `${dataDir}/state`, 

            http: {
                port: (Math.floor(Math.random() * 25536) + 40000)
            },

            logger: {
                console: true,
                level: 'silly',
                logDir: `${__dirname}/data/log`
            },

            database: {
                connectionString: 'mongodb://127.0.0.1:27017', // Default value, will be overwritten in the 'before' clause
                dbname: "morrigan-server-test"
            },

            components: {}
        }

        // Well-behaved component:
        settings.components[(Math.random().toString(16).split('.')[1])] = {
            module: testComponent,
            secret: (Math.random().toString(16).split('.')[1])
        }
        
        // Landmine:
        landmineName = (Math.random().toString(16).split('.')[1])
        settings.components[landmineName] = {
            module: errorComponent,
            secret: (Math.random().toString(16).split('.')[1])
        }
        
        // Landmine Sync:
        landmineSyncName = (Math.random().toString(16).split('.')[1])
        settings.components[landmineSyncName] = {
            module: errorComponentSync,
            secret: (Math.random().toString(16).split('.')[1])
        }

        const baseUrl = `http://localhost:${settings.http.port}`

        before(() => {
            settings.database.connectionString = mongoDbServer.getUri()

            server = new Morrigan(settings)

            server.on('error', () => flags.error = true)
            server.on('initializing', () => flags.initializing = true)
            server.on('initialized', () => flags.initialized = true)
            server.on('starting', () => flags.starting = true)
            server.on('starting_connected', () => flags.starting_connected = true)
            server.on('started', () => flags.started = true),
            server.on('ready', () => flags.ready = true)
            server.on('stopping', () => flags.stopping = true)
            server.on('stopped', () => flags.stopped = true)
        })

        it(`Should have 'state' set to 'instanced' (${Morrigan.INSTANCED})`, async () => {
            assert.equal(server.getState(), Morrigan.INSTANCED)
        })

        it(`Should have 'state' set to 'ininitialized' (${Morrigan.INITIALIZED}) after setup method finishes.`, done => {
            assert.strictEqual(server.getState(), Morrigan.INSTANCED)
            server.setup(() => {
                assert.strictEqual(server.getState(), Morrigan.INITIALIZED)
                assert(!flags.error)
                assert(flags.initializing)
                assert(flags.initialized)
                assert(!flags.starting)
                assert(!flags.starting_connected)
                assert(!flags.ready)
                assert(!flags.stopping)
                assert(!flags.stopped)
                done()
            })
        })


        it(`Should have 'state' progress through ${Morrigan.STARTING}-${Morrigan.READY} (starting -> ready) once the start method has finished.`, (done) => {
            assert.strictEqual(server.getState(), Morrigan.INITIALIZED)
            server.start(() => {
                assert.strictEqual(server.getState(), Morrigan.READY)
                assert(!flags.error)
                assert(flags.initializing)
                assert(flags.initialized)
                assert(flags.starting)
                assert(flags.starting_connected)
                assert(flags.ready)
                assert(!flags.stopping)
                assert(!flags.stopped)
                done()
            })
        })

        it("Should have called 'setup' method on components once state is 'ready'", () => {
            assert.strictEqual(server.getState(), Morrigan.READY)

            let namespace = Object.keys(settings.components)[0]
            let component = settings.components[namespace]

            assert(component.module.flags.setupCalled)
        })

        it("Should provide 'db', 'info', 'state' and 'log' through the 'environment' object", () => {
            assert.strictEqual(server.getState(), Morrigan.READY)

            let namespace = Object.keys(settings.components)[0]
            let component = settings.components[namespace]

            assert(component.module.flags.databaseProvided)
            assert(component.module.flags.serverInfoProvided)
            assert(component.module.flags.logFunctionProvided)
            assert(component.module.flags.stateStoreProvided)
        })

        it("Should allow the component to retrieve collections.", () => {
            assert.strictEqual(server.getState(), Morrigan.READY)

            let namespace = Object.keys(settings.components)[0]
            let component = settings.components[namespace]

            assert(component.module.flags.collectionRetrievable)
        })

        it(`Should listen on the specified port (${settings.http.port}) when it is ready`, (done) => {
            assert.strictEqual(server.getState(), Morrigan.READY)

            let http = require('http')

            http.get(baseUrl, (res) => {
                assert.equal(res.statusCode, 404, `Expected status code 404 since nothing should be published at the root URL (received ${res.statusCode}).`)
                done()
            })

        })

        it("Should publish a valid OpenAPI specification object at '/api-docs'", (done) => {
            assert.strictEqual(server.getState(), Morrigan.READY)

            let apiUrl  = `${baseUrl}/api-docs`

            let http = require('http')

            http.get(apiUrl, (res) => {
                res.setEncoding('utf8')
                res.on('data', (dataRaw) => {
                    assert.equal(res.statusCode, 200, "Expected status code 200 since when retrieving /api-docs, since this is where OpenAPI is published.")
                    assert(dataRaw)
                    assert.strictEqual(typeof dataRaw, 'string', `Expected stringified JSON to be returend by the server, found '${typeof dataRaw}'.`)
                    let data = JSON.parse(dataRaw)
                    assert.strictEqual(typeof data, 'object', `Expected a JSON object to be retruend by the server, found '${typeof data}'.`)
                    SwaggerParser.validate(data, (err, api) => {
                        if (err) {
                            assert.fail(err)
                        }
                        assert(api)
                        done()
                    })
                })
            })
        })

        it("Should make endpoints registered by components available under their ComponentSpec namespace ('/api/CcomponentSpec name>')", (done) => {
            assert.strictEqual(server.getState(), Morrigan.READY)

            let namespace = Object.keys(settings.components)[0]

            let componentEndpointUrl = `${baseUrl}/api/${namespace}`

            let http = require('http')

            http.get(componentEndpointUrl, (res) => {
                res.setEncoding('utf8')
                res.on('data', (dataRaw) => {
                    assert.strictEqual(res.statusCode, 200, `Expected to find the TestComponent at '${componentEndpointUrl}' but GET request recieved '${res.statusCode}' (expected '200').`)
                    let report = JSON.parse(dataRaw)
                    assert(report.name)
                    assert(report.secret)
                    assert.strictEqual(settings.components[report.name].secret, report.secret)
                    done()
                })
            })
        })

        it(`Should have 'state' progress through ${Morrigan.STOPPING}-${Morrigan.STOPPED} (stopping -> stopped) once stop method has finished`, (done) => {
            assert.strictEqual(server.getState(), Morrigan.READY)
            server.stop('LifeCycle tests finished', () => {
                assert.strictEqual(server.getState(), Morrigan.STOPPED)
                assert(!flags.error)
                assert(flags.initialized)
                assert(flags.starting)
                assert(flags.starting_connected)
                assert(flags.ready)
                assert(flags.stopping)
                assert(flags.stopped)
                done()
            })
        })

        it("Should have called 'onShutdown' method on components once state is 'stopped'", () => {
            assert.strictEqual(server.getState(), Morrigan.STOPPED)

            let namespace = Object.keys(settings.components)[0]
            let component = settings.components[namespace]

            assert(component.module.flags.onShutdownCalled)
        })

        it(`Should no longer be listening for requests on the given port (${settings.http.port}) when stopped`, (done) => {
            assert.strictEqual(server.getState(), Morrigan.STOPPED)

            let baseUrl = `http://localhost:${settings.http.port}`

            let http = require('http')

            let req = http.request(baseUrl, {method: 'get'})
            
            req.on('response', () => {
                assert.fail(`Received response when sending HTTP query to ${baseUrl}, indicating that the server is still listening.`)
            })

            req.on('error', err => {
                done()
            })
            
            req.end()
            
        })
        
        it("Should handle uncaught exceptions from component .setup methods", async () => {
            await server.start()
            assert.strictEqual(server.getState(), Morrigan.READY)
            assert.ok(server._errors[landmineName]['setup'])
            assert.ok(server._errors[landmineSyncName]['setup'])
        })

        it("Should handle uncaught exceptions from component .onShutdown methods", async () => {
            await server.stop()
            assert.ok(server._errors[landmineName]['onShutdown'])
            assert.ok(server._errors[landmineSyncName]['onShutdown'])
        })

        after(async () => {
            // Double-check that we have stopped the server:
            await server.stop()
            delete server
        })
    })

    after(async () => {
        // Attempt to stop the server gracefully:
        await mongoDbServer.stop()
    })
})