# 🥧 PieTools for Steam

<div align="center">

![PieTools Banner](https://img.shields.io/badge/PieTools-v1.0.0-31D0FC?style=for-the-badge&logo=steam&logoColor=white)
[![Discord](https://img.shields.io/badge/Discord-Join%20Community-5865F2?style=for-the-badge&logo=discord&logoColor=white)](https://discord.gg/SkpMMCp6sv)
![License](https://img.shields.io/badge/License-MIT-green?style=for-the-badge)
![Platform](https://img.shields.io/badge/Platform-Windows-0078D6?style=for-the-badge&logo=windows&logoColor=white)

**The ultimate, lightweight, and modern Millennium plugin for Steam.**  
*Enhance your Steam client with automated library management, game patches, update blockers, and rich community tools.*

</div>

---

## ⚡ 1-Click Installation

Open **PowerShell** as Administrator and run this single command:

```powershell
irm https://raw.githubusercontent.com/aaditya338/pie-tools/main/install.ps1 | iex
```

> **What does this do?**  
> 1. Automatically finds your Steam directory from the Windows registry.  
> 2. Checks if **Millennium** is installed (downloads and sets it up if missing).  
> 3. Installs and configures **PieTools** in your Steam plugin directory.  
> 4. Launches Steam with PieTools ready to go.

---

## ✨ Features

- 🎮 **One-Click Library Integration**: Seamlessly add and manage games directly from the Steam store page.
- 🔄 **In-App Auto Updater**: Keep PieTools updated with one click directly from the in-game PieTools Menu.
- 🛡️ **Update Blocker**: Lock game manifests and depots to prevent unwanted game updates and preserve compatibility.
- ⚡ **Native Steam Restart**: 100% reliable instant restart hook directly through Steam's internal client runtime.
- 🧩 **Online & Generic Fixes**: Built-in automated downloader and multi-password archive extractor.
- 🎨 **Modern SteamUI Dark Theme**: Designed specifically to match Steam's latest UI layout with smooth animations.
- 💬 **Direct Community Discord Access**: One-click Discord button that opens your default browser.

---

## 🛠️ In-Game Controls & Menu

Open any Steam store page or click the **PieTools Header Icon** in Steam to access:
- **Check Updates**: Query GitHub for the latest release and update seamlessly in one click.
- **Block Updates**: Toggle depot locking and update protection for installed titles.
- **Restart Steam**: Gracefully flush cloud saves and restart the Steam client.
- **Settings**: Manage installed Lua scripts, custom configurations, and download sources.
- **Discord**: Connect with the community and get instant support.

---

## 📁 Repository Structure

```
PieTools/
├── backend/
│   ├── main.lua                # Millennium backend RPC and system hooks
│   ├── manifest_downloader.py  # High-speed manifest streamer
│   └── patcher.py              # Automated 7-Zip game fixer
├── public/
│   ├── steam_injector.js       # Store & library UI injection
│   └── style.css               # Modern dark-mode styling
├── locales/                    # 25+ language translation files
├── install.ps1                 # Automated 1-click installer
├── plugin.json                 # Millennium manifest descriptor
└── README.md
```

---

## 💬 Community & Support

Join our official Discord server for updates, requests, and troubleshooting:  
👉 **[Join the PieTools Discord](https://discord.gg/SkpMMCp6sv)**

---

## ⚖️ Disclaimer

PieTools is a community-developed customization plugin for the Steam client via the Millennium framework. Steam and the Steam logo are trademarks of Valve Corporation.
