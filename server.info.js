const fs = require('fs')
const {v4: uuidv4} = require('uuid')
const os = require('os')
const { DateTime } = require('luxon')

module.exports.build = (stateDirPath) => {

    let info = {}

    if (stateDirPath === null) {
        stateDirPath = `${__dirname}/state`
    }

    let versionFilePath = `${__dirname}/version`
    info.version = fs.readFileSync(versionFilePath)
    info.serverRoot = __dirname

    info.startTime = DateTime.now().toISO()
    info.hostname = os.hostname()

    if (!fs.existsSync(stateDirPath)) {
        fs.mkdirSync(stateDirPath, {recursive: true})
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
        info.firstRun = true
    } else {
        id = fs.readFileSync(idFilePath, { encoding: 'utf8' })
        installTime = fs.readFileSync(installTimeFilePath, { encoding: 'utf8' })
        info.firstRun = false
    }

    info.id = id
    info.installTime = installTime

    let ips = []
    let nets = os.networkInterfaces()
    for (const name of Object.keys(nets)) {
        for (const net of nets[name]) {
            if (net.family === 'IPv4' && !net.internal) {
                ips.push(net.address)
            }
        }
    }

    info.ips = ips

    return info
}