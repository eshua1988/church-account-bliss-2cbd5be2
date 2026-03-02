$log = "sync_log.txt"
if (Test-Path $log) { Remove-Item $log -Force }
Start-Transcript -Path $log -Force
Write-Output "--- START $(Get-Date -Format o) ---"
Write-Output "PWD: $(Get-Location)"
Write-Output "--- kill git.exe ---"
cmd /c "taskkill /F /IM git.exe /T" 2>&1 | Write-Output
Write-Output "--- git rebase --abort ---"
git rebase --abort 2>&1 | Write-Output
Write-Output "--- remove rebase-merge if present ---"
if (Test-Path .git\rebase-merge) { Write-Output "rm .git/rebase-merge"; Remove-Item -Recurse -Force .git\rebase-merge 2>&1 | Write-Output } else { Write-Output ".git/rebase-merge not present" }
if (Test-Path .git\rebase-apply) { Write-Output "rm .git/rebase-apply"; Remove-Item -Recurse -Force .git\rebase-apply 2>&1 | Write-Output } else { Write-Output ".git/rebase-apply not present" }
if (Test-Path .git\REBASE_HEAD) { Write-Output "rm .git/REBASE_HEAD"; Remove-Item -Force .git\REBASE_HEAD 2>&1 | Write-Output } else { Write-Output ".git/REBASE_HEAD not present" }
Write-Output "--- git status -b ---"
git status --porcelain -b 2>&1 | Write-Output
Write-Output "--- git stash push -u -m 'autosave-before-reset' ---"
git stash push -u -m "autosave-before-reset" 2>&1 | Write-Output
Write-Output "--- git fetch origin --prune ---"
git fetch origin --prune 2>&1 | Write-Output
Write-Output "--- git checkout main ---"
git checkout main 2>&1 | Write-Output
Write-Output "--- git reset --hard origin/main ---"
git reset --hard origin/main 2>&1 | Write-Output
Write-Output "--- git clean -fd ---"
git clean -fd 2>&1 | Write-Output
Write-Output "--- HEAD & recent commits ---"
git rev-parse --abbrev-ref HEAD 2>&1 | Write-Output
git log --oneline -n 5 2>&1 | Write-Output
Write-Output "--- check package-lock conflict markers ---"
if (Test-Path package-lock.json) { Select-String -Path package-lock.json -Pattern '<<<<<<<|=======|>>>>>>>' -SimpleMatch -ErrorAction SilentlyContinue | ForEach-Object { Write-Output $_.Line } } else { Write-Output 'package-lock.json not found' }
Write-Output "--- npm ci ---"
npm ci 2>&1 | Write-Output
Write-Output "--- npm run build --if-present ---"
npm run build --if-present 2>&1 | Write-Output
Write-Output "--- git status after build ---"
git status --porcelain -b 2>&1 | Write-Output
$st = git status --porcelain
if ($st) {
  Write-Output "--- Changes present, committing ---"
  git add -A 2>&1 | Write-Output
  git commit -m "chore: regenerate lockfile / apply build artifacts" 2>&1 | Write-Output
} else {
  Write-Output "--- No changes to commit ---"
}
Write-Output "--- git push origin main ---"
git push origin main 2>&1 | Write-Output
Write-Output "--- stash list ---"
git stash list 2>&1 | Write-Output
Write-Output "--- final git status ---"
git status --porcelain -b 2>&1 | Write-Output
Write-Output "--- END $(Get-Date -Format o) ---"
Stop-Transcript
Write-Output "Log saved to $log"
