//auth.js

"use strict"

const { DateTime } = require('luxon')
const jwt = require('jsonwebtoken')

const secret = Math.random().toString(16)

// Temporary hard-coded list of supported authentication types.
const authTypes = {
    password: {
        authenticate: (identity, details) => {
            if (!details.password) {
                return {state:'requestError', reason: 'No password provided.'}
            }

            if (identity.auth.password !== details.password) {
                return {state:'failed', reason: 'Invalid username/password.'}
            }

            var t = newToken(identity)
            return {state: 'success', token: t}
        },
        validate: (details) => {
            const passwordRegex = /[A-z0-9_\-.]{8,}/

            if (!details.password) {
                return {state: 'requestError', reason: `No password specified.`}
            }

            if (!details.password.match(passwordRegex)) {
                return {state: 'failed', reason: `Invalid password format (should match regex ${passwordRegex}).`}
            }

            let cleanRecord = {
                type: 'password',
                password: details.password
            }

            return {state: 'success', pass: true, cleanRecord: cleanRecord}
        }
    }
}

// Temporary list of users, this should be moved into a DB and the password should be stored as a salted hash.
var identities = [
    {name: 'admin', auth: { type: 'password', password: 'Pa$$w0rd' }, functions: ['chat', 'clients']}
]

/*
identity: The user to generate a token for.
options: An object defining options for the token. Currently only 'duration' is supported and should be luxon duration.
*/
/**
 * Used to generate a token for the provided identity.
 * 
 * Options:
 *  - duration: A luxon duration to to define how long the token should be valid.
 * 
 * @param {object} identity - Identity details.
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
 * used as the primary key for identities.
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

    let i = identities.findIndex((o) => o.name == details.name )

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

        let authType = authTypes[auth.type]

        if (!authType) {
            return { state: 'serverConfigurationError', reason: `Invalid authentication type specified for user: ${auth.type}` }
        }

        if (!authType.validate) {
            return { state: 'serverConfigurationError', reason: `No validation function specified for authentication type: ${auth.type}` }
        }

        let r = authType.validate(auth)

        if (!r.pass) {
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

    return {state: 'success', pass: true, cleanRecord: cleanRecord }
}

/**
 * Adds a new identity to the authentication system.
 * 
 * The Following details should be provided:
 *  - name: The name of the identity, this is currently the primary key for identities.
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
        identities.push(r.cleanRecord)
        return { state: 'success', identity: r.cleanRecord }
    } else {
        return r
    }
}

function setIdentity(details) {
    
    let r = validateIdentitySpec(details)

    if (!r.pass) {
        return r
    }

    let i = identities.findIndex((o) => o.name == name )
    let identity = identities[i]

    let identityFields = Object.keys(identity)
    let updateFields = Object.keys(r.cleanRecord)

    for (var uf in updateFields) {
        if (identityFields.includes(uf)) {
            identity[uf] = r.cleanRecord[uf]
        }
    }

    return { state: 'success', identity: identity }
}

function removeIdentity(name){

    let r = validateIdentitySpec({name: name})

    if (!r.pass) {
        return r
    }

    let i = identities.findIndex((o) => o.name == name )

    identities.splice(i, 1)
    return { state: 'success' }
}

function authenticate(details) {

    let r = validateIdentitySpec(details)

    if (!r.pass) {
        return r
    }

    var i = identities.findIndex((o) =>
        details.name == o.name
    )
 
    let identity = identities[i]
    
    let authType = authTypes[identity.auth.type]

    return authType.authenticate(identity, details)
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
    app.post(path, (req, res) => {
        
        var r = authenticate(req.body)
    
        if (r.token) {
            res.status(200)
            res.send(JSON.stringify(r))
        } else {
            switch (r.state) {
                case 'requestError': {
                    res.status = 400
                    break
                }
    
                case 'serverError': {
                    res.status = 500
                    break
                }
    
                case 'failed': {
                    res.status = 403
                    break
                }
            }
            res.send(JSON.stringify(r))
        }
    })

    app.post(`${path}/clients`, (req, res) => {

        if (!req.authenticated) {
            res.status = 401
            res.end()
            return
        }
    
        let auth = req.authenticated
    
        if (!auth.functions || !auth.functions.includes('controller')) {
            res.status = 403
            res.end()
            return
        }
    
        let b = req.body
        if (!b || !b.name) {
            res.status = 400
            res.end()
            return
        }
    
        let i = identities.findIndex((o) => o.name == b.name)
        if (i == -1) {
            res.status = 400
            res.end()
            return
        }
    
        let ident = identities[i]

        let t = newToken(ident, { duration: {days: 7} })
        res.status = 200
        res.send(
            JSON.stringify({
                token: t
            })
        )
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