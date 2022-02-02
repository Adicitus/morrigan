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

$clientEndpoint = "$hostname/api/client"

$clientId = [guid]::NewGuid()

"Provisioning client (ID: {0})..." -f $clientId | Write-Host -ForegroundColor Cyan
$t = Invoke-RestMethod -Uri "$clientEndpoint/provision" -Body ( @{ id = $clientId } | ConvertTo-Json ) -Method Post -ContentType application/json -Headers $headers
$t | Write-Host

"Attempting to get details for the client (ID: {0})..." -f $clientId | Write-Host -ForegroundColor Cyan
$c = Invoke-RestMethod -Uri "$clientEndpoint/$clientId" -Method Get -Headers $headers
$c | ConvertTo-Json -Depth 3 | Write-Host

"Attempting to get details for all clients..." | Write-Host -ForegroundColor Cyan
$c = Invoke-RestMethod -Uri "$clientEndpoint" -Method Get -Headers $headers
$c | ConvertTo-Json -Depth 3 | Write-Host

"Attempting to delete the client (ID: {0})..." -f $clientId | Write-Host -ForegroundColor Cyan
Invoke-WebRequest -Uri "$clientEndpoint/$clientId" -Method Delete -Headers $headers | ConvertTo-Json -Depth 1 | Write-Host