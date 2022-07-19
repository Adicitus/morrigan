param(
    $hostname = "http://localhost",
    $user = "admin",
    $pass = 'Pa55w.rd'
)

$testUsername  = "testUser"
$testPassword1 = "testing1"
$testPassword2 = "testing2"
$newFunctions  = @( 'test1', 'test2' )

"Getting authentication token..." | Write-Host -ForegroundColor Cyan
$body = @{
    name = $user
    password = $pass
} | ConvertTo-Json
$token = Invoke-RestMethod -Uri "$($hostname)/api/auth" -Body $body -Method Post -ContentType application/json
$token | ConvertTo-Json -Depth 10 | Write-Host

"Building headers..." | Write-Host -ForegroundColor Cyan
$headers = @{ authorization = "bearer $($token.token)" }
$headers | ConvertTo-Json -Depth 10 | Write-Host

"Getting current users..." | Write-Host -ForegroundColor Cyan
Invoke-RestMethod -Uri "$($hostname)/api/auth/identity/" -Method get -Headers $headers | ConvertTo-Json -Depth 10 | Write-Host

"Adding new user: $($testUsername)..." | Write-Host -ForegroundColor Cyan
$newUser = Invoke-RestMethod -Uri "$($hostname)/api/auth/identity" -Method Post -Body (@{
    name = $testUsername
    auth = @{
        type = "password"
        password = $testPassword1
    }
} | ConvertTo-Json) -ContentType application/json -Headers $headers

$newUser | ConvertTo-Json -Depth 10 | Write-Host

$newUserId = $newUSer.identity.id

$userURI = "$($hostname)/api/auth/identity/$($newUserId)"

$userURI | Write-Host

"Getting new user record..." | Write-Host -ForegroundColor Cyan
Invoke-RestMethod -Uri $userURI -Method get -Headers $headers | ConvertTo-Json -Depth 10 | Write-Host

"Changing $($testUsername)'s password to '$($testPassword2)' and adding the following functions: $(($newFunctions -join ', '))...." | Write-Host -ForegroundColor Cyan
Invoke-RestMethod -Uri $userURI -Method Patch -Body (@{
    auth = @{
        type = "password"
        password = $testPassword2
    }
    functions = $newFunctions
} | ConvertTo-Json ) -ContentType application/json -Headers $headers | ConvertTo-Json -Depth 10 | write-Host

"Getting authentication token for $($testUsername)..." | Write-Host -ForegroundColor Cyan
$token2 = Invoke-RestMethod -Uri "$($hostname)/api/auth" -Body (@{ name = $testUsername; password = $testPassword2 } | ConvertTo-Json -Depth 10) -Method Post -ContentType application/json
$token2 | ConvertTo-Json -Depth 10 | Write-Host

"Getting identity for $($testUsername) using /api/auth/identity/me endpoint..." | Write-Host -ForegroundColor Cyan
Invoke-RestMethod -Uri "$($hostname)/api/auth/identity/me" -Method Get -Headers @{ authorization = "bearer $($token2.token)" } | ConvertTo-Json -Depth 10 | Write-Host

"Removing $($testUsername)..." | Write-Host -ForegroundColor Cyan
Invoke-RestMethod -Uri $userURI -Method Delete -Headers $headers | ConvertTo-Json -Depth 10 | Write-Host

"Getting new user list..." | Write-Host -ForegroundColor Cyan
Invoke-RestMethod -Uri "$($hostname)/api/auth/identity/" -Method get -Headers $headers | ConvertTo-Json -Depth 10 | Write-Host