#!/usr/bin/env bash
# A fresh Firefox opens its Terms of Use and onboarding over the page, where
# the screen reader would read them instead. Firefox's own enterprise
# policies, read from its distribution folder, skip them.
#
# The runner ends Firefox with taskkill /F after each script, which Firefox
# takes for a crash: the next launch restored the last script's tab beside
# the new one, and focus started outside the page. So it doesn't restore.
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
      "browser.sessionstore.resume_from_crash": { "Value": false, "Status": "locked" }
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
