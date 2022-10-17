const name = __filename

module.exports = {
    version: '1.0.0',
    name,

    setup: () => {
        throw new Error(`This is an unhandled exception thrown by the .setup method on '${name}' that should be caught and handled by the server.`)
    },

    onShutdown: () => {
        throw new Error(`This is an unhandled exception thrown by the .onShutdown method on '${name}' that should be caught by the server.`)
    }
}