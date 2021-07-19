module.exports.version = "0.0.0.1"
module.exports.serverRoot = __dirname

const fs = require('fs')
const {v4: uuidv4} = require('uuid')
const os = require('os')
const { DateTime } = require('luxon')

module.exports.startTime = DateTime.now().toISO()
module.exports.hostname = os.hostname()

let stateDirPath = `${__dirname}/state`
if (!fs.existsSync(stateDirPath)) {
    fs.mkdirSync(stateDirPath)
}

let idFilePath = `${stateDirPath}/id`
let installTimeFilePath = `${stateDirPath}/installTime`
let id = null
let installTime = null
if (!fs.existsSync(idFilePath)) {
    id = uuidv4()
    fs.writeFileSync(idFilePath, id, { encoding: 'utf8' })
    installTime = DateTime.now().toISO()
    fs.writeFileSync(installTimeFilePath, installTime, { encoding: 'utf8' })
    module.exports.firstRun = true
} else {
    id = fs.readFileSync(idFilePath, { encoding: 'utf8' })
    installTime = fs.readFileSync(installTimeFilePath, { encoding: 'utf8' })
    module.exports.firstRun = false
}

module.exports.id = id
module.exports.installTime = installTime

let ips = []
let nets = os.networkInterfaces()
for (const name of Object.keys(nets)) {
    for (const net of nets[name]) {
        if (net.family === 'IPv4' && !net.internal) {
            ips.push(net.address)
        }
    }
}

module.exports.ips = ips