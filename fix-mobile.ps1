# fix-mobile.ps1
# Three small UI fixes:
#   1. Nav bar stacks on mobile (logo top row, links second row)
#   2. Champions browser 4 cols on phone (was 2)
#   3. Class & rank sort uses name A-Z within rank (was sig/BHR)
#
# Run from prestige-tools-v0.12.1/ root.

$ErrorActionPreference = 'Stop'

function Edit-File {
  param([string]$Path, [string]$Old, [string]$New, [string]$Label)
  $content = Get-Content $Path -Raw
  if ($content -notmatch [regex]::Escape($Old)) {
    Write-Host "FAIL: $Label — old content not found in $Path" -ForegroundColor Red
    return $false
  }
  $newContent = $content -replace [regex]::Escape($Old), $New
  Set-Content -Path $Path -Value $newContent -NoNewline
  Write-Host "OK:   $Label" -ForegroundColor Green
  return $true
}

# 1. Layout nav: stack on mobile
$ok1 = Edit-File `
  -Path "apps/web/app/layout.tsx" `
  -Label "Mobile-responsive nav" `
  -Old '<nav className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">' `
  -New '<nav className="max-w-6xl mx-auto px-4 sm:px-6 py-3 sm:py-4 flex flex-col sm:flex-row items-center gap-2 sm:gap-0 sm:justify-between">'

$ok2 = Edit-File `
  -Path "apps/web/app/layout.tsx" `
  -Label "Nav links: smaller gap on mobile, no-wrap" `
  -Old '<ul className="flex gap-6 text-sm font-medium">' `
  -New '<ul className="flex gap-4 sm:gap-6 text-sm font-medium whitespace-nowrap">'

# 2. Champions browser: 4 cols on phone, tighter card content
$ok3 = Edit-File `
  -Path "apps/web/components/champions-browser.tsx" `
  -Label "Champions grid: 4 cols on phone" `
  -Old '<div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-2">' `
  -New '<div className="grid grid-cols-4 sm:grid-cols-5 md:grid-cols-6 lg:grid-cols-7 xl:grid-cols-8 gap-1.5">'

$ok4 = Edit-File `
  -Path "apps/web/components/champions-browser.tsx" `
  -Label "Champions card: line-clamp + tighter margins" `
  -Old '<div className="mt-1.5 text-xs sm:text-sm font-medium leading-tight px-1">' `
  -New '<div className="mt-1 text-[11px] sm:text-sm font-medium leading-tight line-clamp-2">'

# 3. Shared view: class & rank sort uses name within rank
$oldSort = @'
      case 'class':
        // Class A→Z, then rank desc, then sig desc, then BHR desc within each tier.
        // Useful for AW planning where defenses are class-restricted.
        return list.sort((a, b) => {
          const cls = a.champion.class.localeCompare(b.champion.class);
          if (cls !== 0) return cls;
          if (a.state.rank !== b.state.rank) return b.state.rank - a.state.rank;
          if (a.state.sig !== b.state.sig) return b.state.sig - a.state.sig;
          return b.bhr - a.bhr;
        });
'@

$newSort = @'
      case 'class':
        // Class A→Z, then rank desc, then name A→Z within rank.
        // Useful for AW planning where defenses are class-restricted —
        // group by class so you can scan availability, then rank desc so
        // your strongest options come first, then alphabetical name within
        // a rank tier so champions are predictably ordered.
        return list.sort((a, b) => {
          const cls = a.champion.class.localeCompare(b.champion.class);
          if (cls !== 0) return cls;
          if (a.state.rank !== b.state.rank) return b.state.rank - a.state.rank;
          return a.champion.name.localeCompare(b.champion.name);
        });
'@

$ok5 = Edit-File `
  -Path "apps/web/components/shared-roster-view.tsx" `
  -Label "Class & rank sort: alphabetical within rank" `
  -Old $oldSort `
  -New $newSort

Write-Host ""
$total = @($ok1, $ok2, $ok3, $ok4, $ok5)
$pass = ($total | Where-Object { $_ -eq $true }).Count
$fail = $total.Count - $pass

if ($fail -eq 0) {
  Write-Host "All 5 edits applied successfully." -ForegroundColor Green
  Write-Host ""
  Write-Host "Next: commit and push to deploy." -ForegroundColor Cyan
  Write-Host "  git add -A" -ForegroundColor Cyan
  Write-Host "  git commit -m `"Mobile fixes: responsive nav, 4-col champions grid, class+rank sort tweak`"" -ForegroundColor Cyan
  Write-Host "  git push" -ForegroundColor Cyan
} else {
  Write-Host "$fail of $($total.Count) edits FAILED. Check the messages above." -ForegroundColor Red
}
