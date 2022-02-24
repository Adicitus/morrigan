const { info } = require("winston")

/**
 * Class containing logic for loading providers and adding them to Morrigan.
 */
class Providers {

    /**
     * Enumerates and loads providers specified by providersList, adding any exported endpoints to
     * the provided app object.
     * 
     * Providers should be installed using npm.
     * 
     * A provider should export a 'name' key and may export a 'endpoints' key.
     * 
     * The 'name' key is used to register the provider internally. If 2 or more providers specify
     * the same name, the provider specified last in the list will be used.
     * 
     * Endpoints should be exported as an array of objects with the following fields:
     *  - route: A path to be appended to the "uriRoot" (uriRoot + providerName + route).
     *  - method: A HTTP method.
     *  - handler: A function to be registered as handler fo the endpoint.
     * 
     * @param app Express app to register endpoints on.
     * @param uriRoot The root path that provider endpoints should be registered under.
     * @param providersList Array of module names that should be loaded as providers.
     * @param environment Core environment
     * @param providers Prepopulated providers list, this object will be returned by the function. This parameter can be safely omitted, in which case a new object will be created.
     * @returns An object mapping provider names to loaded provider modules.
     */
    static async setup (app, uriRoot, providersList, environment, providers) {

        const log = environment.log

        log(`Loading providers...`)

        if (!Array.isArray(providersList)) {
            providersList = [providersList]
        }

        if (!providers) {
            providers = {}
        }

        providersList.forEach(providerName => {
            try {
                log(`Loading provider '${providerName}'...`)
                let provider = require(providerName)
                if (!provider.name) {
                    log('Provider does not specify a name')
                }
                providers[provider.name] = provider
            } catch (e) {
                log(`Failed to load provider module '${providerName}': ${e}`)
            }
        })

        for (const p in providers) {
            let provider = providers[p]
            let promises = []
            if (provider.setup) {
                promises.push(provider.setup(environment, providers))
            }
            await Promise.all(promises)
        }

        for (var namespace in providers) {
            let endpoints = providers[namespace].endpoints
            if (endpoints && Array.isArray(endpoints)) {

                log (`Registering endpoints for '${namespace}':`)

                for (var i in endpoints) {
                    let endpoint = endpoints[i]

                    if (!endpoint.route || typeof(endpoint.route) !== 'string' || !endpoint.route.match(/\/([^/]+(\/[^/]+)*)?/) ) {
                        log(`Invalid endpoint route specified: ${endpoint.route}`)
                        continue
                    }

                    if (!endpoint.method || typeof(endpoint.method) !== 'string' || !['connect', 'delete', 'get', 'head', 'options', 'patch', 'post', 'put', 'trace', 'ws'].includes(endpoint.method)) {
                        log(`Invalid endpoint method specified: ${endpoint.method}`)
                        continue
                    }

                    if (!endpoint.handler || typeof(endpoint.handler) !== 'function') {
                        log(`Invalid endpoint handler specified: ${endpoint.handler}`)
                        continue
                    }

                    let route = `${uriRoot}/${namespace}${endpoint.route}`

                    log(`${endpoint.method.toUpperCase().padStart(7, ' ')} ${route}`)

                    app[endpoint.method](route, endpoint.handler)
                }
            }
        }

        console.log(providers)

        return providers
    }
}

module.exports = Providers