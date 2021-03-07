"use strict"

const { DateTime } = require('luxon')
const {v4: uuidv4} = require('uuid')
const fs = require('fs')

var connections = []
var sockets = {}

const settingsPath = `${__dirname}\server.setings.json`

var settings = null

if (fs.existsSync(settingsPath)) {
    let settingsRaw = fs.readFileSync(settingsPath)
    settings = JSON.stringify(settingsRaw.toString())
} else {
    settings = {}
}


function log(msg) {
    console.log(`${DateTime.now()} | ${msg}`)
}

function verifyReqAuthentication(req) {

    if (req.headers.upgrade && req.headers.upgrade === 'websocket') {
        return true
    }

    if (!req.authenticated) {
        return false
    }

    let functions = req.authenticated.functions

    if (!functions || !functions.includes('api')) {
        return false
    }

    return true

}

var send = (connectionId, message) => {
    let r = connections.find((o) => o.id === connectionId)
    if (!r.isAlive || !r.open ) {
        return { status: 'failed', reason: 'Connection closed or client not live.' }
    }

    let msg = null

    switch(typeof(message)) {
        case 'string': { msg = message }
        default: {msg = JSON.stringify(message)}
    }

    let s = sockets[connectionId]

    s.send(msg)

    return {status: 'success'}
}

/**
 * Tries to load all providers from the 'providers' directory (__dirname/providers).
 * 
 * A provider module is a file called module.js in a folder with the name of the provider.
 */
function loadProviders() {
    let providers = {}
    let providersDir = `${__dirname}/providers`
    let providerNames = fs.readdirSync(providersDir)
    for (var i in providerNames) {
        let name = providerNames[i]
        let providerModulePath = `${providersDir}/${name}/module.js`
        if (fs.existsSync(providerModulePath)) {
            try {
                let provider = require(providerModulePath)
                providers[name] = provider
            } catch(e) {
                log(`Failed to read provider module '${providerModulePath}': ${e}`)
            }
        }
    }

    return providers
}

// Handlers should be defined as modules and loaded from the 'providers' directory.
// Provider modules should export a 'version' string and a 'messages' object. Each key on the 'messages' object should
// define a handler that can accept the message object received from the server, a connection object and a 'record'
// object containing metadata about the connection (including the clientId of the client associated with the connection).
var providers = loadProviders()

const coreEnv = {
    'providers': providers,
    'settings': settings,
    'log': log
}

for (const p in providers) {
    let provider = providers[p]
    if (provider.setup) {
        provider.setup(coreEnv)
    }
}

function ep_wsConnect (ws, request) {

    var record = {
        id: uuidv4(),
        clientAddress: request.connection.remoteAddress,
        authenticated: false,
        isAlive: true,
        open: true
    }

    connections.push(record)

    log(`Connection ${record.id} established from ${request.connection.remoteAddress} via ${request.headers.origin}`)

    // Heartbeat monitor
    var heartBeatCheck = setInterval(() => {
            if (!record.isAlive) {
                log(`Heartbeat missed by ${request.connection.remoteAddress}`)
            }
            record.isAlive = false
            ws.ping()
        },
        30000
    )

    var authenticaiontTimeout = setTimeout(() => {
            if (!record.authenticated) {
                log(`Client failed to authenticate within 3 seconds, closing connection ${record.id}.`)
                cleanup()
                return
            }
        },
        3000
    )

    var cleanup = () => {
        if (ws.readyState == 1) {
            ws.close()
        }
        
        record.isAlive = false
        record.open = false
        clearInterval(heartBeatCheck)
        clearTimeout(authenticaiontTimeout)

        if (!record.clientId) {
            let i = connections.findIndex((o) => o.id === record.id)
            connections.splice(i, 1)
        }
    }

    ws.on('pong', () => {
        record.lastHearbeat = DateTime.now()
        record.isAlive = true
    })

    ws.on('message', (message) => {
        // First message, assumed to be token.
        if (!record.authenticated) {
            let r = providers.client.verifyToken(message)
            
            if (r.state !== 'success') {
                log(`${record.id} failed authentication attempt. state: '${r.state}', reason: ${r.reason}`)
                log(`Client sent invalid token, closing connection`)
                if (ws.readyState === 1) {
                    ws.send(JSON.stringify({
                        type: 'connection.state',
                        state: 'rejected',
                        reason: 'Invalid token.'
                    }))
                }
                cleanup()
                return
            }

            let client = r.client

            log(`Connection ${record.id} authenticated as ${client.id}.`)

            record.authenticated = true
            record.clientId = client.id

            if (client.connectionId) {
                let i = connections.findIndex((o) => o.id === client.connectionId)
                if (i !== -1) {
                    let c = connections[i]
                    if (c.isAlive) {
                        log(`Client '${client.id}' is already active in connection ${connection.id}. Closing this connection.`)
                        cleanup()
                        return
                    }

                    connections.splice(i, 1)
                }
            }

            client.connectionId = record.id
            sockets[record.id]  = ws

            ws.send(
                JSON.stringify({
                    type: 'connection.state',
                    state: 'accepted'
                })
            )
            ws.send(
                JSON.stringify({
                   type: 'capability.report' 
                })
            )
            return
        }

        try {
            var msg = JSON.parse(message)
        } catch(e) {
            log(`Invalid JSON received: ${message}`)
            return
        }

        if(!msg.type) {
            log(`Message without type declaration: ${message}`)
            return
        }

        let m = msg.type.match(/^(?<provider>[A-z0-9\-_]+)\.(?<message>[A-z0-9\-_.]+)$/)

        if (!m) {
            log(`Message with invalid message type: ${message}`)
            return
        }

        let p = providers[m.groups.provider]

        if (!p) {
            log(`No provider for the message type: ${message}`)
            return
        }

        let h = p.messages[m.groups.message]

        if (!h) {
            log(`No handler defined for the message type: ${message}`)
            return
        }

        try {
            h(msg, ws, record, coreEnv)
        } catch(e) {
            log (`Exception thrown while handling message: ${e}`)
        }
    })

    ws.on('close', () => {
        log(`Connection ${record.id} closed (client: ${record.clientId}).`)
        let client = providers.client.getClient(record.clientId)
        if (client) {
            if (!client.state || !client.state.match(/^stopped/)) {
                client.state = 'unknown'
            }
        }
        cleanup()
    })

}

function ep_getConnections(req, res) {

    if (req.params) {

        let params = req.params

        if (params.connectionId) {
            let c = connections.find((o) => o.id === params.connectionId)
            if (c) {
                res.status(200)
                res.send(JSON.stringify(c))
                return
            } else {
                res.status(204)
                res.end()
                return
            }
        }
        
    }

    res.status(200)
    res.send(JSON.stringify(connections))
}

function ep_send(req, res) {
    if (!req.authenticated.functions.includes('connection.send')) {
        res.status(403)
        res.send(JSON.stringify({ status: 'failed', reason: 'Send not permitted.' }))
        return
    }

    if (!req.params.connectionId) {
        res.status(400)
        res.send(JSON.stringify({ status: 'failed', reason: 'No connectionId specified.' }))
        return
    }

    if (!req.body) {
        res.status(400)
        res.send(JSON.stringify({ status: 'failed', reason: 'No message specified.' }))
        return
    }

    let msg = req.body

    if (!msg.type) {
        res.status(400)
        res.send(JSON.stringify({ status: 'failed', reason: 'No message type specified.' }))
        return
    }

    let cid = req.params.connectionId
    let r = send(cid, msg)

    if (r.status === 'success') {
        res.status(200)
    } else {
        res.status(400)
    }

    res.send(JSON.stringify(r))
}

/**
 * Connection pseudo-provider is specified here because the connection
 * functionality is a part of wsCore, but declaring a provider allows
 * this functionality to be covered by the same system used to handle
 * other providers.
 */
providers.connection = {
    version: '0.1.0.0',
    endpoints: [
        {route: '/', method: 'get', handler: ep_getConnections},
        {route: '/:connectionId', method: 'get', handler: ep_getConnections},
        {route: '/send/:connectionId', method: 'post', handler: ep_send}
    ],
    functions: [
        'api',
        'connection',
        'connection.send'
    ],
    send: send
}

module.exports.setup = (path, app) => {
    app.use(path, (req, res, next) => {
        
        if (verifyReqAuthentication(req)) {
            req.core = coreEnv
            next()
        } else {
            log(`Unauthenticated connection attempt from ${req.connection.remoteAddress}.`)
            res.status(403)
            res.end()
        }
    })

    app.ws(`${path}/connect`, ep_wsConnect)
    
    for (var namespace in providers) {
        let endpoints = providers[namespace].endpoints
        if (endpoints && Array.isArray(endpoints)) {
            for (var i in endpoints) {
                let endpoint = endpoints[i]

                if (!endpoint.route || typeof(endpoint.route) !== 'string' || !endpoint.route.match(/\/([^/]+(\/[^/]+)*)?/) ) {
                    log(`Invalid endpoint route specified: ${endpoint.route}`)
                    continue
                }

                if (!endpoint.method || typeof(endpoint.method) !== 'string' || !['connect', 'delete', 'get', 'head', 'options', 'patch', 'post', 'put', 'trace'].includes(endpoint.method)) {
                    log(`Invalid endpoint method specified: ${endpoint.method}`)
                    continue
                }

                if (!endpoint.handler || typeof(endpoint.handler) !== 'function') {
                    log(`Invalid endpoint handler specified: ${endpoint.handler}`)
                    continue
                }

                let route = `${path}/${namespace}${endpoint.route}`

                log(`Adding handler for '${endpoint.method.toUpperCase()} ${route}'`)

                app[endpoint.method](route, endpoint.handler)
            }
        }
    }
}