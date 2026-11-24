#!/usr/bin/env bash
# A fresh Firefox opens its Terms of Use and onboarding over the page, where
# the screen reader would read them instead. Firefox's own enterprise
# policies, read from its distribution folder, skip them.
#
# The runner starts Firefox once per job and ends it with taskkill /F, which
# Firefox takes for a crash: a later launch would restore the old tabs, so
# it doesn't restore. Its welcome, upgrade and default-browser prompts,
# where it asks to be pinned to the taskbar, are off too: NVDA read that
# prompt over the page.
set -euo pipefail
dir="/c/Program Files/Mozilla Firefox/distribution"
mkdir -p "$dir"
cat > "$dir/policies.json" <<'JSON'
{
  "policies": {
    "SkipTermsOfUse": true,
    "DontCheckDefaultBrowser": true,
    "DisableTelemetry": true,
    "OverrideFirstRunPage": "",
    "OverridePostUpdatePage": "",
    "Preferences": {
      "browser.sessionstore.resume_from_crash": { "Value": false, "Status": "locked" },
      "browser.shell.checkDefaultBrowser": { "Value": false, "Status": "locked" },
      "browser.startup.upgradeDialog.enabled": { "Value": false, "Status": "locked" },
      "browser.aboutwelcome.enabled": { "Value": false, "Status": "locked" }
    },
    "UserMessaging": {
      "SkipOnboarding": true,
      "ExtensionRecommendations": false,
      "FeatureRecommendations": false,
      "MoreFromMozilla": false
    }
  }
}
JSON
"/c/Program Files/Mozilla Firefox/firefox.exe" --version || true
