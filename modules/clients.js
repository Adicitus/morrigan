module.exports.version = '0.1.0.0'

const { DateTime } = require('luxon')
const jwt  = require('jsonwebtoken')
const {v4: uuidv4} = require('uuid')

var clients = []
var tokens = []

function log(msg) {
    console.log(`${DateTime.now()} | ${msg}`)
}


function getClient(clientId) {
    return clients.find((o) => o.id === clientId)
}

function getClients() {
    return clients
}

function removeClient(clientId) {
    let i = client.findIndex((o) => o.id === clientId)

    if (i === -1)  {
        return
    }

    clients.splice(i, 1)
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

    let client = getClient(clientId)

    let record = null

    if (client) {
        record = client
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

    log(`New token issued for client '${clientId}'.`)

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

    let client = getClient(token.clientId)

    return { state: 'success', client: client }
}

module.exports.verifyToken      = verifyToken
module.exports.provisionClient  = provisionClient
module.exports.provisionToken   = provisionToken
module.exports.getClient        = getClient
module.exports.removeClient     = removeClient


function ep_provisionClient(req, res) {

    let details = req.body
    
    log(`Provisioning client '${details.id}' for ${req.authenticated.name}`)

    let t = provisionClient(details.id)

    res.status(200)
    res.send(JSON.stringify({token: t.token}))
}

function ep_getClients(req, res) {

    if (req.params) {

        let params = req.params

        if (params.clientId) {
            let c = getClient(params.clientId)
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
    res.send(JSON.stringify(getClients()))
}


module.exports.endpoints = [
    {route: '/', method: 'get', handler: ep_getClients},
    {route: '/provision', method: 'post', handler: ep_provisionClient},
    {route: '/:clientId', method: 'get', handler: ep_getClients}
]