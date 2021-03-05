module.exports = {
    version: '0.1.0.0',
    messages: {
        report: (message, connection, core) => {
            let cs = []

            let providers = core.providers

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
}