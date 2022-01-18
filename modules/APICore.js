
/**
 * Class containing the extensible core functionality of Morrigan.
 */
class APICore {

    #coreEnv = null
    #log = null

    /**
     * Middleware to check if the request should be allowed.
     * @param {object} req 
     * @returns {bool} True if:
     * 1. The request is a SebSocket Upgrade request.
     * 2. The request isauthenticated as a user with the 'api' authorization in
     *    it's function list.
     * Otherwise returns false.
     */
    _verifyReqAuthentication(req) {

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
    async setup(path, app, serverEnv) {

        let settings = serverEnv.settings

        this.log = serverEnv.log

        this.coreEnv = {
            settings: settings,
            db: serverEnv.db,
            log: this.log,
            serverInfo: serverEnv.info
        }

        app.use(path, (req, res, next) => {
            
            if (this._verifyReqAuthentication(req)) {
                req.core = this.coreEnv
                next()
            } else {
                this.log(`Unauthenticated connection attempt from ${req.connection.remoteAddress}.`)
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

        this.coreEnv.providers = await require('./Providers').setup(app, path, providerPaths, this.coreEnv)

    }

    /**
     * Event listener to receive shutdown notifications.
     * @param {string} reason The reason why the server is shutting down. This will usually be a signal (SIGINT, SIGTERM, etc.). 
     */
    async onShutdown(reason) {
        let promises = []
        for (var i in this.coreEnv.providers) {
            let p = this.coreEnv.providers[i]

            if (p.onShutdown) {
                promises.push(p.onShutdown(reason))
            }
        }
        await Promise.all(promises)
    }
}

module.exports = new APICore()