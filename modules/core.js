"use strict"

var coreEnv = null
var log = null

function verifyReqAuthentication(req) {

    if (req.headers.upgrade && req.headers.upgrade === 'websocket') {
        return true
    }

    if (!req.authenticated) {
        return false
    }

    let functions = req.authenticated.functions

    if (!functions || !functions.includes('api')) {
        return false
    }

    return true

}

/**
 * Used to set up core functionality.
 * 
 * @param {string} path - Base path to set up the endpoints under.
 * @param {object} app - The express app to set up endpoints on.
 * @param {object} serverEnv - Server environment, expected to contain:
 *  + settings: The server settings object.
 *  + log: The log function to use.
 *  + db: The database used by the server.
 *  + info: Server info.
 */
module.exports.setup = async (path, app, serverEnv) => {

    let settings = serverEnv.settings

    log = serverEnv.log

    coreEnv = {
        settings: settings,
        db: serverEnv.db,
        log: log,
        serverInfo: serverEnv.info
    }

    app.use(path, (req, res, next) => {
        
        if (verifyReqAuthentication(req)) {
            req.core = coreEnv
            next()
        } else {
            log(`Unauthenticated connection attempt from ${req.connection.remoteAddress}.`)
            res.status(403)
            res.end()
            return
        }
    })
    

    // Handlers should be defined as modules and loaded from the 'providers' directory.
    // Provider modules should export a 'version' string and a 'messages' object. Each key on the 'messages' object should
    // define a handler that can accept the message object received from the server, a connection object and a 'record'
    // object containing metadata about the connection (including the clientId of the client associated with the connection).
    let providerPaths = [`${__dirname}/providers/core`]
    if (settings.api && settings.api.providerPaths) {
        let a = settings.api.providerPaths
        if (Array.isArray(a)) {
            providerPaths = providerPaths.concat(a)
        } else {
            providerPaths.push(a)
        }
    }

    coreEnv.providers = await require('./providers').setup(app, path, providerPaths, coreEnv)

}

module.exports.onShutdown = async (reason) => {
    let promises = []
    for (var i in coreEnv.providers) {
        let p = coreEnv.providers[i]

        if (p.onShutdown) {
            promises.push(p.onShutdown(reason))
        }
    }
    await Promise.all(promises)
}