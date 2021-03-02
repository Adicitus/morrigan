"use strict"

const { DateTime } = require('luxon')
const {v4: uuidv4} = require('uuid')

const clients = require('./clients')

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

// Temporary list of message handlers. Handlers should be defined as modules and loaded from the 'providers' directory.
// Provider modules should export a 'version' string and a 'messages' object. Each key on the 'messages' object should
// define a handler that can accept the message object received from the server, a connection object and a 'record'
// object containing metadata about the connection (including the clientId of the client associated with the connection).
var providers = {
    'token': {
        version: '0.1.0.0',
        messages: {
            /**
             * 'token.refresh' message
             * Client asks for a new token, server responds with a 'refresh.issue' message containing
             * the new token in the field called 'token'.
             */
            'refresh': (message, connection, record) => {
                let r = clients.provisionToken(record.clientId)
                connection.send(JSON.stringify({
                    type: 'token.issue',
                    token: r.token,
                    expires: r.expires
                }))
            }
        }
    },
    'session': {
        version: '0.1.0.0',
        messages: {
            capability: (message, connection, record) => {
                log(`${record.clientId} reported the following capabilities:`)
                for (var c in message.capabilities) {
                    let capability = message.capabilities[c]
                    log (`${capability.name} (${capability.version})`)
                }

                let client = clients.getClient(record.clientId)
                client.capabilities = message.capabilities
            }
        }
    },
    'client': clients
}

function ep_wsConnect (ws, request) {

    var record = {
        id: uuidv4(),
        clientAddress: request.connection.remoteAddress,
        authenticated: false,
        isAlive: true,
        open: true
    }

    const index = connections.push(record) - 1

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
            let r = clients.verifyToken(message)
            
            if (r.state !== 'success') {
                log(`${record.id} failed authentication attempt. state: '${r.state}', reason: ${r.reason}`)
                log(`Client sent invalid token, closing connection`)
                ws.send(JSON.stringify({
                    type: 'session.state',
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
                    type: 'session.state',
                    state: 'accepted'
                })
            )
            ws.send(
                JSON.stringify({
                   type: 'session.capability' 
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

        let m = msg.type.match(/^(?<provider>[A-z0-9\-_]+)\.(?<message>[A-z0-9\-_]+)$/)

        if (!m) {
            log(`Message without with invalid message type: ${message}`)
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
            h(msg, ws, record)
        } catch(e) {
            log (`Exception thrown while handling message: ${e}`)
        }
    })

    ws.on('close', () => {
        log(`Connection ${record.id} closed.`)
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

                log(`Adding ${endpoint.method} handler at '${route}'`)
                // console.log(endpoint.handler)

                app[endpoint.method](route, endpoint.handler)
            }
        }
    }
}