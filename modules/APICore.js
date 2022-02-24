
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
     * @param {object} router - The express router to set up endpoints on.
     * @param {object} serverEnv - Server environment, expected to contain:
     *  + settings: The server settings object.
     *  + log: The log function to use.
     *  + db: The database used by the server.
     *  + info: Server info.
     */
    async setup(router, serverEnv) {

        let settings = serverEnv.settings

        this.log = serverEnv.log

        this.coreEnv = {
            settings: settings,
            db: serverEnv.db,
            log: this.log,
            serverInfo: serverEnv.info
        }

        router.use('/', (req, res, next) => {
            
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

        this.coreEnv.providers = await require('./Providers').setup(router, settings.api.providers, this.coreEnv)

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