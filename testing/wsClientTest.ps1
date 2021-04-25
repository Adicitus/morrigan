param(
    $hostname = "http://localhost",
    $user = "admin",
    $pass = 'Pa55w.rd'
)

$stateDir = "$PSScriptRoot\state"

if (Test-Path $stateDir -PathType Container) {
    Remove-Item $stateDir -Recurse
}

$authBody = @{ name = $user; password = $pass } | ConvertTo-Json

$t = Invoke-RestMethod -Uri "$hostname/auth" -Body $authBody -Method Post -ContentType application/json
$headers = @{ authorization="bearer $($t.token)" }

$u = Invoke-RestMethod -Uri "$hostname/auth/identity/me" -Method Get -Headers $headers

$u.identity.functions | Write-Host

if ("api" -notin $u.identity.functions) {
    $functionPatchBody = @{functions = ($u.identity.functions + "api")} | ConvertTo-Json
    Invoke-RestMethod -Uri "$hostname/auth/identity/$($u.identity.id)" -Method Patch -Headers $headers -Body $functionPatchBody -ContentType 'application/json'

    $t = Invoke-RestMethod -Uri "$hostname/auth" -Body $authBody -Method Post -ContentType application/json
    $headers = @{ authorization="bearer $($t.token)" }
}

$c = Invoke-RestMethod -Uri "$hostname/api/client/provision" -Body '{"id": "FLORENSTR"}' -Method Post -ContentType application/json -Headers $headers

$c.token