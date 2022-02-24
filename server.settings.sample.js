module.exports = {

    /*
        Directory where the state information for this server should be stored.
        Defaults to `${__dirname}/state`.
    */
    stateDir: "/morrigan.server/state",

    http: {
        port: 443,
        secure: true,
        certPath: "cert.pem",
        keyPath:  "key.pem"
    },

    database: {
        connectionString: "mongodb://127.0.0.1:27017",
        dbname: "morrigan-server"
    },

    logger: {
        console: true,
        logDir: "/morrigan.server/logs"
    },

    api: {
        providers: [
            '@adicitus/morrigan.server.providers.connection',
            '@adicitus/morrigan.server.providers.client',
            '@adicitus/morrigan.server.providers.capability'
        ]
    },

    auth: {
        providers: [
            '@adicitus/morrigan.authentication.password'
        ]
    }
}