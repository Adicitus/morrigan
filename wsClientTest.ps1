$t = Invoke-RestMethod -Uri http://localhost:1337/auth -Body '{"name": "admin", "password": "Pa$$w0rd"}' -Method Post -ContentType application/json
$headers = @{ authorization="bearer $($t.token)" }
$c = Invoke-RestMethod -Uri http://localhost:1337/client/client/provision -Body '{"id": "FLORENSID"}' -Method Post -ContentType application/json -Headers $headers
$c.token