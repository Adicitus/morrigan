module.exports.version = '0.1.0.0'

const { DateTime } = require('luxon')
const jwt  = require('jsonwebtoken')
const {v4: uuidv4} = require('uuid')

var clientRecords = null
var tokenRecords = null

var log = null


async function getClient(clientId) {
    return await clientRecords.findOne({ id: clientId })
}

async function getClients() {
    return await clientRecords.find().toArray()
}

async function removeClient(clientId) {
    await clientRecords.deleteOne({ id: clientId})
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
async function provisionClient(clientId){

    let client = await getClient(clientId)

    let record = null

    if (client) {
        record = client
    } else {
        record = {
            id: clientId,
            created: DateTime.now()
        }
        await clientRecords.insertOne(record)
    }

    let t = await provisionToken(clientId)

    record.tokenId = t.id
    record.updated = DateTime.now()

    clientRecords.replaceOne({id: record.id}, record)

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
async function provisionToken(clientId) {

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

    let t = await tokenRecords.findOne({clientId: clientId})

    if (t) {
        tokenRecords.replaceOne({clientId: clientId}, record)
    } else {
        tokenRecords.insertOne(record)
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
async function verifyToken(signedToken) {

    if ((typeof signedToken) !== 'string') {
        return { state: 'authenticationfailed', reason: 'Invalid token type.'}
    }

    const signedTokenRegex = /(?<clientId>[^.]+)\.(?<token>[^.]+\.[^.]+\.[^.]+)/
    
    let m = signedToken.match(signedTokenRegex)

    if (!m) {
        return { state: 'authenticationfailed', reason: 'Invalid token format.'}
    }

    let clientId = Buffer.from(m.groups.clientId, 'base64').toString()

    let token = await tokenRecords.findOne({ clientId: clientId })

    if (!token) {
        return { state: 'authenticationFailed', reason: 'No such client.' }
    }

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

    let client = await getClient(token.clientId)

    return { state: 'success', client: client }
}

module.exports.verifyToken      = verifyToken
module.exports.provisionClient  = provisionClient
module.exports.provisionToken   = provisionToken
module.exports.getClient        = getClient
module.exports.removeClient     = removeClient

/* =========== Start Endpoint Definition ============== */

async function ep_provisionClient(req, res) {

    let details = req.body
    
    log(`Provisioning client '${details.id}' for ${req.authenticated.name}`)

    let t = await provisionClient(details.id)

    res.status(200)
    res.send(JSON.stringify(t))
}

async function ep_getClients(req, res) {

    if (req.params) {

        let params = req.params

        if (params.clientId) {
            let c = await getClient(params.clientId)
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
    res.send(JSON.stringify(await getClients()))
}

module.exports.endpoints = [
    {route: '/', method: 'get', handler: ep_getClients},
    {route: '/provision', method: 'post', handler: ep_provisionClient},
    {route: '/:clientId', method: 'get', handler: ep_getClients}
]

module.exports.messages = {
    /**
     * The client is asking for a refreshed token, respond wiht client.token.issue
     * containing a newly provisioned token.
     */
    'token.refresh': async (message, connection, record, core) => {
        core.log(`Client ${record.clientId} requested a new token.`)
        let r = await provisionToken(record.clientId)
        connection.send(JSON.stringify({
            type: 'client.token.issue',
            token: r.token,
            expires: r.expires
        }))
    },

    'state': async (message, connection, record, core) => {
        let providers = core.providers
        core.log(`Client ${record.clientId} reported state: ${message.state}`)
        let client = await providers.client.getClient(record.clientId)
        client.state = message.state
    }
}

module.exports.setup = async (coreEnv) => {
    log = coreEnv.log

    clientRecords = coreEnv.db.collection('clients')
    tokenRecords = coreEnv.db.collection('clientTokens')
}