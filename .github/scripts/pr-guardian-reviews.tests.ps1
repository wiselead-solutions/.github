# Offline test for the PR Guardian review policy (ai-org#170 policy v2 step 1; pilot dev-hub#2779/#2781).
# Run: pwsh -File .github/scripts/pr-guardian-reviews.tests.ps1
$ErrorActionPreference = 'Stop'
$wf = Join-Path $PSScriptRoot '../workflows/pr-guardian.yml'
$text = (Get-Content -LiteralPath $wf -Raw) -replace "`r`n", "`n"
$fail = 0
function Expect($name, $actual, $expected) {
    if ($actual -ne $expected) { Write-Host "FAIL $name (got $actual, want $expected)"; $script:fail++ } else { Write-Host "ok   $name" }
}

# Static: never request changes, blocked verdict is a COMMENT review, dismissal runs on the blocked path too.
Expect 'no --request-changes remains' ($text -match 'request-changes') $false
Expect 'blocked verdict posted as --comment' ($text -match "'post the blocked verdict'" -and $text -match "'--comment', '--body', \`$comment\) 'post the blocked verdict'") $true
$blocked = [regex]::Match($text, '(?s)function Set-GuardianBlocked.*?\n          \}\n').Value
Expect 'Set-GuardianBlocked found (positive control)' ($blocked.Length -gt 0) $true
Expect 'blocked path dismisses stale reviews' ($blocked -match 'Remove-StaleGuardianReviews') $true
Expect 'pass path dismisses stale reviews' ($text -match "Remove-StaleGuardianReviews \`$NUM 'Superseded: PR Guardian re-audited this PR and it now passes") $true
Expect 'unchanged-verdict suppression kept' ($blocked -match 'Test-GuardianVerdictChanged') $true

# Functional: run the real function against a fake gh.
$fn = [regex]::Match($text, '(?s)# stale-review-dismissal:start\n(.*?)# stale-review-dismissal:end').Groups[1].Value
Expect 'dismissal function extracted (positive control)' ($fn.Length -gt 0) $true
$env:GITHUB_REPOSITORY = 'example/repo'
function Run-Case([string[]]$ids, [string]$dismissFailsFor, [string]$failText) {
    $script:calls = @(); $script:ids = $ids; $script:dismissFailsFor = $dismissFailsFor; $script:failText = $failText
    $script:ghFailures = @()
    function global:gh {
        $a = @($args)
        if ($a -contains 'PUT') {
            $script:calls += ($a -join ' ')
            if ($script:dismissFailsFor -and ($a -join ' ') -match "reviews/$($script:dismissFailsFor)/") { $global:LASTEXITCODE = 1; return $script:failText }
            $global:LASTEXITCODE = 0; return '{}'
        }
        $global:LASTEXITCODE = 0
        return ($script:ids -join "`n")
    }
    . ([scriptblock]::Create($fn))
    Remove-StaleGuardianReviews 7 'msg'
}
Run-Case @('11', '12') '' ''
Expect 'stale CHANGES_REQUESTED reviews each dismissed' @($script:calls | Where-Object { $_ -match 'dismissals' }).Count 2
Expect 'no failures recorded on success' $script:ghFailures.Count 0
Run-Case @() '' ''
Expect 'nothing to dismiss -> no PUT' $script:calls.Count 0
Run-Case @('21') '21' 'Can not dismiss a dismissed pull request review'
Expect 'already-dismissed is benign' $script:ghFailures.Count 0
Run-Case @('31') '31' 'boom'
Expect 'real dismissal failure is counted' $script:ghFailures.Count 1
Remove-Item function:global:gh -ErrorAction SilentlyContinue
if ($fail) { exit 1 }
