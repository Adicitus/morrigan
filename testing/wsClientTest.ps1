$stateDir = "$PSScriptRoot\state"

if (Test-Path $stateDir -PathType Container) {
    Remove-Item $stateDir -Recurse
}

$t = Invoke-RestMethod -Uri http://localhost:1337/auth -Body '{"name": "admin", "password": "Pa$$w0rd"}' -Method Post -ContentType application/json
$headers = @{ authorization="bearer $($t.token)" }
$c = Invoke-RestMethod -Uri http://localhost:1337/api/client/provision -Body '{"id": "FLORENSTR"}' -Method Post -ContentType application/json -Headers $headers

$c.token