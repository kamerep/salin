#!/usr/bin/env bash
# Install the Salin dock launcher, icon and clipboard command for this user.
# Optional: --hotkey binds Super+Alt+T to translate the clipboard (GNOME).
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
BIN="$HOME/.local/bin"; APPS="$HOME/.local/share/applications"; ICONS="$HOME/.local/share/icons/hicolor/scalable/apps"
mkdir -p "$BIN" "$APPS" "$ICONS"
install -m 755 "$HERE/salin-open" "$BIN/salin-open"
install -m 755 "$HERE/salin-clip" "$BIN/salin-clip"
install -m 644 "$HERE/salin.svg" "$ICONS/salin.svg"
cat > "$APPS/salin.desktop" <<DESK
[Desktop Entry]
Type=Application
Name=Salin
GenericName=Tagalog translator
Comment=Translate Tagalog and Taglish messages and draft replies
Exec=$BIN/salin-open
Icon=salin
Terminal=false
Categories=Office;Utility;
Keywords=translate;tagalog;taglish;filipino;
StartupWMClass=brave-localhost__-Default
Actions=clipboard;

[Desktop Action clipboard]
Name=Translate clipboard
Exec=$BIN/salin-clip
DESK
gtk-update-icon-cache -q "$HOME/.local/share/icons/hicolor" 2>/dev/null || true
update-desktop-database -q "$APPS" 2>/dev/null || true
echo "Installed: Salin launcher (pin it to the dock from the app grid) and salin-clip."

if [ "${1:-}" = "--hotkey" ]; then
  base=/org/gnome/settings-daemon/plugins/media-keys/custom-keybindings
  path="$base/salin/"
  current="$(gsettings get org.gnome.settings-daemon.plugins.media-keys custom-keybindings)"
  if [[ "$current" != *"$path"* ]]; then
    if [[ "$current" == "@as []" || "$current" == "[]" ]]; then new="['$path']"; else new="${current%]}, '$path']"; fi
    gsettings set org.gnome.settings-daemon.plugins.media-keys custom-keybindings "$new"
  fi
  schema="org.gnome.settings-daemon.plugins.media-keys.custom-keybinding:$path"
  gsettings set "$schema" name 'Salin: translate clipboard'
  gsettings set "$schema" command "$BIN/salin-clip"
  gsettings set "$schema" binding '<Super><Alt>t'
  echo "Bound Super+Alt+T to salin-clip."
fi
