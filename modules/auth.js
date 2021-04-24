//auth.js

"use strict"

const modulename = 'auth'
const access = {
    identity: {
        description: "Allowed to access identity functions.",

        create: {
            description: "Allowed to create new identities."
        },

        get: {
            all: {
                description: "Allowed to read any identity."
            }
        },

        update: {
            all: {
                description: "Allowed to update any identity."
            }
        },

        delete: {
            all: {
                description: "Allowed to remove any identity."
            }
        }
    }
}

/**
 * Helper function to turn the "access" object into an access right list.
 * 
 * Recursively processes all keys in the "scope" object, interpreting any key that
 * addresses an obejct with a "description" key as the name of a function to list access for.
 * 
 * 
 * 
 * @param {string} prefix 
 * @param {object} scope 
 */
function buildAccessRightsList(prefix, scope) {

    var ar_ns = Object.keys(scope)
    
    let ars = []

    for(var i in ar_ns) {
        let name = ar_ns[i]

        let fullname = `${prefix}.${name}`
        
        if (scope[name].description) {
            ars.push({ name: fullname, description: scope[name].description })
            scope[name].fullname = fullname
        }

        if (typeof scope[name] === 'object') {
            let ars_r = buildAccessRightsList(fullname, scope[name])
            ars = ars.concat(ars_r)
        }
    }

    return ars
}

module.exports.name = modulename
const accessRights = buildAccessRightsList(modulename, access)
module.exports.functions = accessRights

console.log(access)

const { DateTime } = require('luxon')
const jwt = require('jsonwebtoken')
const {v4: uuidv4} = require('uuid')

const secret = uuidv4()

/**
 * Temporary hard-coded list of supported authentication types.
 *
 * Each authentication type should have be defined by a
 * corresponding autehntication provider.
 * 
 * A authentication provider is a module that exports 3 functions:
 *  + Authenticate: Given the authentication details for an
 *      identity and login details provided by the user, this
 *      function should verify whether the login details are
 *      correct.
 *  + Validate: Given the authentication details for an identity,
 *      this function should verify that the details are correct,
 *      complete and could be used to verify login details.
 *  + Commit: Given the authentication details for an identity,
 *      should perform any tasks needed to enable verification using
 *      the  "authenticate" function.
 */
// TODO: Write a function to dynamically import authentication providers
var authTypes = null

// Temporary list of users, this should be moved into a DB.
var identityRecords = null
var authenticationRecords = null

/**
 * Used to generate a token for the provided identity.
 * 
 * Options:
 *  - duration: A luxon duration to to define how long the token should be valid.
 * 
 * @param {object} identity - Details of the identity to create a token for.
 * @param {object} options  - Options to modify the way that the token is generated
 */
function newToken(identity, options) {
    var now = DateTime.now()
    var payload = {
        id: identity.id,
        name: identity.name,
        iat: Math.round(now.toSeconds()),
        exp: Math.round(now.plus({minutes: 30}).toSeconds())
    }

    if (options) {
        if (options.duration) {
            payload.exp = Math.round(now.plus(options.duration).toSeconds())
        }
    }

    if (identity.functions) {
        payload.functions = identity.functions
    }

    var t = jwt.sign(payload, secret)

    return t
}

/**
 * Attempts to validate the provided token. Returns the payload as an object if the token is valid.
 * 
 * @param {string} token - Token to validate.
 */
function verifyToken(token) {
    try {
        jwt.verify(token, secret)
        return jwt.decode(token, secret)
    } catch {
        return null
    }
}

/**
 * Verifies a set of identity details versus the expected format and returns a sanitized record if successful.
 * 
 * By default the only compulsory detail is 'name', since this is currently
 * used as the primary key for identityRecords.
 * 
 * 3 fields will be validated: 'name', 'auth' and 'functions'.
 * 
 * The name field should be a string matching the regex '[A-z0-9_\-.]+'.
 * 
 * The auth field will be validated by the authenticaton type provider.
 * 
 * The functions field should be an array of strings, but can be omitted altogether.
 * 
 * if calidation is successful, a sanitized record generated from the provided details
 * will be provided in the 'cleanRecord' field on the returned object.
 * 
 * Options:
 *  - newIdentity: When set to true, changes the approach. Verifies that the name IS NOT in use and requires authentication details to be specified.
 *  - validFunctions: A list of functions names to validate the function names in details against.
 * 
 * @param {object} details - Details to be verified.
 * @param {object} options - Options to modify how the functions validates the details.
 */
async function validateIdentitySpec(details, options) {

    const nameRegex     = /[A-z0-9_\-.]+/
    const functionRegex = /[A-z0-9_\-.]+/

    var cleanRecord = {}
    var authType = null

    if (!options) {
        options = {}
    }

    /* ===== Start: Validate name ===== */
    if (options.newIdentity && !details.name) {
        return {state: 'requestError', reason: 'No user name specified.'}
    }

    if (details.name && !details.name.match(nameRegex)) {
        return {state: 'requestError', reason: `Invalid name format (should match regex ${nameRegex}).`}
    }

    if (details.name) {
        let i = await identityRecords.findOne({ name: details.name })

        if (options.newIdentity) {
            if (i) {
                return {state: 'requestError', reason: 'Identity name already in use.'}
            }
        } else {
            if (!i) {
                return {state: 'requestError', reason: 'No such user.'}
            }
        }
        cleanRecord.name = details.name
    }
    /* ====== End: Validate name ====== */

    
    /* ===== Start: Validate authentication ===== */
    if (options.newIdentity && !details.auth) {
        return { state: 'requestError', reason: 'No athentication details specified for new identity.' }
    }

    if (details.auth) {
        let auth = details.auth

        if (!auth.type) {
            return { state: 'requestError', reason: 'No authentication type specified.' }
        }

        authType = authTypes[auth.type]

        if (!authType) {
            return { state: 'serverConfigurationError', reason: `Invalid authentication type specified for user: ${auth.type}` }
        }

        if (!authType.validate) {
            return { state: 'serverConfigurationError', reason: `No validation function specified for authentication type: ${auth.type}` }
        }

        if (!authType.commit) {
            return { state: 'serverConfigurationError', reason: `No commit function specified for authentication type: ${auth.type}` }
        }

        let r = authType.validate(auth)

        if (r.state !== 'success') {
            return r
        } else {
            cleanRecord.auth = r.cleanRecord
        }
    }
    /* ====== End: Validate authentication ====== */

    if (details.functions) {
        /* ===== Start: Validate functions list ===== */
        let functions = details.functions

        if (!Array.isArray(functions)) {
            return {state: 'requestError', reason: `Functions not specified as an array.`}
        }

        let incorrectFormat = []
        for (let f in details.functions) {
            if (typeof f !== 'string' || !f.match(functionRegex)) {
                incorrectFormat.push(f)
            }
        }

        if (incorrectFormat.length > 0) {
            return {state: 'requestError', reason: `Incorrectly formatted function names (should match regex ${functionRegex}): ${incorrectFormat.join(', ')}`}
        }

        if (options.validFunctions) {
            
            let invalidFunctions = []

            for(let f in details.functions) {
                if (!options.validFunctions.includes(f)) {
                    invalidFunctions.push(f)
                }
            }

            if (invalidFunctions.length > 0) {
                return {state: 'requestError', reason: `Invalid functions named: ${invalidFunctions.join(', ')}`}
            }
        }
        cleanRecord.functions = details.functions
        /* ====== End: Validate functions list ====== */
    }

    return {state: 'success', pass: true, cleanRecord: cleanRecord, authType: authType }
}

/**
 * Adds a new identity to the authentication system.
 * 
 * The Following details should be provided:
 *  - name: The name of the identity, this is currently the primary key for identityRecords.
 *  - auth: Authentication details. This should be an object with a field called 'type'
 *      indicating which authentication method to use, along with any details required
 *      to authenticate using that method.
 *  - functions: An array of function names that the user should have access to.
 *      This can be omitted to create an identity with no rights.
 *          
 * 
 * @param {object} details - Details of the identity to add.
 */
async function addIdentity(details){

    let r = await validateIdentitySpec(details, { newIdentity: true })

    if (r.pass) {

        let record = r.cleanRecord
        record.id = uuidv4()

        try {
            r = r.authType.commit(record.auth)
            if (r.state !== 'success') {
                return r
            }
            delete record.auth

            let authRecord = r.commitRecord

            authRecord.id = uuidv4()

            authenticationRecords.insertOne(authRecord)

            record.authId = authRecord.id

        } catch (e) {
            console.log(`Error occured while committing authentication details:`)
            console.log(e)
            return { state: 'serverAuthCommitFailed', reason: 'An exception occured while commiting authentication details.' }
        }

        if (!record.functions) {
            record.functions = []
        }

        identityRecords.insertOne(record)
        return { state: 'success', identity: record }
    } else {
        return r
    }
}

/**
 * Updates an existing identity with the given details.
 * 
 * The Following details should be provided:
 *  - name: The name of the identity, this is currently the primary key for identityRecords.
 *  - auth: Authentication details. This should be an object with a field called 'type'
 *      indicating which authentication method to use, along with any details required
 *      to authenticate using that method.
 *  - functions: An array of function names that the user should have access to.
 *      This can be omitted to create an identity with no rights.
 * 
 * @param {object} details - Updated details for the identity
 */
async function setIdentity(identityId, details, options) {

    if (!options) {
        options = {}
    }

    // Step 0, validate:
    let r = await validateIdentitySpec(details)

    if (!r.pass) {
        return r
    }

    // Step 1, prepare update:
    var record = r.cleanRecord

    let identity = await identityRecords.findOne({ id: identityId })
    let newIdentity = Object.assign({}, identity)

    let newAuth = null

    let identityFields = Object.keys(identity)
    console.log(identityFields)
    let updateFields = Object.keys(record)
    console.log(updateFields)

    // Step 2, attempt to apply all new settigns:
    for (var ufi in updateFields) {
        let fieldName = updateFields[ufi]
        switch(fieldName) {
            case 'auth': {
                let authType = authTypes[record.auth.type]
                let r = authType.commit(record.auth)

                if (r.state !== 'success') {
                    return { state: 'serverAuthCommitFailed', reason: 'Failed to commit the new authentication details.' }
                }

                newAuth = r.commitRecord
                newAuth.id = uuidv4()
                newIdentity.authId = newAuth.id
                break
            }

            case 'functions': {
                if (options.allowSecurityEdit) {
                    newIdentity[fieldName] = r.cleanRecord[fieldName]
                }
            }

            default: {
                if (identityFields.includes(fieldName)) {
                    newIdentity[fieldName] = r.cleanRecord[fieldName]
                }
            }

            // Do not allow changing the ID fields.
            case 'id':  { break }
            case '_id':  { break }
        }
    }

    // Step 3, Commit changes:
    if (newAuth) {
        r = await authenticationRecords.replaceOne({id: identity.authId}, newAuth)
        console.log(newAuth)
    }

    r = await identityRecords.replaceOne({ id: identity.id}, newIdentity)
    console.log(newIdentity)

    return { state: 'success', identity: newIdentity }
}

/**
 * Removes an identity from the authentication store.
 * 
 * @param {object} identitiyId - Id of the identity to remove.
 */
async function removeIdentity(identityId){

    let r = await validateIdentitySpec({id: identityId})

    if (!r.pass) {
        return r
    }

    let identity = await identityRecords.findOne({id: identityId})
    let authId = identity.authId

    await authenticationRecords.removeOne({ id: authId })
    await identityRecords.removeOne({id: identity.id})
    
    return { state: 'success' }
}

/**
 * Attempts to validate a set of authentication details and returns an object
 * a new token.
 * 
 * @param {object} details - Authentication details that should be validated.
 */
async function authenticate(details) {

    let r = await validateIdentitySpec(details)

    if (!r.pass) {
        return r
    }

    let identity = await identityRecords.findOne({ name: details.name })
    let auth = await authenticationRecords.findOne( { id: identity.authId })

    if (!auth) {
        return { state: 'serverMissingAuthRecord', reason: 'Authentication record missing.'}
    }

    let authType = authTypes[auth.type]

    r = authType.authenticate(auth, details)
    
    if (r.state !== 'success') {
        return r
    }

    var t = newToken(identity)
    r.token = t

    return r
}

/* ====== Export definitions: ===== */

module.exports.addIdentity = addIdentity
module.exports.setIdentity = setIdentity
module.exports.removeIdentity = removeIdentity
module.exports.validateIdentitySpec = validateIdentitySpec
module.exports.verifyToken = verifyToken

/**
 * Used to set up authentication endpoints.
 * 
 * Endpoints:
 *  - ${path}: Used to authenticate
 *  - ${path}/clientToken
 * @param {string} path - Base path to set up the authentication endpoints under.
 * @param {object} app - Express application to set up the authentication endpoints on.
 * @param {object} settings - Configuration settings.
 * @param {object} databse  - MongoDB database.
 */
module.exports.setup = async (path, app, settings, database) => {
    
    authTypes = require('./providers').setup(app, path, `${__dirname}/authProviders`, { log: (msg) => { console.log(msg) } })

    identityRecords = database.collection('identities')
    authenticationRecords = database.collection('authentication')

    let identities = await identityRecords.find().toArray()
    let authentications = await await authenticationRecords.find().toArray()

    console.log(`Registered identities: ${identities.length}`)
    console.log(`Registered authentications: ${authentications.length}`)

    if (identities.length === 0) {
        console.log(`No users in DB, adding 'admin' user...`)
        let adminUser = await addIdentity({
            name: 'admin',
            auth: {
                type: 'password',
                password: 'Pa55w.rd'
            },
            functions: accessRights.map((ar) => { console.log(ar); return ar.name })
        })
        console.log(adminUser)
        console.log(`'admin' added with ID '${adminUser.id}'`)
    }

    
    /**
     * Helper function used by endpoints to ensure that the caller is authenticated and has access to the given function.
     * @param {object} req Request object
     * @param {object} res Response object
     * @param {string} functionName Name of the function to test for.
     */
    function allowAccess(req, res, functionName) {


        if (req.authenticated && req.authenticated.functions.includes(functionName)) {
            return true
        }

        res.status(403)
        res.end()
        return false
    }

    /**
     * Authentication endpoint.
     */
    app.post(path, async (req, res) => {
        
        var r = await authenticate(req.body)

        if (r.token) {
            res.status(200)
            res.send(JSON.stringify(r))
        } else {
            switch (r.state) {
                case 'requestError': {
                    res.status(400)
                    break
                }
    
                case 'serverError': {
                    res.status(500)
                    break
                }
    
                case 'failed': {
                    res.status(403)
                    break
                }
                default: {
                    res.status(500)
                }
            }
            res.send(JSON.stringify(r))
        }
    })

    /**
     * Middleware to protect identity functions.
     */
    app.use(`${path}/identity`, (req, res, next) => {

        if (!req.authenticated) {
            res.status(403)
            res.end()
            return
        }

        next()
    })

    /**
     * Add identity endpoint.
     */
    app.post(`${path}/identity`, async (req, res) => {
        
        if (!allowAccess(req, res, access.identity.create.fullname)) { return }

        if (!req.body) {
            res.status(400)
            res.end(JSON.stringify({status: 'requestError', reason: 'No user details provided.'}))
            return
        }

        let details = req.body

        let r = await addIdentity(details)

        if (r.state === 'success') {
            res.status(201)
            res.send(JSON.stringify(r))
            return
        }

        if (r.state.match(/^request/)) {
            res.status(400)
        } else {
            res.status(500)
        }
        
        res.send(JSON.stringify(r))
    })

    /**
     * Get identityRecords endpoint
     */
    app.get(`${path}/identity`, (req, res) => {
        if (!allowAccess(req, res, access.identity.get.all.fullname)) { return }

        identityRecords.find().toArray().then(o => {
            res.status(200)
            res.send(JSON.stringify({state: 'success', identities: o}))
        }).catch(e => {
            console.log(e)
            res.status(500)
            res.send(JSON.stringify({state: 'serverError', reason: 'Failed to retrieve identity records.'}))
        })
    })

    /**
     * Get my identityRecord endpoint
     */
    app.get(`${path}/identity/me`, (req, res) => {
        identityRecords.find({id: req.authenticated.id}).toArray().then(o => {
            if (o.length === 0) {
                res.status(404)
                res.send(JSON.stringify({state: 'requestError', reason: 'No such identity.'}))
                return
            }

            res.status(200)
            res.send(JSON.stringify({state: 'success', identity: o[0]}))
        }).catch(e => {
            console.log(e)
            res.status(500)
            res.send(JSON.stringify({state: 'serverError', reason: 'Failed to retrieve identity records.'}))
        })
    })

    /**
     * Get specific identityRecord endpoint
     */
    app.get(`${path}/identity/:identityId`, (req, res) => {
        if (!allowAccess(req, res, access.identity.get.all.fullname)) { return }

        identityRecords.find({ id: req.params.identityId }).toArray().then(o => {
            console.log(o)
            if (o.length === 0) {
                res.status(404)
                res.send(JSON.stringify({state: 'requestError', reason: 'No such identity.'}))
                return
            }

            res.status(200)
            res.send(JSON.stringify({state: 'success', identity: o[0]}))
        }).catch(e => {
            console.log(e)
            res.status(500)
            res.send(JSON.stringify({state: 'serverError', reason: 'Failed to retrieve identity records.'}))
        })
    })

    /**
     * Update identity endpoint.
     */
    app.patch(`${path}/identity/me`, async (req, res) => {

        if (!req.body) {
            res.status(400)
            res.send(JSON.stringify({status: 'requestError', reason: 'No user details provided.'}))
            return
        }

        let r = await setIdentity(req.authenticated.id, req.body)

        if (r.state === 'success') {
            res.status(200)
            res.send(JSON.stringify(r))
            return
        }

        if (r.state.match(/^request/)) {
            res.status(400)
        } else {
            res.status(500)
        }
        
        res.send(JSON.stringify(r))
    })

    /**
     * Update identity endpoint.
     */
    app.patch(`${path}/identity/:identityId`, async (req, res) => {
        if (!allowAccess(req, res, access.identity.update.all.fullname)) { return }

        if (!req.body) {
            res.status(400)
            res.send(JSON.stringify({status: 'requestError', reason: 'No user details provided.'}))
            return
        }

        let r = await setIdentity(req.params.identityId, req.body, { allowSecurityEdit: true })

        if (r.state === 'success') {
            res.status(200)
            res.send(JSON.stringify(r))
            return
        }

        if (r.state.match(/^request/)) {
            res.status(400)
        } else {
            res.status(500)
        }
        
        res.send(JSON.stringify(r))
    })

    /**
     * Remove identity endpoint
     */
    app.delete(`${path}/identity/:identityId`, async (req, res) => {
        if (!allowAccess(req, res, access.identity.delete.all.fullname)) { return }

        let r = await removeIdentity(req.params.identityId)

        if (r.state === 'success') {
            res.status(200)
        } else {
            res.status(400)
        }

        res.send(JSON.stringify(r))
    })
}

// Middleware to verify the authorization header.
// Adds req.authenticated with user details if authorization is validated.
module.exports.mw_verify = async (req, res, next) => {
    var auth = req.headers.authorization

    if (auth) {
        var m = auth.match(/^(?<type>bearer) (?<token>.+)/)
        
        if (m) {
            var p = verifyToken(m.groups.token)
            
            if (p) {
                req.authenticated = p
            }
        }
    }
    
    next()

}