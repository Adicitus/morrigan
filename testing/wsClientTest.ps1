$stateDir = "$PSScriptRoot\state"

if (Test-Path $stateDir -PathType Container) {
    Remove-Item $stateDir -Recurse
}

$t = Invoke-RestMethod -Uri http://localhost/auth -Body '{"name": "admin", "password": "Pa55w.rd"}' -Method Post -ContentType application/json
$headers = @{ authorization="bearer $($t.token)" }

$u = Invoke-RestMethod -Uri http://localhost/auth/identity/me -Method Get -Headers $headers

$u.identity.functions | Write-Host

if ("api" -notin $u.identity.functions) {
    Invoke-RestMethod -Uri http://localhost/auth/identity/me -Method Patch -Headers $headers -Body (@{functions = ($u.identity.functions + "api")} | ConvertTo-Json) -ContentType 'application/json'

    $t = Invoke-RestMethod -Uri http://localhost/auth -Body '{"name": "admin", "password": "Pa55w.rd"}' -Method Post -ContentType application/json
    $headers = @{ authorization="bearer $($t.token)" }
}

$c = Invoke-RestMethod -Uri http://localhost/api/client/provision -Body '{"id": "FLORENSTR"}' -Method Post -ContentType application/json -Headers $headers

$c.token