module.exports = {
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