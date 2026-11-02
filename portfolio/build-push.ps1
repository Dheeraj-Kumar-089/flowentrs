param(
  [string] $Tag = 'v1'
)

$ErrorActionPreference = 'Stop'
if ($Tag -notmatch '^v[1-9][0-9]*$') {
  throw 'Use a numeric release tag such as v1, v2, or v3.'
}

$region = 'ap-south-1'
$registry = '360821545863.dkr.ecr.ap-south-1.amazonaws.com'
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$images = [ordered]@{
  'ai-orchestration' = 'ai-orchestration'
  'auth' = 'auth'
  'notification' = 'notification'
  'agent' = 'sandbox/agent'
  'sync-agent' = 'sandbox/sync-agent'
  'router' = 'sandbox/router'
  'sandbox' = 'sandbox/server'
  'template' = 'sandbox/template'
}

foreach ($name in $images.Keys) {
  $existing = aws ecr list-images --repository-name $name --region $region --query "imageIds[?imageTag=='$Tag'].imageTag" --output text
  if ($LASTEXITCODE -ne 0) { throw "Unable to read ECR repository $name." }
  if ($existing) {
    throw "$name`:$Tag already exists in ECR. Choose the next numeric version to preserve rollback."
  }
}

aws ecr get-login-password --region $region | docker login --username AWS --password-stdin $registry
if ($LASTEXITCODE -ne 0) { throw 'ECR login failed.' }

foreach ($name in $images.Keys) {
  $context = Join-Path $repoRoot $images[$name]
  docker build --platform linux/amd64 -f (Join-Path $context 'dockerfile') -t "$registry/$name`:$Tag" $context
  if ($LASTEXITCODE -ne 0) { throw "Build failed for $name." }
}

foreach ($name in $images.Keys) {
  docker push "$registry/$name`:$Tag"
  if ($LASTEXITCODE -ne 0) { throw "Push failed for $name." }
}

Write-Output "Pushed all eight images with immutable release tag $Tag."
