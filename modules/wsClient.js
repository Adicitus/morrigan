"use strict"

const { DateTime } = require('luxon')
const jwt  = require('jsonwebtoken')
const {v4: uuidv4} = require('uuid')

var connections = []
var clients = []
var tokens = []

function log(msg) {
    console.log(`${DateTime.now()} | ${msg}`)
}

function verifyReqAuthentication(req) {
    if (!req.authenticated) {
        return false
    }

    let functions = req.authenticated.functions

    if (!functions || !functions.includes('clients')) {
        return false
    }

    return true

}

/**
 * Provisions resources for a client with the given clientId.
 * 
 * Calling this function with the ID of an existing client will cause the
 * existing token to be replaced with a new one.
 * 
 * This function returns an object containing a token that the client should
 * use when connecting via WebSocket, the ID of the token and the the token's
 * expiration date/time.
 * 
 * @param {string} clientId - ID to setup client resources for.
 */
function provisionClient(clientId){
    
    let i = clients.findIndex((o) => o.id === clientId)

    let record = null

    if (i !== -1) {
        record = clients[i]
    } else {
        record = {
            id: clientId,
            created: DateTime.now()
        }
        clients.push(record)
    }

    let t = provisionToken(clientId)

    record.tokenId = t.id
    record.tokenExpires = t.expires
    
    record.updated = DateTime.now()

    return t

}

/**
 * Provisions a new token for the client with the given clientId.
 * 
 * This function returns an object containing a token that the client should
 * use when connecting via WebSocket, the ID of the token for the client and
 * the expiry date/time of the token.
 * 
 * @param {string} clientId - ID of the client to provision a token for.
 */
function provisionToken(clientId) {

    let now = DateTime.now()
    let newTokenId = uuidv4()

    let record = {
        id: newTokenId,
        clientId: clientId,
        tokenIssued: now,
        tokenExpires: now.plus({days: 30}),
        secret: uuidv4()
    }

    let payload = {
        id: newTokenId,
        clientId: clientId,
        iat: Math.round(record.tokenIssued.toSeconds()),
        exp: Math.round(record.tokenExpires.toSeconds())
    }

    let token = jwt.sign(payload, record.secret)
    let encId = Buffer.from(clientId).toString('base64')
    let signedToken = encId + "." + token

    
    let i = tokens.findIndex((o) => o.clientId == clientId)

    if (i === -1) {
        tokens.push(record)
    } else {
        tokens.splice(i, 1, record)
    }

    log (`New token issued for client '${clientId}'.`)

    return { id: newTokenId, expires: record.tokenExpires, token: signedToken }
}

/**
 * Attempts to verify the validity of a token.
 * 
 * Will return a object with a 'state' field and a data field.
 * 
 * If verification was successful, the state will be 'success' and the object
 * will contain a field 'client' with the client specified by the token.
 * 
 * If verification was unsuccessful, there will be a 'reason' with a shot
 * description of what went wrong.
 * 
 * @param {string} signedToken - The token to verify.
 */
function verifyToken(signedToken) {

    if ((typeof signedToken) !== 'string') {
        return { state: 'authenticationfailed', reason: 'Invalid token type.'}
    }

    const signedTokenRegex = /(?<clientId>[^.]+)\.(?<token>[^.]+\.[^.]+\.[^.]+)/
    
    let m = signedToken.match(signedTokenRegex)

    if (!m) {
        return { state: 'authenticationfailed', reason: 'Invalid token format.'}
    }

    let clientId = Buffer.from(m.groups.clientId, 'base64').toString()

    let i = tokens.findIndex((o) => o.clientId === clientId)

    if (i === -1) {
        return { state: 'authenticationFailed', reason: 'No such client.' }
    }

    let token = tokens[i]

    let t = m.groups.token

    try {
        jwt.verify(t, token.secret)
    } catch(e) {
        return { state: 'authenticationFailed', reason: 'Token unreadable.' }
    }

    let p = jwt.decode(t, token.secret)

    if (p.clientId != token.clientId) {
        // Someone is forging tokens.
        return { state: 'authenticationFailed', reason: 'Token signing mismatch.' }
    }

    if (p.id != token.id) {
        // Wrong token provided, probably an old token from a client that has been reprovisioned.
        return { state: 'authenticationFailed', reason: 'Token ID mismatch.' }
    }

    let client = clients.find((o) => o.id === token.clientId)

    return { state: 'success', client: client }
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
                let r = provisionToken(record.clientId)
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

                let client = clients.find((o) => o.id === record.clientId)
                client.capabilities = message.capabilities
            }
        }
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
            let r = verifyToken(message)
            
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


function ep_provisionClient(req, res) {

    if (!verifyReqAuthentication(req)) {
        req.status(403)
        res.end()
        return
    }

    let details = req.body

    if (!details.id) {
        res.status(400)
        res.end()
        return
    }
    
    log(`Provisioning client '${details.id}' for ${req.authenticated.name}`)

    let t = provisionClient(details.id)

    res.status(200)
    res.send(JSON.stringify({token: t.token}))
}

function ep_getClients(req, res) {

    if (!verifyReqAuthentication(req)) {
        req.status = 403
        res.end()
        return
    }

    if (req.params) {

        let params = req.params

        if (params.clientId) {
            let c = clients.find((o) => o.id === params.clientId)
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
    res.send(JSON.stringify(clients))
}

function ep_getConnections(req, res) {
    if (!verifyReqAuthentication(req)) {
        req.status(403)
        res.end()
        return
    }

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
    app.ws(`${path}/connect`, ep_wsConnect)
    app.post(`${path}/provision`, ep_provisionClient)
    app.get(`${path}/client`, ep_getClients)
    app.get(`${path}/client/:clientId`, ep_getClients)
    app.get(`${path}/connection`, ep_getConnections)
    app.get(`${path}/connection/:connectionId`, ep_getConnections)
}