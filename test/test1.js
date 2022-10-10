const fs = require('fs')
const Morrigan = require('../server.js')
const SwaggerParser = require('@apidevtools/swagger-parser')
const testComponent = require('./testComponent')
const assert = require('assert')

const dataDir = `${__dirname}/data`

if (fs.existsSync(dataDir)) {
    fs.rmSync(dataDir, { recursive: true })
}

describe("Morrigan server", async () => {
   
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
                level: 'silly',
                logDir: `${__dirname}/data/log`
            },

            database: {
                connectionString: "mongodb://127.0.0.1:27017",
                dbname: "morrigan-server-test"
            },

            components: {}
        }

        settings.components[(Math.random().toString(16).split('.')[1])] = {
            module: testComponent,
            secret: (Math.random().toString(16).split('.')[1])
        }

        const baseUrl = `http://localhost:${settings.http.port}`

        before(() => {

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
            assert.equal(server._state, Morrigan.INSTANCED)
        })

        it(`Should have 'state' set to 'ininitialized' (${Morrigan.INITIALIZED}) after setup method finishes.`, done => {
            assert.strictEqual(server._state, Morrigan.INSTANCED)
            server.setup(() => {
                assert.strictEqual(server._state, Morrigan.INITIALIZED)
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
            assert.strictEqual(server._state, Morrigan.INITIALIZED)
            server.start(() => {
                assert.strictEqual(server._state, Morrigan.READY)
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
            assert.strictEqual(server._state, Morrigan.READY)

            let namespace = Object.keys(settings.components)[0]
            let component = settings.components[namespace]

            assert(component.module.flags.setupCalled)
        })

        it("Should provide 'db', 'info', 'state' and 'log' through the 'environment' object", () => {
            assert.strictEqual(server._state, Morrigan.READY)

            let namespace = Object.keys(settings.components)[0]
            let component = settings.components[namespace]

            assert(component.module.flags.databaseProvided)
            assert(component.module.flags.serverInfoProvided)
            assert(component.module.flags.logFunctionProvided)
            assert(component.module.flags.stateStoreProvided)
        })

        it("Should allow the component to retrieve  collections.", () => {
            assert.strictEqual(server._state, Morrigan.READY)

            let namespace = Object.keys(settings.components)[0]
            let component = settings.components[namespace]

            assert(component.module.flags.collectionRetrievable)
        })

        it(`Should listen on the specified port (${settings.http.port}) when it is ready`, (done) => {
            assert.strictEqual(server._state, Morrigan.READY)

            let http = require('http')

            http.get(baseUrl, (res) => {
                assert.equal(res.statusCode, 404, `Expected status code 404 since nothing should be published at the root URL (received ${res.statusCode}).`)
                done()
            })

        })

        it("Should publish a valid OpenAPI specification object at '/api-docs'", (done) => {
            assert.strictEqual(server._state, Morrigan.READY)

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
            assert.strictEqual(server._state, Morrigan.READY)

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
            assert.strictEqual(server._state, Morrigan.READY)
            server.stop('LifeCycle tests finished', () => {
                assert.strictEqual(server._state, Morrigan.STOPPED)
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
            assert.strictEqual(server._state, Morrigan.STOPPED)

            let namespace = Object.keys(settings.components)[0]
            let component = settings.components[namespace]

            assert(component.module.flags.onShutdownCalled)
            
        })

        it(`Should no longer be listening for requests on the given port (${settings.http.port}) when stopped`, (done) => {
            assert.strictEqual(server._state, Morrigan.STOPPED)

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

        after(async () => {
            // Double-check that we have stopped the server:
            await server.stop()
            delete server
        })
    })
})