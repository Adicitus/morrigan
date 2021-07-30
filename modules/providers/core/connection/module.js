"use strict"

const { DateTime } = require('luxon')
const {v4: uuidv4} = require('uuid')

var coreEnv = null
var log = null

var connections = []
var sockets = {}

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

function ep_wsConnect (ws, request) {
    
    var heartBeatCheck = null

    var record = {
        id: uuidv4(),
        clientAddress: request.connection.remoteAddress,
        authenticated: false,
        isAlive: true,
        open: true
    }

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
        if (i !== -1) {
            connections.splice(i, 1)
        }
    }

    log(`Connection ${record.id} established from ${request.connection.remoteAddress}`)

    let r = coreEnv.providers.client.verifyToken(request.headers.origin)

    if (r.state !== 'success') {
        log(`${record.id} failed authentication attempt. state: '${r.state}', reason: ${r.reason}`)
        log(`Client sent invalid token, closing connection`)
        cleanup()
        return
    }

    let client = r.client

    log(`Connection ${record.id} authenticated as '${client.id}'.`)


    if (client.connectionId) {
        let i = connections.findIndex((o) => o.id === client.connectionId)
        if (i !== -1) {
            let c = connections[i]
            // If the client has an active connection abort this connection attempt:
            if (c.isAlive) {
                log(`Client '${client.id}' is already active in connection ${c.id}. Closing this connection.`)
                cleanup()
                return
            }

            // If the old connection is inactive, remove it.
            connections.splice(i, 1)
        }
    }

    record.authenticated = true
    record.clientId = client.id
    client.connectionId = record.id
    record.serverId = coreEnv.serverInfo.id
    sockets[record.id]  = ws

    connections.push(record)

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

        let p = coreEnv.providers[m.groups.provider]

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
        let client = coreEnv.providers.client.getClient(record.clientId)
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


module.exports.version = '0.1.0.0',
module.exports.endpoints = [
    {route: '/connect', method: 'ws', handler: ep_wsConnect},
    {route: '/', method: 'get', handler: ep_getConnections},
    {route: '/:connectionId', method: 'get', handler: ep_getConnections},
    {route: '/:connectionId/send', method: 'post', handler: ep_send}
]
module.exports.functions = [
    'api',
    'connection',
    'connection.send'
]

module.exports.setup = (env)  => {
    coreEnv = env
    log = env.log
}

module.exports.send = send