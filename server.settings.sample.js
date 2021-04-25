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

    logging: {
        
    }
}