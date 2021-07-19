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

    /*
    api: {
        // Additional paths to look for providers at:
        providerPaths: ['/morrigan/providers']
    },

    auth: {
        // Additional paths to look for authentication providers at:
        providerPaths: ['/morrigan/auth/providers']
    }
    */
}