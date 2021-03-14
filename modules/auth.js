//auth.js

"use strict"

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
const authTypes = {
    password: require('./authProviders/password/module')
}

// Temporary list of users, this should be moved into a DB.
var identityRecords = [
    {
        id: '59370df8-0a9a-4c01-b711-a8190e963bd4',
        name: 'admin',
        authId: 'c00df22f-03bf-4200-bed7-cbaff8148e89',
        functions: ['auth.identity', 'api']
    }
]

// Temporary list of authentication details, this should be moved into a DB.
var authenticationRecords = [
    {
        id:'c00df22f-03bf-4200-bed7-cbaff8148e89',
        type: 'password',
        //password: 'Pa$$w0rd',
        salt: 'fcbca933-7021-432b-836d-c1142b1f310d',
        hash: '5a59750c5ae9eec93736464df0aabc3ff21c576078cd6fa378f0067589a715997e188a06ce98e2e4c4d01749d754b281032910e261dce397bf6b574cbc2b5345'
    }
]

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
function validateIdentitySpec(details, options) {

    const nameRegex     = /[A-z0-9_\-.]+/
    const functionRegex = /[A-z0-9_\-.]+/

    var cleanRecord = {}
    var authType = null

    if (!options) {
        options = {}
    }

    /* ===== Start: Validate name ===== */
    if (!details.name) {
        return {state: 'requestError', reason: 'No user specified.'}
    }

    if (!details.name || !details.name.match(nameRegex)) {
        return {state: 'requestError', reason: `Invalid name format (should match regex ${nameRegex}).`}
    }

    let i = identityRecords.findIndex((o) => o.name == details.name )

    if (options.newIdentity) {
        if (i != -1) {
            return {state: 'requestError', reason: 'Identity name already in use.'}
        }
    } else {
        if (i == -1) {
            return {state: 'requestError', reason: 'No such user.'}
        }
    }
    cleanRecord.name = details.name
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

    if (!cleanRecord.functions) {
        cleanRecord.functions = []
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
function addIdentity(details){

    let r = validateIdentitySpec(details, { newIdentity: true })

    if (r.pass) {

        let record = r.cleanRecord
        record.id = uuidv4()

        try {
            r = r.authType.commit(record.auth)
            if (r.state !== 'success') {
                return r
            }

            r.commitRecord.id = uuidv4()

            authenticationRecords.push(r.commitRecord)

            record.authId = r.commitRecord.id
        } catch (e) {
            console.log(`Error occured while committing authentication details:`)
            console.log(e)
            return { state: 'serverAuthCommitFailed', reason: 'An exception occured while commiting authentication details.' }
        }

        identityRecords.push(record)
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
function setIdentity(details) {

    // Step 0, validate:
    let r = validateIdentitySpec(details)

    if (!r.pass) {
        return r
    }

    // Step 1, prepare update:
    var record = r.cleanRecord

    let i = identityRecords.findIndex((o) => o.name == details.name )
    let identity = identityRecords[i]
    let newIdentity = Object.assign({}, identity)

    let newAuth = null

    let identityFields = Object.keys(identity)
    let updateFields = Object.keys(record)

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

            default: {
                if (identityFields.includes(fieldName)) {
                    newIdentity[fieldName] = r.cleanRecord[fieldName]
                }
            }
        }
    }

    // Step 3, Commit changes:
    if (newAuth) {
        let i = authenticationRecords.findIndex((o) => o.id === identity.authId)
        authenticationRecords.splice(i, 1, newAuth)
    }

    i = identityRecords.findIndex((o => o.name === identity.name))
    identityRecords.splice(i, 1, newIdentity)

    return { state: 'success', identity: newIdentity }
}

/**
 * Returns all of the identityRecords in the authentication store.
 */
function getidentityRecords() {
    return JSON.stringify(identityRecords)
}

/**
 * Removes an identity from the authentication store.
 * 
 * @param {object} name - Name of the identity to remove.
 */
function removeIdentity(name){

    let r = validateIdentitySpec({name: name})

    if (!r.pass) {
        return r
    }

    let identityI = identityRecords.findIndex((o) => o.name == name )
    let authId = identityRecords[identityI].authId
    let authI  = authenticationRecords.findIndex((o) => o.id === authId)

    authenticationRecords.splice(authI, 1)
    identityRecords.splice(identityI, 1)
    
    return { state: 'success' }
}

/**
 * Attempts to validate a set of authentication details and returns an object
 * a new token.
 * 
 * @param {object} details - Authentication details that should be validated.
 */
function authenticate(details) {

    let r = validateIdentitySpec(details)

    if (!r.pass) {
        return r
    }

    var i = identityRecords.findIndex((o) =>
        details.name == o.name
    )
 
    let identity = identityRecords[i]
    let auth = authenticationRecords.find(o => o.id === identity.authId)

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
 */
module.exports.setup = (path, app) => {
    
    /**
     * Authentication endpoint.
     */
    app.post(path, (req, res) => {
        
        var r = authenticate(req.body)
    
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
            }
            res.send(JSON.stringify(r))
        }
    })

    /**
     * Middleware to protect identity admin functions.
     */
    app.use(`${path}/identity`, (req, res, next) => {

        if (!req.authenticated) {
            res.status(403)
            res.end()
            return
        }

        let fs = req.authenticated.functions

        if (!fs || !fs.includes('auth.identity')) {
            res.status(403)
            res.end()
            return
        }

        next()
    })

    /**
     * Add identity endpoint.
     */
    app.post(`${path}/identity`, (req, res) => {
        
        if (!req.body) {
            res.status(400)
            res.end(JSON.stringify({status: 'requestError', reason: 'No user details provided.'}))
            return
        }

        let details = req.body

        let r = addIdentity(details)

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
        res.status(200)
        res.send(getidentityRecords())
    })

    /**
     * Update identity endpoint.
     */
    app.patch(`${path}/identity`, (req, res) => {
        if (!req.body) {
            res.status(400)
            res.send(JSON.stringify({status: 'requestError', reason: 'No user details provided.'}))
            return
        }

        let r = setIdentity(req.body) 

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
    app.delete(`${path}/identity/:identityId`, (req, res) => {
        let r = removeIdentity(req.params.identityId)

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
module.exports.mw_verify = (req, res, next) => {
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