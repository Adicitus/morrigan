const { DateTime } = require('luxon')

function log(msg) {
    console.log(`${DateTime.now()} | ${msg}`)
}

module.exports = {
    version: '0.1.0.0',
    messages: {
        capability: (message, connection, record, providers) => {
            log(`${record.clientId} reported the following capabilities:`)
            for (var c in message.capabilities) {
                let capability = message.capabilities[c]
                log (`${capability.name} (${capability.version})`)
            }

            let client = providers.client.getClient(record.clientId)
            client.capabilities = message.capabilities
        }
    }
}