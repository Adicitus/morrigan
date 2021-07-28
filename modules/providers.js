
const fs = require('fs')

/**
 * Enumerates and loads providers from the providersDir directory, adding any exported endpoints to
 * the provided app object.
 * 
 * Each provider should be defined as a module in a file called module.js located in a subfolder with the
 * provider's name under the "providersDir" directory.
 * 
 * Endpoints should be exported as an array of objects with the following fields:
 *  - route: A path to be appended to the "uriRoot" (uriRoot + providerName + route).
 *  - method: A HTTP method.
 *  - handler: A function to be  registered as handler fo the endpoint.
 * 
 * @param app Express app to register endpoints on.
 * @param uriRoot The root path that provider endpoints should be registered under.
 * @param providersDir The path to the directory containing provider definitions. This parameter can accept and array of paths to load from multiple locations.
 * @param environment Core environment
 * @param providers Prepopulated providers. Can be safely omitted.
 */
module.exports.setup = (app, uriRoot, providersDir, environment, providers) => {

    const log = environment.log

    log(`Loading providers under '${uriRoot}'...`)

    if (!Array.isArray(providersDir)) {
        providersDir = [providersDir]
    }

    if (!providers) {
        providers = {}
    }


    for (var dirI in providersDir) {
        let dir = providersDir[dirI]
        if (!fs.existsSync(dir)) {
            log(`Invalid provider directory path provided: ${dir}`)
            continue
        }

        let providerNames = fs.readdirSync(dir)
        if (!providerNames) {
            log(`Failed to read directory: ${dir}`)
            continue
        }

        for (var i in providerNames) {
            let name = providerNames[i]
            let providerModulePath = `${dir}/${name}/module.js`
            if (fs.existsSync(providerModulePath)) {
                log(`Loading provider '${name}' (${providerModulePath})...`)
                try {
                    let provider = require(providerModulePath)
                    providers[name] = provider
                } catch(e) {
                    log(`Failed to read provider module '${providerModulePath}': ${e}`)
                }
            }
        }
    }

    for (const p in providers) {
        let provider = providers[p]
        if (provider.setup) {
            provider.setup(environment)
        }
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

    return providers
}