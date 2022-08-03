const fs = require('fs')
const winston = require('winston')
require('winston-daily-rotate-file')
const morgan = require('morgan')

/**
 * Class containing logging functionality for Morrigan.
 */
class Logger {

    _consoleLogger = null
    _engine=null
    _logDir='/morrigan.server/logs'

    log = null

    constructor(app, settings) {

        settings = settings || {}

        const logFormat = winston.format.printf(({level, message, timestamp}) => {
            return `${timestamp} ${level.padEnd(7)} | ${message}`
        })

        let logLevel = settings.level || 'info'

        // Default transport:
        this._consoleLogger = new winston.transports.Console()

        this._engine = winston.createLogger({
            level: logLevel,
            format: winston.format.combine(
                winston.format.timestamp(),
                logFormat
            ),
            transports: [ this._consoleLogger ]
        })

        this.log = this.getLog()

        this._setup(app, settings)
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
    _setup(app, settings) {

        if (!settings) {
            settings = {}
        }

        if (settings.console !== undefined && settings.console === false) {
            this._engine.remove(this._consoleLogger)
        } else {
            if (!this._engine.transports.includes(this._consoleLogger)) {
                this._engine.add(this._consoleLogger)
            }
        }

        if (settings.logDir) {

            if(!fs.existsSync(settings.logDir)) {

                this._engine.log('info', `Log dir (${settings.logDir}) does not exist, trying to create it...`)

                try {
                    fs.mkdirSync(settings.logDir, {recursive: true})
                } catch(e) {
                    this._engine.log('error', `Failed to create log directory.`)
                    this._engine.log('error', JSON.stringify(e))
                    return
                }
            }

            try {
                fs.accessSync(settings.logDir, fs.constants.W_OK | fs.constants.R_OK)
            } catch(e) {
                this._engine.log('error', `No read/write access to log directory (${settings.logDir})`)
                this._engine.log('error', JSON.stringify(e))
                return
            }

            this._logDir = settings.logDir
        }

        let transport = new winston.transports.DailyRotateFile({
            filename: 'morrigan-%DATE%.log',
            datePattern: 'YYYY-MM-DD-HH',
            dirname: this._logDir,
            zippedArchive: true,
            maxSize: '20m',
            maxFiles: '14d'
        })

        this._engine.add(transport)

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
        
        this._engine.log('info', `Writing log files to '${fs.realpathSync(this._logDir)}'. Log level is set to: '${this._engine.level}'`)
    }

    /**
     * Returns a function that can be used to log messages with this logger.
     * @returns A function that can be used to log messages using this logger.
     */
    getLog() {
        // Define engine here to make it accessible to the logging function.
        let engine = this._engine
        return (msg, level) => {
            if (!level) {
                level = 'info'
            }
            
            engine.log({level: level, message: msg})
        }
    }
}

module.exports = Logger