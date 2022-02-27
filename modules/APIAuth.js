const express = require('express')

//APIAuth.js
"use strict"

const {v4: uuidv4} = require('uuid')
const TokenGenerator = require('@adicitus/jwtgenerator')

/**
 * Class containing Authentication/Authorization functionality of Morrigan.
 */
class APIAuth {
    name=null
    functions=null
    
    #log = (msg) => { console.log(msg) }
    modulename = 'auth'
    access = {
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

    #accessRights = null


    /**
     * Each authentication type should have be defined by a
     * corresponding authentication provider.
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
     authTypes = null

     tokens = null
 
     #serverId = null
     #identityRecords = null
     #authenticationRecords = null
     #tokenRecords = null


    constructor() {
        this.name = this.modulename
        this.accessRights = this.buildAccessRightsList(this.modulename, this.access)
        this.functions = this.#accessRights
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
    buildAccessRightsList(prefix, scope) {

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
                let ars_r = this.buildAccessRightsList(fullname, scope[name])
                ars = ars.concat(ars_r)
            }
        }

        return ars
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
    async validateIdentitySpec(details, options) {

        const nameRegex     = /[A-z0-9_\-.]+/
        const functionRegex = /[A-z0-9_\-.]+/

        var cleanRecord = {}
        var authType = null

        if (!options) {
            options = {}
        }

        if (details === null || details === undefined) {
            return {state: 'requestError', reason: 'No user details provided.'}
        }

        /* ===== Start: Validate name ===== */
        if (options.newIdentity && !details.name) {
            return {state: 'requestError', reason: 'No user name specified.'}
        }

        if (details.name && !details.name.match(nameRegex)) {
            return {state: 'requestError', reason: `Invalid name format (should match regex ${nameRegex}).`}
        }

        if (details.name) {
            let i = await this.identityRecords.findOne({ name: details.name })

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

            authType = this.authTypes[auth.type]

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
     * Attempts to validate a set of authentication details and returns an object
     * a new token.
     * 
     * @param {object} details - Authentication details that should be validated.
     */
    async authenticate(details) {

        let r = await this.validateIdentitySpec(details)

        if (!r.pass) {
            return r
        }

        if (!r.cleanRecord.name) {
            return { state: 'requestError', reason: 'No username specified.' }
        }

        let identity = await this.identityRecords.findOne({ name: details.name })
        let auth = await this.authenticationRecords.findOne( { id: identity.authId })

        if (!auth) {
            return { state: 'serverMissingAuthRecord', reason: 'Authentication record missing.'}
        }

        let authType = this.authTypes[auth.type]

        r = authType.authenticate(auth, details)
        
        if (r.state !== 'success') {
            return r
        }

        var t = await this.tokens.newToken(identity.id)
        r.token = t.token

        return r
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
    async addIdentity(details){

        let r = await this.validateIdentitySpec(details, { newIdentity: true })

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

                this.authenticationRecords.insertOne(authRecord)

                record.authId = authRecord.id

            } catch (e) {
                this.log(`Error occured while committing authentication details:`)
                this.log(JSON.stringify(e))
                return { state: 'serverAuthCommitFailed', reason: 'An exception occured while commiting authentication details.' }
            }

            if (!record.functions) {
                record.functions = []
            }

            this.identityRecords.insertOne(record)
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
    async setIdentity(identityId, details, options) {

        if (!options) {
            options = {}
        }

        // Step 0, validate:
        let r = await this.validateIdentitySpec(details)

        if (!r.pass) {
            return r
        }

        // Step 1, prepare update:
        var record = r.cleanRecord

        let identity = await this.identityRecords.findOne({ id: identityId })
        let newIdentity = Object.assign({}, identity)

        let newAuth = null

        let identityFields = Object.keys(identity)
        let updateFields = Object.keys(record)

        // Step 2, attempt to apply all new settigns:
        for (var ufi in updateFields) {
            let fieldName = updateFields[ufi]
            switch(fieldName) {
                case 'auth': {
                    let authType = this.authTypes[record.auth.type]
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
            this.log(`Replacing authenication record ('${identity.authId}' -> '${newAuth.id}')...`)
            r = await this.authenticationRecords.replaceOne({id: identity.authId}, newAuth)
        }

        this.log(`Updating identity record '${newIdentity.id}'...`)
        r = await this.identityRecords.replaceOne({ id: identity.id}, newIdentity)

        return { state: 'success', identity: newIdentity }
    }

    /**
     * Removes an identity from the authentication store.
     * 
     * @param {string} identityId - Id of the identity to remove.
     */
    async removeIdentity(identityId){

        let r = await this.validateIdentitySpec({id: identityId})

        if (!r.pass) {
            return r
        }

        let identity = await this.identityRecords.findOne({id: identityId})
        let authId = identity.authId

        await this.authenticationRecords.removeOne({ id: authId })
        await this.identityRecords.removeOne({id: identity.id})
        
        return { state: 'success' }
    }

    /**
     * Used to set up authentication endpoints.
     * 
     * @param {object} router - The express router to install endpoints on.
     * @param {object} serverEnv - Server environment, expected to contain:
     *  + db: The database used by the server.
     *  + settings: The server settings object.
     *  + log: The log function to use.
     */
    async setup(router, serverEnv) {
        
        this.serverid = serverEnv.info.id

        let settings = serverEnv.settings

        this.log = serverEnv.log

        this.authTypes = await require('@adicitus/morrigan.utils.providers').setup(router, settings.auth.providers, { 'log': this.log })

        this.identityRecords = serverEnv.db.collection('morrigan.identities')
        this.tokenRecords = serverEnv.db.collection('morrigan.identities.tokens')
        this.authenticationRecords = serverEnv.db.collection('morrigan.authentication')

        this.tokens = new TokenGenerator({id: this.serverid, collection: this.tokenRecords, keyLifetime: { hours: 4 }})

        let identities = await this.identityRecords.find().toArray()
        let authentications = await await this.authenticationRecords.find().toArray()

        this.log(`Registered identities: ${identities.length}`)
        this.log(`Registered authentications: ${authentications.length}`)

        if (identities.length === 0) {
            this.log(`No users in DB, adding 'admin' user...`)
            let adminUser = await this.addIdentity({
                name: 'admin',
                auth: {
                    type: 'password',
                    password: 'Pa55w.rd'
                },
                functions: accessRights.map((ar) => { return ar.name })
            })
            
            if (adminUser.state === 'success') {
                this.log(`'admin' added with ID '${adminUser.identity.id}'`)
            } else {
                this.log(`Failed to add user 'admin':`)
                this.log(JSON.stringify(adminUser))
            }
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
        router.post('/', async (req, res) => {
            
            var r = await this.authenticate(req.body)

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
        router.use(`/identity`, (req, res, next) => {

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
        router.post(`/identity`, async (req, res) => {
            
            if (!allowAccess(req, res, this.access.identity.create.fullname)) { return }

            if (!req.body) {
                res.status(400)
                res.end(JSON.stringify({status: 'requestError', reason: 'No user details provided.'}))
                return
            }

            let details = req.body

            let r = await this.addIdentity(details)

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
        router.get(`/identity`, (req, res) => {
            if (!allowAccess(req, res, this.access.identity.get.all.fullname)) { return }

            this.identityRecords.find().toArray().then(o => {
                res.status(200)
                res.send(JSON.stringify({state: 'success', identities: o}))
            }).catch(e => {
                this.log(JSON.stringify(e))
                res.status(500)
                res.send(JSON.stringify({state: 'serverError', reason: 'Failed to retrieve identity records.'}))
            })
        })

        /**
         * Get my identityRecord endpoint
         */
        router.get(`/identity/me`, (req, res) => {
            this.identityRecords.find({id: req.authenticated.id}).toArray().then(o => {
                if (o.length === 0) {
                    res.status(404)
                    res.send(JSON.stringify({state: 'requestError', reason: 'No such identity.'}))
                    return
                }

                res.status(200)
                res.send(JSON.stringify({state: 'success', identity: o[0]}))
            }).catch(e => {
                this.log(JSON.stringify(e))
                res.status(500)
                res.send(JSON.stringify({state: 'serverError', reason: 'Failed to retrieve identity records.'}))
            })
        })

        /**
         * Get specific identityRecord endpoint
         */
        router.get(`/identity/:identityId`, (req, res) => {
            if (!allowAccess(req, res, this.access.identity.get.all.fullname)) { return }

            this.identityRecords.find({ id: req.params.identityId }).toArray().then(o => {
                if (o.length === 0) {
                    res.status(404)
                    res.send(JSON.stringify({state: 'requestError', reason: 'No such identity.'}))
                    return
                }

                res.status(200)
                res.send(JSON.stringify({state: 'success', identity: o[0]}))
            }).catch(e => {
                this.log(JSON.stringify(e))
                res.status(500)
                res.send(JSON.stringify({state: 'serverError', reason: 'Failed to retrieve identity records.'}))
            })
        })

        /**
         * Update identity endpoint.
         */
        router.patch(`/identity/me`, async (req, res) => {

            if (!req.body) {
                res.status(400)
                res.send(JSON.stringify({status: 'requestError', reason: 'No user details provided.'}))
                return
            }

            if (req.body.functions) {
                res.status(403)
                res.send(JSON.stringify({status: 'requestError', reason: 'Access to functions cannot be modified via the "me" endpoint.'}))
                return
            }

            let r = await this.setIdentity(req.authenticated.id, req.body)

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
        router.patch(`/identity/:identityId`, async (req, res) => {
            if (!allowAccess(req, res, this.access.identity.update.all.fullname)) { return }

            if (!req.body) {
                res.status(400)
                res.send(JSON.stringify({status: 'requestError', reason: 'No user details provided.'}))
                return
            }

            let r = await this.setIdentity(req.params.identityId, req.body, { allowSecurityEdit: true })

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
        router.delete(`/identity/:identityId`, async (req, res) => {
            if (!allowAccess(req, res, this.access.identity.delete.all.fullname)) { return }

            let r = await this.removeIdentity(req.params.identityId)

            if (r.state === 'success') {
                res.status(200)
            } else {
                res.status(400)
            }

            res.send(JSON.stringify(r))
        })
    }

    /**
     * Hook to be triggered when the systems shuts down.
     */
    async onShutdown() {
        this.tokens.dispose()
    }

    /**
     * Returns a middleware function that can be used to verify the authentication status of incoming requests.
     * 
     * The middleware will attempt to validate the token in the "Authorization" header, and sets req.authenticated
     * with user details if authorization is validated.
     * 
     * @returns The verification middleware.
     */
    getVerifyMW() {
        /**
         * Define self here to create a refernce to this object, which makes it available
         * in the returned closure (as 'this' will be different).
         */
        let self = this
        return async (req, res, next) => {
            var auth = req.headers.authorization
    
            if (auth) {
                var m = auth.match(/^(?<type>bearer) (?<token>.+)/)
                
                if (m) {
                    let r  = await self.tokens.verifyToken(m.groups.token)
                    if (r.success) {
                        var identity = await self.identityRecords.findOne({id: r.subject})
    
                        if (identity) {
                            req.authenticated = identity
                        }
                    }
                }
            }
            
            next()
        }
    }
}

module.exports = new APIAuth()