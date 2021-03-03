"use strict"

const port = 1337
process.title = "node-report-server"

const http = require('http')
const express = require('express')
const expressws = require('express-ws')
const bodyParser = require('body-parser')

const wsCore = require('./modules/wsCore')
const auth = require('./modules/auth')


var app = express()
var server = http.createServer(app)
expressws(app, server)

app.use(bodyParser.json())
app.use(auth.mw_verify)
auth.setup('/auth', app)
wsCore.setup('/api', app)



server.listen(port, () => {
    console.log(`${new Date()}: Listening on port ${port}.`)
})