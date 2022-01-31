const jwt = require('jsonwebtoken')
const {v4: uuidv4} = require('uuid')
const Crypto = require('crypto')
const { DateTime, Duration } = require('luxon')

/**
 * Class to facilitate the creation and verification JSON Web Tokens.
 */
class TokenGenerator {

    keyLength = 1024
    algorithm = 'ES256'

    tokenLifetime = null

    /**
     * ID of this generator. This value will be included as the issuer of any tokens generated.
     */
    id = null
    /**
     * The current public key used when generating tokens.
     */
    publicKey = null
    /**
     * The current private key used when generating tokens.
     */
    privateKey = null
    /**
     * Interval object used to continuously update key pair.
     */
    keyUpdateInterval = null
    /**
     * MongoDB collection used to store token verification records.
     */
    tokenCollection = null

    /**
     * Create a new token generator.
     * 
     * options:
     *  - id: Manually assigned id for this generator. If not specified, a UUID will be generated.
     *  - collection: MongoDB collection to record tokens in. If this is not provided then records must be stored and retrieved manualy.'
     *  - keyLifetime: How often the keys should be regenerated (luxon duration object). Setting this to 0 or less will cause the keys to be regenerated after each new token.
     *  - tokenLifetime: How long the tokens should remain valid by default (luxon duration object).
     * @param {object} options - Additional options to customize the generator.
     */
    constructor(options) {
        this.id = uuidv4()

        this.tokenLifetime = Duration.fromObject({ minutes: 30  })
        let keyLifetime = Duration.fromObject({minutes: 60})
        
        if (options) {
            if (options.id) {
                this.id = options.id
            }
            if (options.collection) {
                this.tokenCollection = options.collection
            }
            if (options.keyLifetime !== undefined) {
                if (options.keyLifetime.isLuxonDuration) {
                    keyLifetime = new Duration(options.keyLifetime)
                } else {
                    keyLifetime = Duration.fromObject(options.keyLifetime)
                }
            }
            if (options.tokenLifetime) {
                if (options.tokenLifetime.isLuxonDuration) {
                    this.tokenLifetime = new Duration(options.tokenLifetime)
                } else {
                    this.tokenLifetime = Duration.fromObject(options.tokenLifetime)
                }
            }
        }
        
        this.generateKeys()
        if (keyLifetime.toMillis() > 0) {
            this.keyUpdateInterval = setInterval(() => this.generateKeys(), keyLifetime.toMillis())
        }
    }

    /**
     * Regenerates the DSA key pair used to generate tokens.
     */
    generateKeys() {
        let keyPair = Crypto.generateKeyPairSync('dsa', { modulusLength: this.keyLength })
        this.publicKey = keyPair.publicKey.export({ type: 'spki', format: 'pem' })
        this.privateKey = keyPair.privateKey.export({ type: 'pkcs8', format:'pem' })
    }

    /**
     * Used to generate a token for the provided subject.
     * 
     * Options:
     *  - duration: A luxon duration to to define how long the token should be valid.
     *              This can be used to override the default set when the instance is created, but should otherwise not be used.
     *  - context: An object or primitive to provide additional information on the subject.
     * 
     * @param {object} subject - Subject authenticated by this token.
     * @param {object} options - Additional options.
     * @returns {object} Object containing 2 properties: "record" and "token".
     *  - record: An object containing information necessary to verify the validity of the token, and should be stored by the server.
     *      - If the generator has been set up with a MongoDB collection, then the record will automatically be stored there.
     *  - token: A string representation of the token, this should be passed to the client. 
     */
    async newToken(subject, options) {

        let now = DateTime.now()

        let duration = this.tokenLifetime

        
        var payload = {
            sub: subject,
            iss: this.id
        }

        if (options) {
            if (options.tokenLifetime) {
                if (options.tokenLifetime.isLuxonDuration) {
                    duration = new Duration(options.tokenLifetime)
                } else {
                    duration = Duration.fromObject(options.tokenLifetime)
                }
            }
            if(options.context) {
                payload.context = options.context
            }
        }

        let validTo = now.plus(duration)

        var tokenRecord = {
            id: uuidv4(),
            subject: subject,
            issuer: this.id,
            key: this.publicKey,
            issued: now,
            expires: validTo
        }

        var token = jwt.sign(payload, this.privateKey, {algorithm: this.algorithm, expiresIn: `${duration.as('hour')}h`, keyid: tokenRecord.id})

        if (this.tokenCollection) {
            var currentTokenRecord = await this.tokenCollection.findOne({subject: subject})

            if (currentTokenRecord) {
                this.tokenCollection.replaceOne({id: currentTokenRecord.id}, tokenRecord)
            } else {
                this.tokenCollection.insertOne(tokenRecord)
            }
        }
        
        if (!this.keyUpdateInterval) {
            this.generateKeys()
        }

        return { record: tokenRecord, token: token }
    }

    /**
     * Attempts to validate the provided token.
     * 
     * Returns an object with the subject of the token if successful.
     * 
     * Otherwise returns an object with an error status and reason.
     * 
     * Options:
     *  - tokenLifetime: How long the token should remain valid (luxon duration object). Overrides the default lifetime.
     *  - record: A token record object used to verify the token. Used to debug the generator without a mongodb collection.
     * 
     * @param {string} token - Token to validate.
     * @param {object} options - Additional options.
     * @returns {object} An object describing the state of the verification, it may contain the following fields:
     *  - success: A boolean describing whether the token was successfully verified.
     *  - subject: If the token was verified successfully, this field will indicate the identity of the client.
     *  - context: If the token was verified successfully and contained a 'context' property it will added here.
     *  - status: If the verification failed, this short string indicates what caused the failure.
     *  - reason: If the verification failed, this property may be included to provide a more user-friendly description of what caused the verification to fail.
     */
    async verifyToken(token, options) {
        try {
            let {header, payload} = jwt.decode(token, {complete: true})
            let tokenRecord = null

            if (options && options.record) {
                tokenRecord = options.record
            } else if (this.tokenCollection) {
                tokenRecord = await this.tokenCollection.findOne({id: header.kid})
            } else {
                return { success: false, status: 'noRecordError', reason: 'No record source available.' }
            }

            if (!tokenRecord) {
                return { success: false, status: 'noRecordError', reason: 'No record found for the token.' }
            }

            if (!(tokenRecord.key && tokenRecord.issuer && tokenRecord.subject)) {
                return { success: false, status: 'invalidRecordError', reason: 'Token record is incomplete.' }
            }

            jwt.verify(token, tokenRecord.key, {issuer: tokenRecord.issuer, subject: tokenRecord.subject})

            let r = { success: true, subject: tokenRecord.subject }

            if (payload.context) {
                r.context = payload.context
            }

            return r

        } catch {
            return { success: false, status: 'invalidTokenError', reason: 'Token does not match key on record or is expired.' }
        }
    }

    async dispose() {
        clearInterval(this.keyUpdateInterval)
    }

}

module.exports = TokenGenerator