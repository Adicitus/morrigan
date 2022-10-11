module.exports = {
    version: '1.0.0',
    name: 'errorComponent',

    setup: () => {
        throw new Error('This is an unhandled exception that should be caught and handled by the server.')
    }
}