"use strict"

const WebSocket = require('ws')
const fs = require('fs')

const settingsRaw = fs.readFileSync(`${__dirname}/client.settings.json`)
const settings = JSON.parse(settingsRaw)

const stateDir = (settings.stateDir) ? settings.stateDir : `${__dirname}/state`

function log(msg) {
    console.log(`${new Date()} | ${msg}`)
}

if (!fs.existsSync(stateDir)) {
    fs.mkdirSync(stateDir)
}

function loadProviders() {
    let providers = {}
    let providersDir = `${__dirname}/providers`
    let providerNames = fs.readdirSync(providersDir)
    for (var i in providerNames) {
        let name = providerNames[i]
        let providerModulePath = `${providersDir}/${name}/module.js`
        if (fs.existsSync(providerModulePath)) {
            try {
                let provider = require(providerModulePath)
                providers[name] = provider
            } catch(e) {
                log(`Failed to read provider module '${providerModulePath}': ${e}`)
            }
        }
    }

    return providers
}

/**
 * Handlers should be defined as modules and loaded from the 'providers' directory.
 * Provider modules should export a 'version' string and optionally:
 *  + A 'messages' object. Each key on the 'messages' object should
 *    define a handler that can accept the message object received
 *    from the server, a connection object and the core environment.
 *  + A setup function that will be called with the core environment
 *    as parameter once client has finished initializing.
 */
var providers = loadProviders()

/**
 * Core environment object, passed to all message handlers and setup functions.
 */
const coreEnv = {
    'settings': settings,
    'providers': providers,
    'log': log,
    'stateDir': stateDir
}

for (const p in providers) {
    let provider = providers[p]
    if (provider.setup) {
        provider.setup(coreEnv)
    }
}


/**
 * Main function, tries to connect to a server.
 */
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
        console.log(providers)
        connection.send(providers.client.getToken())
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
            h(msg, connection, coreEnv)
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
        reconnect = false
        if (connection.readyState === 1) {
            connection.send(JSON.stringify({
                type: 'client.state',
                state: `stopped.${e}`
            }))
            connection.close()
        }
        process.exit()
    }

    process.on('SIGTERM', handleSignal)
    process.on('SIGINT',  handleSignal)
    process.on('SIGHUP',  handleSignal)

}


connect()