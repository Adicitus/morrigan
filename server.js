"use strict"

const port = 1337
process.title = "node-report-server"

const http = require('http')
const express = require('express')
const bodyParser = require('body-parser')

const wsClient = require('./modules/wsClient')
const auth = require('./modules/auth')


var app = express()
var server = http.createServer(app)
var appWS = require('express-ws')(app, server)

app.use(bodyParser.json())
app.use(auth.mw_verify)
auth.setup('/auth', app)
wsClient.setup('/api', app)



server.listen(port, () => {
    console.log(`${new Date()}: Listening on port ${port}.`)
})