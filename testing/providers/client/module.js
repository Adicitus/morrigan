const fs = require('fs')

module.exports.version = '0.1.0.0'


var tokenPath = null
var token = null

const loadToken = () => {
    try {
        let b = fs.readFileSync(tokenPath)
        return b.toString()
    } catch (e) {
        return false
    }
}

const saveToken = (token) => {
    fs.writeFileSync(tokenPath, token)
}

module.exports.getToken = () => {
    return token
}

module.exports.setup = (core) => {
    
    tokenPath = `${core.stateDir}/curToken`

    if (!fs.existsSync(tokenPath)) {
        saveToken(core.settings.token)
        token = core.settings.token
    } else {
        token = loadToken()
    }

}

module.exports.messages = {
    'token.issue': (message, connection, core) => {
        console.log(`${new Date()} | New token issued.`)
        token = message.token
        saveToken(core.stateDir)
    }
}
