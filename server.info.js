const {v4: uuidv4} = require('uuid')
const os = require('os')
const { DateTime } = require('luxon')

module.exports.build = async (stateStore) => {

    let info = {}

    info.version = require(__dirname + '/package.json').version
    info.serverRoot = __dirname

    info.startTime = DateTime.now().toISO()
    info.hostname = os.hostname()

    let id = await stateStore.get('id')
    let installTime = null
    if (id === null) {
        id = uuidv4()
        stateStore.set('id', id)
        installTime = DateTime.now().toISO()
        stateStore.set('installTime', installTime)
        info.firstRun = true
    } else {
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