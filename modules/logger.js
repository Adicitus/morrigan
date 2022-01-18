const fs = require('fs')
const winston = require('winston')
require('winston-daily-rotate-file')
const morgan = require('morgan')

/**
 * Class containing logging functionality for Morrigan.
 */
class Logger {

    #consoleLogger = null
    #engine=null

    #log = null

    constructor() {
        const logFormat = winston.format.printf(({level, message, timestamp}) => {
            return `${timestamp} ${level.padEnd(7)} | ${message}`
        })

        // Default transport:
        this.consoleLogger = new winston.transports.Console()

        this.engine = winston.createLogger({
            format: winston.format.combine(
                winston.format.timestamp(),
                logFormat
            ),
            transports: [ this.consoleLogger ]
        })

        this.log = this.getLog()
    }

    /**
     * Configure the logger on the given application using the proviede settings.
     * 
     * Supported settings:
     *  - console {boolean}: Whether to log messages to the console (default: true).
     *  - logDir  {string}:  Folder to store log files in (remove or leave empty to disable file logging).
     * @param {object} app Express application.
     * @param {object} settings Object containing logging settings.
     */
    setup(app, settings) {

        if (!settings) {
            settings = {}
        }

        if (settings.console !== undefined && settings.console === false) {
            this.engine.remove(this.consoleLogger)
        } else {
            if (!this.engine.transports.includes(this.consoleLogger)) {
                this.engine.add(this.consoleLogger)
            }
        }

        if (settings.logDir) {

            if(!fs.existsSync(settings.logDir)) {

                this.engine.log('info', `Log dir (${settings.logDir}) does not exist, trying to create it...`)

                try {
                    fs.mkdirSync(settings.logDir, {recursive: true})
                } catch(e) {
                    this.engine.log('error', `Failed to create log directory.`)
                    this.engine.log('error', JSON.stringify(e))
                    return
                }
            }

            try {
                fs.accessSync(settings.logDir, fs.constants.W_OK | fs.constants.R_OK)
            } catch(e) {
                this.engine.log('error', `No read/write access to log directory (${settings.logDir})`)
                this.engine.log('error', JSON.stringify(e))
                return
            }

            this.engine.log('info', `Writing log files to '${fs.realpathSync(settings.logDir)}'.`)

            let transport = new winston.transports.DailyRotateFile({
                filename: 'morrigan-%DATE%.log',
                datePattern: 'YYYY-MM-DD-HH',
                dirname: settings.logDir,
                zippedArchive: true,
                maxSize: '20m',
                maxFiles: '14d'
            })

            this.engine.add(transport)
        }

        // Setup request logging:
        app.use(
            morgan(
                '--> :remote-addr :method :url :status - :res[content-length]b :response-time ms',
                {
                    stream: {
                        write: (msg) => this.log(msg.trim())
                    }
                }
            )
        )
    }

    /**
     * Returns a function that can be used to log messages with this logger.
     * @returns A function that can be used to log messages using this logger.
     */
    getLog() {
        // Define engine here to make it accessible to the logging function.
        let engine = this.engine
        return (msg, level) => {
            if (!level) {
                level = 'info'
            }
            
            engine.log({level: level, message: msg})
        }
    }
}

module.exports = new Logger()