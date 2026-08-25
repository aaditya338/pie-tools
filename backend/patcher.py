import urllib.request, urllib.error, urllib.parse, json, os, sys, subprocess, tempfile, shutil, zipfile

WORKER = "https://icy-recipe-de02.aadityachoudhary333.workers.dev"
STEAM_PATH = r"C:\Program Files (x86)\Steam"
SEVEN_ZIP = os.path.join(STEAM_PATH, "millennium", "plugins", "PieTools", "backend", "7z.exe")

def find_game_dir(appid):
    """Find game install directory via registry or Steam library folders."""
    import winreg
    for hive in [winreg.HKEY_LOCAL_MACHINE, winreg.HKEY_CURRENT_USER]:
        for wow in ["", "\\WOW6432Node"]:
            try:
                key_path = rf"SOFTWARE{wow}\Microsoft\Windows\CurrentVersion\Uninstall\Steam App {appid}"
                with winreg.OpenKey(hive, key_path) as key:
                    loc = winreg.QueryValueEx(key, "InstallLocation")[0]
                    if loc and os.path.isdir(loc):
                        return loc
            except (OSError, FileNotFoundError):
                pass

    vdf_path = os.path.join(STEAM_PATH, "steamapps", "libraryfolders.vdf")
    lib_paths = [STEAM_PATH]
    if os.path.isfile(vdf_path):
        import re
        with open(vdf_path, "r", encoding="utf-8", errors="ignore") as f:
            content = f.read()
        for m in re.finditer(r'"path"\s+"([^"]+)"', content):
            p = m.group(1).replace("\\\\", "\\")
            if p not in lib_paths:
                lib_paths.append(p)

    for lib in lib_paths:
        manifest = os.path.join(lib, "steamapps", f"appmanifest_{appid}.acf")
        if os.path.isfile(manifest):
            import re
            with open(manifest, "r", encoding="utf-8", errors="ignore") as f:
                content = f.read()
            m = re.search(r'"installdir"\s+"([^"]+)"', content)
            if m:
                game_dir = os.path.join(lib, "steamapps", "common", m.group(1))
                if os.path.isdir(game_dir):
                    return game_dir
    return None

def download_file(url, dest, part_num, total):
    print(f"\n[*] Downloading Fix Part {part_num} of {total}...")
    curl = shutil.which("curl") or r"C:\Windows\system32\curl.exe"
    if os.path.isfile(curl):
        result = subprocess.run(
            [curl, "-k", "--ssl-no-revoke", "--tlsv1.2", "-#", "-L",
             "-A", "PieTools-Plugin/1.0", "-o", dest, url],
            capture_output=False
        )
        if result.returncode == 0 and os.path.isfile(dest) and os.path.getsize(dest) > 0:
            size = os.path.getsize(dest)
            print(f"[+] Downloaded {size:,} bytes")
            return True
    
    print("[~] curl failed, trying urllib...")
    req = urllib.request.Request(url, headers={"User-Agent": "PieTools-Plugin/1.0"})
    try:
        resp = urllib.request.urlopen(req, timeout=300)
        total_size = int(resp.headers.get("content-length", 0))
        downloaded = 0
        with open(dest, "wb") as f:
            while True:
                chunk = resp.read(1024 * 1024)
                if not chunk:
                    break
                f.write(chunk)
                downloaded += len(chunk)
                if total_size > 0:
                    pct = downloaded * 100 // total_size
                    print(f"\r    {downloaded:,} / {total_size:,} bytes ({pct}%)", end="", flush=True)
        print()
        print(f"[+] Downloaded {downloaded:,} bytes")
        return True
    except Exception as e:
        print(f"[!] Download failed: {e}")
        return False

def extract_archives(temp_dir, game_dir, password=None):
    files = sorted(os.listdir(temp_dir))
    print(f"[*] Files in temp: {files}")
    
    # Look for .zip (main split archive header) or .rar or .7z
    main_archive = None
    for f in files:
        if f.endswith(".zip") or f.endswith(".rar") or f.endswith(".7z"):
            main_archive = os.path.join(temp_dir, f)
            break
    if not main_archive and files:
        main_archive = os.path.join(temp_dir, files[0])
    
    print(f"[*] Extracting main archive: {main_archive}")
    
    if os.path.isfile(SEVEN_ZIP):
        passwords = [password] if password else []
        passwords.extend(["", "online-fix.me", "Contrary", "cs.rin.ru"])
        for pwd in passwords:
            cmd = [SEVEN_ZIP, "x", main_archive, "-y", f"-o{game_dir}"]
            if pwd:
                cmd.append(f"-p{pwd}")
            print(f"[*] Trying 7z command: {' '.join(cmd)}")
            result = subprocess.run(cmd, capture_output=True, text=True)
            print(f"7z exit code: {result.returncode}")
            if result.stdout:
                print(f"7z output: {result.stdout[:500]}")
            if result.stderr:
                print(f"7z error: {result.stderr[:500]}")
            if result.returncode < 2:
                return True
        return False
    return False

def patch_game(appid):
    print("=" * 50)
    print("  Clean Game Patcher")
    print("=" * 50)
    print()

    game_dir = find_game_dir(appid)
    if not game_dir:
        print(f"[!] Could not find game directory for AppID {appid}")
        print("[!] Make sure the game is installed via Steam.")
        return False
    print(f"[*] Game directory found: {game_dir}")

    print("[*] Contacting server...")
    try:
        req = urllib.request.Request(
            f"{WORKER}/api/patch/{appid}",
            headers={"User-Agent": "PieTools-Plugin/1.0"}
        )
        resp = urllib.request.urlopen(req, timeout=15)
        data = json.loads(resp.read().decode("utf-8"))
    except Exception as e:
        print(f"[!] Server error: {e}")
        return False

    if not data.get("success") or not data.get("ddls"):
        print("[!] No fix available for this AppID.")
        return False

    ddls = data["ddls"]
    password = data.get("password")
    print(f"[*] Found {len(ddls)} fix part(s) to download.")

    temp_dir = os.path.join(tempfile.gettempdir(), f"patch_{appid}")
    os.makedirs(temp_dir, exist_ok=True)

    try:
        for idx, url in enumerate(ddls):
            part_num = idx + 1
            # Extract real filename from URL
            parsed = urllib.parse.unquote(url.split("?")[0])
            real_filename = os.path.basename(parsed)
            if not real_filename or "." not in real_filename:
                real_filename = f"part_{idx}.zip"
            
            dest = os.path.join(temp_dir, real_filename)
            print(f"[*] Target file path: {dest}")

            if not download_file(url, dest, part_num, len(ddls)):
                print(f"[!] Failed to download part {part_num}")
                return False

        print("\n[*] Extracting files to game directory...")
        if extract_archives(temp_dir, game_dir, password):
            # Create bypass indicator
            with open(os.path.join(game_dir, "bypass_applied.txt"), "w") as f:
                f.write("true")
            print()
            print("=" * 50)
            print("  [+] ALL PATCHES APPLIED SUCCESSFULLY!")
            print("  --> You can now launch the game normally through Steam.")
            print("=" * 50)
            return True
        else:
            print("[!] Extraction failed")
            return False

    finally:
        shutil.rmtree(temp_dir, ignore_errors=True)

if __name__ == "__main__":
    if len(sys.argv) < 2:
        appid = input("Enter AppID: ").strip()
    else:
        appid = sys.argv[1]

    if not appid.isdigit():
        print("[!] Invalid AppID")
        sys.exit(1)

    success = patch_game(appid)
    sys.exit(0 if success else 1)
