"use strict"

const { DateTime } = require('luxon')
const {v4: uuidv4} = require('uuid')
const fs = require('fs')

var connections = []

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

    if (!functions || !functions.includes('clients')) {
        return false
    }

    return true

}

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

function ep_wsConnect (ws, request) {

    var record = {
        id: uuidv4(),
        clientAddress: request.connection.remoteAddress,
        authenticated: false,
        isAlive: true,
        open: true
    }

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
                ws.send(JSON.stringify({
                    type: 'connection.state',
                    state: 'rejected',
                    reason: 'Invalid token.'
                }))
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
            h(msg, ws, record, providers)
        } catch(e) {
            log (`Exception thrown while handling message: ${e}`)
        }
    })

    ws.on('close', () => {
        log(`Connection ${record.id} closed (client: ${record.clientId}).`)
        let client = providers.client.getClient(record.clientId)
        if (!client.state.match(/^stopped/)) {
            client.state = 'unknown'
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

module.exports.setup = (path, app) => {
    app.use(path, (req, res, next) => {
        
        if (verifyReqAuthentication(req)) {
            req.providers = providers
            next()
        } else {
            log(`Unauthenticated connection attempt from ${req.connection.remoteAddress}.`)
            res.status(403)
            res.end()
        }
    })

    app.ws(`${path}/connect`, ep_wsConnect)
    app.get(`${path}/connection`, ep_getConnections)
    app.get(`${path}/connection/:connectionId`, ep_getConnections)
    
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
                // console.log(endpoint.handler)

                app[endpoint.method](route, endpoint.handler)
            }
        }
    }
}