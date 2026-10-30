# Deck Watch for Steam Deck

This is the Linux x86_64 desktop app used from SteamOS Game Mode. It runs the dashboard locally in Electron, so there is no browser chrome. It connects to a paired Deck Watch **Hub** on your LAN; the hub may aggregate Mac and Windows agent nodes.

## Install

Extract a release archive on the Steam Deck in Desktop Mode, open Konsole in the extracted directory, then run:

```bash
bash install.sh
```

The app installs to `~/.local/share/deck-watch-app`, with a launcher at `~/.local/bin/deck-watch`. It does not require sudo, Proton, npm, Python or changes to SteamOS's immutable partition.

On first launch enter the Hub's LAN address, for example `http://192.168.1.2:8765`, and its eight-digit pairing code. The app never contains a pairing code, node key, agent credential, prompt, or task cache from a release author.

## Add it to Steam

In Desktop Mode, Steam → **Add a Non-Steam Game** → select **Deck Watch**. If it is not listed, browse to `~/.local/bin/deck-watch`. Do not enable Proton. The default controller layout can be Mouse + Trackpad; touch also works.

## Privacy and offline behaviour

- Credentials and the last successful dashboard snapshot are held locally in `~/.config/deck-watch` for the current user only.
- When a paired hub is temporarily offline, the last successful snapshot stays visible but is marked offline; the clock keeps running.
- Pairing cookies expire on the hub after seven days.
- Reconnect from Settings → **Change hub or pair again**.
- Keep Screen Awake is optional and applies only while the app runs; SteamOS power management can still impose limits.

## Big Picture artwork

The installer copies the portrait, hero, and logo artwork to `~/Pictures/Deck Watch`. Apply them from Steam Desktop Mode as described in that folder's README. Updating Deck Watch does not overwrite your Steam library artwork.

## Remove

After closing Deck Watch, remove `~/.local/share/deck-watch-app`, `~/.local/bin/deck-watch`, `~/.local/share/applications/deck-watch.desktop`, and the desktop shortcut if present. Remove `~/.config/deck-watch` as well to clear the local pairing and cached snapshot.
