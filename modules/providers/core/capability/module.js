module.exports.version = '0.1.0.0'

module.exports.messages = {
    report: (message, connection, record, core) => {

        providers = core.providers

        core.log(`${record.clientId} reported the following capabilities:`)
        for (var c in message.capabilities) {
            let capability = message.capabilities[c]
            core.log(`${capability.name} (${capability.version}), messages: [ ${capability.messages.join(', ')} ]`)
        }

        let client = providers.client.getClient(record.clientId)
        client.capabilities = message.capabilities
    }
}

module.exports.endpoints = [
    {
        route: '/',
        method: 'get',
        handler: (req, res) => {
            let cs = []

            let providers = req.core.providers

            for (var name in providers) {
                let h = providers[name]
                let r = { name: name, version: h.version, messages: [], endpoints: [], functions: [] }

                if (h.messages) {
                    for (m in h.messages) {
                        r.messages.push(m)
                    }
                }

                if (h.endpoints) {
                    for (i in h.endpoints) {
                        let endpoint = h.endpoints[i]
                        r.endpoints.push(`${endpoint.method.toUpperCase()} ${endpoint.route}`)
                    }
                }

                if (h.functions) {
                    r.functions = h.functions
                }

                cs.push(r)
            }

            res.send(JSON.stringify(cs))
        }
    },
    {
        route: '/:clientId',
        method: 'get',
        handler: (req, res) => {
            let cs = []
            let providers = req.core.providers
            let client = providers.client.getClient(req.params.clientId)

            if (!client) {
                res.status('204')
                res.end()
                return
            }

            if (client.capabilities) {
                res.status(200)
                res.send(JSON.stringify(client.capabilities))
            } else {
                res.status(204)
                res.end()
            }
        }
    }
]