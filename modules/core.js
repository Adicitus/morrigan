"use strict"

const { DateTime } = require('luxon')
const {v4: uuidv4} = require('uuid')

var connections = []
var sockets = {}

var providers = null

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

    if (!r) {
        return { status: 'failed', reason: 'No such connection.' }
    }

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

const coreEnv = {
    'providers': providers,
    'log': log
}

function ep_wsConnect (ws, request) {

    var heartBeatCheck = null

    var record = {
        id: uuidv4(),
        clientAddress: request.connection.remoteAddress,
        authenticated: false,
        isAlive: true,
        open: true
    }

    connections.push(record)

    var cleanup = () => {
        if (ws.readyState == 1) {
            ws.close()
        }
        
        record.isAlive = false
        record.open = false
        if (heartBeatCheck) {
            clearInterval(heartBeatCheck)
        }

        let i = connections.findIndex((o) => o.id === record.id)
        connections.splice(i, 1)
    }

    log(`Connection ${record.id} established from ${request.connection.remoteAddress} via ${request.headers.origin}`)

    let r = providers.client.verifyToken(request.headers.origin)

    if (r.state !== 'success') {
        log(`${record.id} failed authentication attempt. state: '${r.state}', reason: ${r.reason}`)
        log(`Client sent invalid token, closing connection`)
        cleanup()
        return
    }

    let client = r.client

    log(`Connection ${record.id} authenticated as ${client.id}.`)


    if (client.connectionId) {
        let i = connections.findIndex((o) => o.id === client.connectionId)
        if (i !== -1) {
            let c = connections[i]
            if (c.isAlive) {
                log(`Client '${client.id}' is already active in connection ${c.id}. Closing this connection.`)
                cleanup()
                return
            }

            connections.splice(i, 1)
        }
    }

    record.authenticated = true
    record.clientId = client.id
    client.connectionId = record.id
    sockets[record.id]  = ws

    ws.on('pong', () => {
        record.lastHearbeat = DateTime.now()
        record.isAlive = true
    })

    ws.on('message', (message) => {
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
            log (`Exception thrown while handling message (${m.groups.message}): ${e}`)
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

    // Heartbeat monitor
    heartBeatCheck = setInterval(() => {
            if (!record.isAlive) {
                log(`Heartbeat missed by ${request.connection.remoteAddress}`)
            }
            record.isAlive = false
            ws.ping()
        },
        30000
    )

    log(`Connection ${record.id} is ready.`)

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
 * Used to set up core functionality.
 * 
 * @param {string} path - Base path to set up the endpoints under.
 * @param {object} app - The express app to set up endpoints on.
 * @param {object} serverEnv - Server environment, expected to contain:
 *  + settings: The server settings object.
 *  + log: The log function to use.
 */
module.exports.setup = (path, app, serverEnv) => {

    let settings = serverEnv.settings

    coreEnv.settings = settings
    coreEnv.log = log = serverEnv.log

    app.use(path, (req, res, next) => {
        
        if (verifyReqAuthentication(req)) {
            req.core = coreEnv
            next()
        } else {
            log(`Unauthenticated connection attempt from ${req.connection.remoteAddress}.`)
            res.status(403)
            res.end()
            return
        }
    })

    app.ws(`${path}/connect`, ep_wsConnect)
    

    /**
     * Connection pseudo-provider is specified here because the connection
     * functionality is a part of wsCore, but declaring a provider allows
     * this functionality to be covered by the same system used to handle
     * other providers.
     */
    providers = {
        connection: {
            version: '0.1.0.0',
            endpoints: [
                {route: '/', method: 'get', handler: ep_getConnections},
                {route: '/:connectionId', method: 'get', handler: ep_getConnections},
                {route: '/:connectionId/send', method: 'post', handler: ep_send}
            ],
            functions: [
                'api',
                'connection',
                'connection.send'
            ],
            send: send
        }
    }
    

    // Handlers should be defined as modules and loaded from the 'providers' directory.
    // Provider modules should export a 'version' string and a 'messages' object. Each key on the 'messages' object should
    // define a handler that can accept the message object received from the server, a connection object and a 'record'
    // object containing metadata about the connection (including the clientId of the client associated with the connection).
    let providerPaths = [`${__dirname}/providers`]
    if (settings.api && settings.api.providerPaths) {
        let a = settings.api.providerPaths
        if (Array.isArray(a)) {
            providerPaths = providerPaths.concat(a)
        } else {
            providerPaths.push(a)
        }
    }
    providers = require('./providers').setup(app, path, providerPaths, coreEnv, providers)

    coreEnv.providers = providers

}