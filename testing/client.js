const WebSocket = require('ws')
const fs = require('fs')
const { exit } = require('process')

const settingsRaw = fs.readFileSync(`${__dirname}/client.settings.json`)
const settings = JSON.parse(settingsRaw)

const stateDir = `${__dirname}/state`
const tokenPath = `${stateDir}/curToken`

function log(msg) {
    console.log(`${new Date()} | ${msg}`)
}

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

if (!fs.existsSync(stateDir)) {
    fs.mkdirSync(stateDir)
}

var token = null

if (!fs.existsSync(tokenPath)) {
    saveToken(settings.token)
    token = settings.token
} else {
    token = loadToken(tokenPath)
}

// Temporary list of message handlers. Handlers should be defined as modules and loaded from the 'providers' directory.
// Provider modules should export a 'version' string and a 'messages' object. Each key on the 'messages' object should
// define a handler that can accept the message object received from the server and a connection object.
providers = {

    'connection': {
        version: '0.1.0.0',
        messages: {
            state: (message, connection) => {
                switch(message.state) {
                    case 'rejected': {
                        log(`The server rejected connection: ${message.reason}`)
                        return
                    }
                    case 'accepted': {
                        log(`The server accepted connection.`)
                        return
                    }
                }
            }
        }
    },

    'capability': {
        version: '0.1.0.0',
        messages: {
            report: (message, connection) => {
                let cs = []

                for (var name in providers) {
                    let h = providers[name]
                    let r = { name: name, version: h.version, messages: [] }

                    if (h.messages) {
                        for (m in h.messages) {
                            r.messages.push(m)
                        }
                    }

                    cs.push(r)
                }

                connection.send(JSON.stringify({
                    type: 'capability.report',
                    capabilities: cs
                }))
            }
        }
    },

    'client': {
        version: '0.1.0.0',
        messages: {
            'token.issue': (message, connection) => {
                console.log(`${new Date()} | New token issued.`)
                token = message.token
                saveToken(token)
            }
        }
    }
}

function connect() {

    var reconnect = true

    // Request token refresh every 8 hours.
    const tokenRefresh = setInterval(() => {
            connection.send(JSON.stringify(
                { type: 'client.token.refresh' }
            ))
        },
        (8 * 3600 * 1000)
    )

    const connection = new WebSocket(settings.reportURL)

    connection.on('error', (e) => {
        console.log(`${new Date()} | Failed to contact server: ${e}`)
    })

    connection.onopen = () => {
        connection.send(token)
        connection.send(JSON.stringify({
            type: 'client.state',
            state: 'ready'
        }))
    }

    connection.on('message', (message) => {
        // TODO: Handle messages

        try {
            var msg = JSON.parse(message)
        } catch (e) {
            log(`Invalid message received from server (not valid JSON): ${message}`)
            return
        }

        if (!msg.type) {
            log(`Invalid message received from server (no type declaration): ${message}`)
            return
        }

        let m = msg.type.match(/^(?<provider>[A-z0-9\-_]+)\.(?<message>[A-z0-9\-_.]+)$/)

        if (!m) {
            log(`Invalid message received from server (invalid type format): ${message}`)
            return
        }

        let p = providers[m.groups.provider]

        if (!p) {
            log(`No provider for the given message type: ${message}`)
            return
        }

        let h = p.messages[m.groups.message]

        if (!h) {
            log(`The provider does not support the given message type: ${message}`)
            return
        }

        try {
            h(msg, connection)
        } catch(e) {
            log(`Exception occured while processing message: ${e}`)
        }

    })

    connection.on('close', (e) => {
        log(`Connection to server closed`)
        if (reconnect) {
            log(`Attempting to reconnect in 30 seconds: ${e}`)
            clearInterval(tokenRefresh)
            setTimeout(connect, 30000)
        }
    })

    const handleSignal = (e) => {
        console.log(e)
        connection.send(JSON.stringify({
            type: 'client.state',
            state: `stop.${e}`
        }))
        reconnect = false
        connection.close()
        process.exit()
    }

    process.on('SIGTERM', handleSignal)
    process.on('SIGINT',  handleSignal)
    process.on('SIGHUP',  handleSignal)

}


connect()