"use strict"
const { DateTime } = require('luxon')
const fs = require('fs')

const settingsPath = `${__dirname}/server.settings.json`

var settings = null

if (fs.existsSync(settingsPath)) {
    let settingsRaw = fs.readFileSync(settingsPath)
    settings = JSON.parse(settingsRaw.toString())
} else {
    settings = {}
}

var port = 1337
if (settings.port) {
    port = settings.port
}

const log = (msg) => {
    console.log(`${DateTime.now()} | ${msg}`)
}

process.title = "node-report-server"

const express = require('express')
const expressws = require('express-ws')
const bodyParser = require('body-parser')

const wsCore = require('./modules/wsCore')
const auth = require('./modules/auth')


var app = express()

var server = null

if (settings.server) {
    if (settings.server.https === true) {
        log('starting as HTTPS server')

        let options = {}

        // Defaults
        let certType = 'pem'

        if (settings.server.certType) {
            certType = settings.server.certType
        }

        switch(certType) {
            case 'pem': {
                let certPath = `${__dirname}/cert.pem`
                if (settings.server.certPath) {
                    certPath = settings.server.certPath
                }
                
                if (!fs.existsSync(certPath)) {
                    log(`Missing certificate (expected '${certPath}')`)
                    return
                }

                let keyPath = `${__dirname}/cert.pem`
                if (settings.server.keyPath) {
                    keyPath = settings.server.keyPath
                }

                if (!fs.existsSync(keyPath)) {
                    log(`Missing private key (expected '${keyPath}')`)
                    return
                }

                try {
                    options.cert = fs.readFileSync(certPath)
                    options.key = fs.readFileSync(keyPath)
                } catch(e) {
                    log('An exception occured while trying to load certificates:')
                    log(e)
                    return
                }
                break
            }

            default: {
                log(`Unexpected certificate type: ${certType}`)
                return
            }
        }

        server = require('https').createServer(options, app)
    }
}

if (!server) {
    log('Starting as HTTP server')
    server = require('http').createServer(app)
}

expressws(app, server)

app.use(bodyParser.json())
app.use(auth.mw_verify)



const mongoClient = require('mongodb').MongoClient

var database = null

mongoClient.connect(settings.database.connectionString, { useUnifiedTopology: true }).then(client => {
    log('MongoDB server connected.')
    database = client.db(settings.database.dbname)

    auth.setup('/auth', app, settings, database, log)
    wsCore.setup('/api', app, settings, database, log)

    server.listen(port, () => {
        log(`Listening on port ${port}.`)
    })
}).catch(err => {
    log('Failed to connect to database server.')
    log(err)
})