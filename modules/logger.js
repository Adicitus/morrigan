const fs = require('fs')
const winston = require('winston')
require('winston-daily-rotate-file')

const logFormat = winston.format.printf(({level, message, timestamp}) => {
    return `${timestamp} ${level.padEnd(7)} | ${message}`
})

// Default transport:
const consoleLogger = new winston.transports.Console()

const logger = winston.createLogger({
    format: winston.format.combine(
        winston.format.timestamp(),
        logFormat
    ),
    transports: [ consoleLogger ]
})

/**
 * Configure the logger using the proviede settings.
 * 
 * Supported settings:
 *  - console {boolean}: Whether to log messages to the console (default: true).
 *  - logDir  {string}:  Folder to store log files in (remove or leave empty to disable file logging).
 * @param {object} settings 
 */
module.exports.setup = (settings) => {
    if (settings.console !== undefined && settings.console === false) {
        logger.remove(consoleLogger)
    } else {
        if (!logger.transports.includes(consoleLogger)) {
            logger.add(consoleLogger)
        }
    }

    if (settings.logDir) {

        if(!fs.existsSync(settings.logDir)) {

            logger.log('info', `Log dir (${settings.logDir}) does not exist, trying to create it...`)

            try {
                fs.mkdirSync(settings.logDir, {recursive: true})
            } catch(e) {
                logger.log('error', `Failed to create log directory.`)
                logger.log('error', JSON.stringify(e))
                return
            }
        }

        try {
            fs.accessSync(settings.logDir, fs.constants.W_OK | fs.constants.R_OK)
        } catch(e) {
            logger.log('error', `No read/write access to log directory (${settings.logDir})`)
            logger.log('error', JSON.stringify(e))
            return
        }

        logger.log('info', `Writing log files to '${fs.realpathSync(settings.logDir)}'.`)

        let transport = new winston.transports.DailyRotateFile({
            filename: 'reportServer-%DATE%.log',
            datePattern: 'YYYY-MM-DD-HH',
            dirname: settings.logDir,
            zippedArchive: true,
            maxSize: '20m',
            maxFiles: '14d'
        })

        logger.add(transport)
    }
}

module.exports.log = (msg, level) => {
    if (!level) {
        level = 'info'
    }

    logger.log({level: level, message: msg})
}