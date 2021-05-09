module.exports = {
    port: 443,

    server: {
        https: true,
        certPath: "cert.pem",
        keyPath:  "key.pem"
    },

    database: {
        connectionString: "mongodb://127.0.0.1:27017",
        dbname: "report-server"
    },

    logger: {
        console: true,
        logDir: "/reportServer.logs"
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