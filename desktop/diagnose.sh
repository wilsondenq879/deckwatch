#!/usr/bin/env bash
# Run from Steam Deck Desktop Mode. Changes no settings; logs remain on this device.
set -uo pipefail
app_dir="${XDG_DATA_HOME:-$HOME/.local/share}/deck-watch-app"
app_binary="$app_dir/deck-watch-bin"
log_file="$HOME/deck-watch-startup.log"
if [[ ! -x "$app_binary" ]]; then
  printf '找不到已安裝的 App：%s\n請先安裝 Deck Watch。\n' "$app_binary"
  exit 1
fi
if [[ -z "${DISPLAY:-}" ]]; then
  printf '沒有找到桌面顯示環境。請在 Steam Deck 桌面模式的 Konsole 執行。\n'
  exit 1
fi
umask 077
{
  printf 'Deck Watch startup diagnosis\n'
  printf 'Architecture: %s\nSession: %s\n' "$(uname -m)" "${XDG_SESSION_TYPE:-unknown}"
  printf 'App version: '
  if command -v python3 >/dev/null 2>&1; then
    python3 -c 'import json,sys;print(json.load(open(sys.argv[1]))["version"])' "$app_dir/resources/app/package.json"
  else printf 'unknown\n'; fi
  if command -v ldd >/dev/null 2>&1; then
    missing="$(ldd "$app_binary" 2>/dev/null | awk '/not found/ {print}')"
    if [[ -n "$missing" ]]; then printf 'Missing libraries:\n%s\n' "$missing"; fi
  fi
  printf 'Sandbox helper: '
  stat -c '%a %U' "$app_dir/chrome-sandbox" 2>/dev/null || true
  printf '\nStarting an X11/XWayland window; no security settings changed.\n'
} > "$log_file" 2>&1
printf '正在以 XWayland 測試啟動。\n如果視窗開啟，代表 App 可啟動，接著調整 Steam 啟動方式。\n如果失敗，請拍下這個終端機的錯誤訊息。\n紀錄：%s\n\n' "$log_file"
env -u ELECTRON_RUN_AS_NODE "$app_binary" --class=deck-watch --ozone-platform=x11 --enable-logging=stderr 2>&1 | tee -a "$log_file"
app_result=${PIPESTATUS[0]}
printf '\nApp 結束碼：%s\n' "$app_result" | tee -a "$log_file"
if [[ "$app_result" -ne 0 ]]; then
  printf '請將上方錯誤訊息拍給我；先不用重裝，也不要加入 --no-sandbox。\n'
fi
exit "$app_result"
