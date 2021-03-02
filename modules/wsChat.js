"use strict"

const auth = require('./auth')

module.exports.setup = (path, app) => {

    function htmlEntities(s) {
        return String(s).replace(/[&<>"]/g, (c) => {
            switch(c) {
                case '&': { return '&amp;' }
                case '<': { return '&lt;' }
                case '>': { return '&gt;' }
                case '"': { return '&quot;' }
            }
        })
    }

    var history = []
    var clients = []

    var colors = [
        'red',
        'green',
        'blue',
        'magenta',
        'puriple',
        'plum',
        'orange'
    ]
    colors = colors.sort((a, b) => Math.random() > 0.5 ? -1 : 1)

    app.ws(path, (ws, request) => {
        
        console.log(`${new Date()}: connection established from ${request.connection.remoteAddress} via ${request.headers.origin}`)
        
        var index = clients.push(ws) - 1
        var authenticated = false
        var userName = false
        var userColor = false
        console.log(`${new Date()}: Connection accepted.`)

        if (history.length > 0) {
            ws.send(
                JSON.stringify({type: 'history', history: history })
            )
        }

        setTimeout(
            () => {
                if (!authenticated) {
                    console.log(`${new Date()}: Client failed to authenticate within 3 seconds, closing connection.`)
                    ws.close()
                    clients.splice(index, 1)
                } 
            },
            3000
        )

        ws.on('message', (message) => {
                
            if (!authenticated) {
                var p = auth.verifyToken(message)
                if (p && p.functions.includes('chat')) {
                    console.log(`${new Date()}: Authentication successful.`)
                    authenticated = true
                    ws.send(
                        JSON.stringify({
                            type: 'authenticated'
                        })
                    )
                    return
                } else {
                    console.log('Authentication failed. Closing the connection')
                    ws.close()
                    return
                }
            }

            if (userName === false) {
                // First message: username
                userName = htmlEntities(message)
                userColor = colors.shift()
                ws.send(
                    JSON.stringify({
                        type: 'color', color: userColor
                    })
                )

                console.log(`${new Date()}: User is known as '${userName}' with color '${userColor}'`)
                return
            }

            console.log(`${new Date()}: message received from '${userName}': ${message}`)

            var obj = {
                time: (new Date()).getTime(),
                text: htmlEntities(message),
                author: userName,
                color: userColor
            }
            history.push(obj)
            history = history.slice(-100)

            var msg = JSON.stringify({
                type: 'message',
                message: obj
            })

            for (var i = 0; i < clients.length; i++) {
                clients[i].send(msg)
            }
        })

        ws.on('close', () => {
            if (userName !== false && userColor !== false) {
                console.log(`${new Date()}: peer '${userName}' disconnected (IP: ${ws.remoteAddress}, Color: ${userColor})`)
                clients.splice(index, 1)
                colors.push(userColor)
            }
        })
        
    })
}