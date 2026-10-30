#!/usr/bin/env bash
set -euo pipefail
source_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
data_dir="${XDG_DATA_HOME:-$HOME/.local/share}"
install_dir="$data_dir/deck-watch-app"
bin_dir="$HOME/.local/bin"
application_dir="$data_dir/applications"
if [[ "${1:-}" == "--dry-run" ]]; then
  printf 'App: %s\nLauncher: %s\nMenu: %s\n' "$install_dir" "$bin_dir/deck-watch" "$application_dir/deck-watch.desktop"
  exit 0
fi
if [[ "$(uname -s)" != Linux || "$(uname -m)" != x86_64 ]]; then
  printf '這是 Steam Deck / Linux x86_64 安裝包。請在 Steam Deck 執行。\n' >&2
  exit 1
fi
if [[ ! -f "$source_dir/runtime/deck-watch-bin" ]]; then
  printf '安裝包不完整，請先解壓縮整個資料夾。\n' >&2
  exit 1
fi
mkdir -p "$data_dir" "$bin_dir" "$application_dir"
stage="$(mktemp -d "$data_dir/.deck-watch-install.XXXXXX")"
trap 'rm -rf -- "$stage"' EXIT
cp -R "$source_dir/runtime/." "$stage/"
chmod +x "$stage/deck-watch-bin" "$stage/chrome-sandbox" "$stage/chrome_crashpad_handler"
if [[ -e "$install_dir" ]]; then
  backup="$install_dir.backup-$(date +%Y%m%d-%H%M%S)"
  mv -- "$install_dir" "$backup"
  printf '前一版保存在 %s\n' "$backup"
fi
mv -- "$stage" "$install_dir"
trap - EXIT
printf '#!/usr/bin/env bash\nunset LD_PRELOAD\nexec %q --class=deck-watch --ozone-platform=x11 "$@"\n' "$install_dir/deck-watch-bin" > "$bin_dir/deck-watch"
chmod 755 "$bin_dir/deck-watch"
# Desktop-entry quoting differs from shell quoting.
desktop_escape() { local value="$1"; value="${value//\\/\\\\}"; value="${value//\"/\\\"}"; value="${value//\`/\\\`}"; value="${value//\$/\\\$}"; value="${value//%/%%}"; printf '%s' "$value"; }
launcher="$(desktop_escape "$bin_dir/deck-watch")"
icon_path="$install_dir/resources/app/icon.png"
cat > "$application_dir/deck-watch.desktop" <<EOF
[Desktop Entry]
Type=Application
Version=1.0
Name=Deck Watch
Comment=Multi-agent monitoring station
Exec="$launcher" --fullscreen
Icon=$icon_path
Terminal=false
Categories=Utility;Monitor;
StartupWMClass=deck-watch
EOF
chmod 755 "$application_dir/deck-watch.desktop"
art_dir="$HOME/Pictures/Deck Watch"
mkdir -p "$art_dir"
cp -R "$install_dir/resources/app/steam-art/." "$art_dir/"
desktop_dir="$(xdg-user-dir DESKTOP 2>/dev/null || true)"
if [[ -n "$desktop_dir" && -d "$desktop_dir" && "$desktop_dir" != "$HOME" ]]; then
  cp "$application_dir/deck-watch.desktop" "$desktop_dir/Deck Watch.desktop"
fi
if command -v update-desktop-database >/dev/null 2>&1; then update-desktop-database "$application_dir" >/dev/null 2>&1 || true; fi
printf '\nDeck Watch 安裝完成。\n從應用程式選單或桌面啟動 Deck Watch。\n在 Steam 加入非 Steam 遊戲，選擇 Deck Watch，即可於遊戲模式啟動。\n不需要啟用 Proton。\n首次連接需輸入 Mac 位址與原本的 8 位配對碼。\n'
