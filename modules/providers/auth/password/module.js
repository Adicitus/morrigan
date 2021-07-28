const crypto = require('crypto')
const {v4: uuidv4} = require('uuid')

const passwordRegex = /.{8,}/

function validateDetails (details, options) {
    if (!details.password) {
        return {state: 'requestError', reason: `No password specified.`}
    }

    if (options && options.newRecord) {
        if (!details.password.match(passwordRegex)) {
            return {state: 'requestError', reason: `Invalid password format (should match regex ${passwordRegex}).`}
        }
    }

    let cleanRecord = {
        type: 'password',
        password: details.password
    }

    return { state: 'success', cleanRecord: cleanRecord }
}

function hashPassword(password, salt) {
    if (!salt) {
        salt = uuidv4()
    }
    let hash = crypto.createHmac('sha512', salt)
    hash.update(password)
    return {
        hash: hash.digest('hex'),
        salt: salt
    }
}

module.exports = {
    authenticate: (target, offered) => {
        let r = validateDetails(offered)

        if (r.state !== 'success') {
            return r
        }

        let checkRecord = hashPassword(offered.password, target.salt)

        if (checkRecord.hash !== target.hash) {
            return {state:'failed', reason: 'Invalid username/password.'}
        }

        return { state: 'success' }
    },
    validate: (details) => {

        let r = validateDetails(details, { newRecord: true })

        if (r.state !== 'success') {
            return r
        }

        return {state: 'success', pass: true, cleanRecord: r.cleanRecord}
    },
    commit: (details) => {
        let r = validateDetails(details, { newRecord: true })

        if (r.state !== 'success') {
            return r
        }

        let commitRecord = hashPassword(r.cleanRecord.password)
        commitRecord.type = 'password'

        return { state: 'success', pass: true, commitRecord: commitRecord }
    }
}