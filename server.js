"use strict"
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
        console.log('starting as HTTPS server')

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
                    console.log(`Missing certificate (expected '${certPath}')`)
                    return
                }

                let keyPath = `${__dirname}/cert.pem`
                if (settings.server.keyPath) {
                    keyPath = settings.server.keyPath
                }

                if (!fs.existsSync(keyPath)) {
                    console.log(`Missing private key (expected '${keyPath}')`)
                    return
                }

                try {
                    options.cert = fs.readFileSync(certPath)
                    options.key = fs.readFileSync(keyPath)
                } catch(e) {
                    console.log('An exception occured while trying to load certificates:')
                    console.log(e)
                    return
                }
                break
            }

            default: {
                console.log(`Unexpected certificate type: ${certType}`)
                return
            }
        }

        server = require('https').createServer(options, app)
    }
}

if (!server) {
    console.log('Starting as HTTP server')
    server = require('http').createServer(app)
}


expressws(app, server)

app.use(bodyParser.json())
app.use(auth.mw_verify)
auth.setup('/auth', app, settings)
wsCore.setup('/api', app, settings)



server.listen(port, () => {
    console.log(`${new Date()}: Listening on port ${port}.`)
})