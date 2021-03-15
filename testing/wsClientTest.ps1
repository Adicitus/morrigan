$stateDir = "$PSScriptRoot\state"

if (Test-Path $stateDir -PathType Container) {
    Remove-Item $stateDir -Recurse
}

$t = Invoke-RestMethod -Uri http://localhost/auth -Body '{"name": "admin", "password": "Pa$$w0rd"}' -Method Post -ContentType application/json
$headers = @{ authorization="bearer $($t.token)" }
$c = Invoke-RestMethod -Uri http://localhost/api/client/provision -Body '{"id": "FLORENSTR"}' -Method Post -ContentType application/json -Headers $headers

$c.token