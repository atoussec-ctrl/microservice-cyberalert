# Creates semantic commits, pushes the branch, and opens a PR.
# Run from the microservice-cyberalert repository root:
#   powershell -ExecutionPolicy Bypass -File scripts/release.ps1
$ErrorActionPreference = "Stop"
Set-Location (Split-Path $PSScriptRoot -Parent)

$authorName = git log -1 --format="%an" main
$authorEmail = git log -1 --format="%ae" main
$env:GIT_AUTHOR_NAME = $authorName
$env:GIT_AUTHOR_EMAIL = $authorEmail
$env:GIT_COMMITTER_NAME = $authorName
$env:GIT_COMMITTER_EMAIL = $authorEmail

$branch = git branch --show-current
if ($branch -ne "feat/swagger-postman-and-infra") {
  Write-Host "Expected branch feat/swagger-postman-and-infra (current: $branch)"
  exit 1
}

function Commit($paths, $title, $body) {
  git add @paths
  if (-not (git diff --cached --quiet)) {
    git commit -m $title -m $body
  }
}

Commit @(
  ".env.example",
  "docker-compose.yml",
  ".gitattributes",
  "scripts/localstack-init.sh"
) "chore(infra): upgrade LocalStack to 4.4.0 and use port 3001" "Fix LocalStack startup on Windows, use awslocal in init script, add AWS credentials to compose, and default HTTP port to 3001 for coexistence with Profile Service."

Commit @(
  "scripts/publish-sample-threat.ps1"
) "feat(scripts): add PowerShell sample threat publisher" "Provide a Windows-friendly alternative to publish-sample-threat.sh for LocalStack end-to-end testing."

Commit @(
  "package.json",
  "package-lock.json",
  "src/swagger.ts",
  "src/main.ts",
  "src/health/health.controller.ts",
  "src/threats/threats.controller.ts",
  "src/threats/dto/list-threats-query.dto.ts",
  "src/threats/dto/threat-response.dto.ts",
  "docs/postman"
) "feat(docs): add Swagger OpenAPI and Postman collection" "Document REST endpoints at /api/docs and ship Postman collection and environment for health and threat queries."

Commit @(
  "scripts/release.ps1"
) "chore(scripts): add release automation for commits and PR" "Provide a local script to create semantic commits and open the pull request."

git push -u origin HEAD

$body = @"
## Summary
- Upgrade LocalStack to 4.4.0 and fix init script for Windows
- Default HTTP port to 3001 so Profile Service and Threat Triage can run together
- Add Swagger/OpenAPI documentation with response DTOs
- Add Postman collection and environment for REST endpoints
- Add PowerShell script to publish sample CRITICAL threats

## Test plan
- [x] ``npm test`` (26 tests)
- [x] ``npm run build``
- [ ] ``docker compose up -d`` and ``npm run start:dev``
- [ ] Verify Swagger at http://localhost:3001/api/docs
- [ ] Import ``docs/postman/collection.json`` and ``environment.json``
- [ ] Run ``scripts/publish-sample-threat.ps1`` and query ``GET /threats?severity=CRITICAL``
"@

gh pr create --title "feat: Swagger, Postman collection, and LocalStack 4.4.0" --body $body
