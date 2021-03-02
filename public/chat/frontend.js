//frontend.js
$(function(){
    "user strict"

    var tokenJSON = $.ajax({
        type: 'POST',
        url: 'http://localhost:1337/auth',
        data: '{"type":"basic", "username":"admin", "password":"Pa$$w0rd"}',
        contentType: 'application/json',
        async: false
    })
    var token = JSON.parse(tokenJSON.responseText).token

    console.log(token)

    var content = $('#content')
    var input   = $('#input')
    var status  = $('#status')

    var myColor = false
    var myName  = false

    if (!window.WebSocket) {
        content.html($(
            '<p>',
            { text: 'Sorry, but your browser doesn\'t support WebSocket.' }
        ))
        input.hide()
        $('span').hide()
        return
    }



    var connection = new WebSocket('ws://127.0.0.1:1337/chat/connect')

    connection.onopen = function() {
        setTimeout(() => { connection.send(token) }, 1000)
        // connection.send(token)
        status.text('authenticating...')
    }

    connection.onerror = function(error) {
        content.html($(
            '<p>',
            { text: 'Sorry, but there\'s some problem with your connection or the server is down.' }
        ))
    }

    connection.onmessage = function(message) {
        try {
            var data = JSON.parse(message.data)
        } catch (e) {
            console.log(`Invalid JSON: ${message.data}`)
            return
        }

        switch (data.type) {
            case 'authenticated':  {
                input.removeAttr('disabled')
                status.text('Choose name:')
                break;
            }
            case 'color': {
                myColor = data.color
                status.text(`${myName}: `).css('color', myColor)
                input.removeAttr('disabled').focus()
                break;
            }
            case 'history': {
                for (var i = 0; i < data.history.length; i++) {
                    var msg = data.history[i]
                    addMessage(msg.author, msg.text, msg.color, (new Date(msg.time)))
                }
                break;
            }
            case 'message': {
                input.removeAttr('disabled').focus()
                var msg = data.message
                addMessage(msg.author, msg.text, msg.color, (new Date(msg.time)))
                break;
            }
            default: {
                console.log(`Unknown message type received: ${data.type}`)
            }
        }
    }

    input.keydown(function(e){
        if (e.keyCode == 13) {
            var msg = $(this).val()

            if (!msg) {
                return
            }

            connection.send(msg)
            $(this).val('')
            input.attr('disabled', 'disabled')

            if (myName === false) {
                myName = msg
            }
        }
    })

    setInterval(function(){
            if (connection.readyState !== 1) {
                status.text('Error')
                input.attr('disabled', 'disabled').val('Unable to communicate with WebSocket server.')
            }
        },
        3000
    )

    function addMessage(author, message, color, time) {
        content.prepend(`<p><span style='color: ${color}'>${author}</span>@${time.getHours()}:${time.getMinutes()}|${message}</p>`)
    }

})