#!/usr/bin/env bash
# Windows' toast notifications, such as Firefox asking to be pinned to the
# taskbar, are read by NVDA as soon as they appear, over whatever a step
# makes it say. They're turned off for the user the jobs run as.
set -euo pipefail
reg add "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\PushNotifications" //v ToastEnabled //t REG_DWORD //d 0 //f
