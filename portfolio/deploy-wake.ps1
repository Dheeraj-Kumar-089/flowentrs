param(
  [string] $InstanceId,
  [string] $StackName = 'flowent-portfolio-wake',
  [string] $ArtifactBucket = 'flowent-frontend'
)

$ErrorActionPreference = 'Stop'
if ($InstanceId -notmatch '^i-[0-9a-f]{8,17}$') {
  throw 'Pass the dedicated demo EC2 instance ID with -InstanceId.'
}

$codePath = Join-Path $PSScriptRoot 'wake-code.local'
if (-not (Test-Path -LiteralPath $codePath)) {
  $randomBytes = New-Object byte[] 24
  $random = [System.Security.Cryptography.RandomNumberGenerator]::Create()
  try { $random.GetBytes($randomBytes) } finally { $random.Dispose() }
  $code = [BitConverter]::ToString($randomBytes).Replace('-', '').ToLowerInvariant()
  [System.IO.File]::WriteAllText($codePath, $code)
  Write-Output "Created a local access code in $codePath. Share it only with demo viewers."
}

$code = [System.IO.File]::ReadAllText($codePath).Trim()
$sha256 = [System.Security.Cryptography.SHA256]::Create()
try {
  $digest = $sha256.ComputeHash([System.Text.Encoding]::UTF8.GetBytes($code))
} finally {
  $sha256.Dispose()
}
$hash = [BitConverter]::ToString($digest).Replace('-', '').ToLowerInvariant()

$template = Join-Path $PSScriptRoot 'wake/template.yml'
$packaged = Join-Path $PSScriptRoot 'wake/packaged.yml'
aws cloudformation package --template-file $template --s3-bucket $ArtifactBucket --output-template-file $packaged --region ap-south-1
if ($LASTEXITCODE -ne 0) { throw 'Packaging the wake stack failed.' }

aws cloudformation deploy --template-file $packaged --stack-name $StackName --region ap-south-1 --capabilities CAPABILITY_IAM CAPABILITY_AUTO_EXPAND --parameter-overrides "InstanceId=$InstanceId" 'SiteOrigin=https://www.projectrs.me' "WakeCodeHash=$hash" --no-fail-on-empty-changeset
if ($LASTEXITCODE -ne 0) { throw 'Deploying the wake stack failed.' }

aws cloudformation describe-stacks --stack-name $StackName --region ap-south-1 --query 'Stacks[0].Outputs[?OutputKey==`WakeApiUrl`].OutputValue' --output text
