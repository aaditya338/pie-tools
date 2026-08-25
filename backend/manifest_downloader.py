import os
import sys
import shutil
import subprocess
import urllib.request
import zipfile
import io
import time

WORKER_URL = "https://icy-recipe-de02.aadityachoudhary333.workers.dev"

def download_manifest(appid, steam_path, temp_dir):
    url = f"{WORKER_URL}/api/download/{appid}"
    success_file = os.path.join(temp_dir, f"sd_success_{appid}.txt")
    error_file = os.path.join(temp_dir, f"sd_error_{appid}.txt")
    
    # Clean old files
    for f in [success_file, error_file]:
        if os.path.isfile(f):
            try: os.remove(f)
            except: pass

    try:
        bin_path = os.path.join(temp_dir, f"sd_dl_{appid}.bin")
        extract_dir = os.path.join(temp_dir, f"sd_ext_{appid}")
        
        if os.path.exists(extract_dir):
            try: shutil.rmtree(extract_dir)
            except: pass
        os.makedirs(extract_dir, exist_ok=True)

        print(f"[*] Downloading manifest for AppID {appid} from {url}...")
        
        # Method 1: curl.exe (fast & supports redirects)
        curl = shutil.which("curl") or r"C:\Windows\system32\curl.exe"
        downloaded = False
        if os.path.isfile(curl):
            res = subprocess.run([
                curl, "-s", "-k", "-L", "--ssl-no-revoke",
                "-A", "PieTools-Plugin/1.0",
                "-o", bin_path, url
            ], capture_output=True, timeout=30)
            if res.returncode == 0 and os.path.isfile(bin_path) and os.path.getsize(bin_path) > 20:
                downloaded = True

        # Method 2: Python urllib fallback
        if not downloaded:
            req = urllib.request.Request(url, headers={"User-Agent": "PieTools-Plugin/1.0"})
            with urllib.request.urlopen(req, timeout=30) as response:
                data = response.read()
                with open(bin_path, "wb") as f:
                    f.write(data)
                downloaded = True

        if not downloaded or not os.path.isfile(bin_path) or os.path.getsize(bin_path) < 20:
            raise RuntimeError(f"No manifest package is available for AppID {appid} on server.")

        with open(bin_path, "rb") as f:
            data = f.read()

        # Check for JSON error body
        if data.strip().startswith(b"{"):
            try:
                import json
                obj = json.loads(data.decode("utf-8", errors="ignore"))
                if "error" in obj:
                    raise RuntimeError(obj["error"])
            except:
                pass

        # Locate zip signature
        idx = data.find(b"PK\x03\x04")
        if idx == -1:
            raise RuntimeError("Invalid manifest package format received from server.")

        zip_data = data[idx:]
        with zipfile.ZipFile(io.BytesIO(zip_data)) as z:
            z.extractall(extract_dir)

        # Move .lua files into Steam/config/stplug-in
        stplug_dir = os.path.join(steam_path, "config", "stplug-in")
        os.makedirs(stplug_dir, exist_ok=True)
        backup_dir = os.path.join(stplug_dir, "backups", str(appid))
        os.makedirs(backup_dir, exist_ok=True)

        for root, _, files in os.walk(extract_dir):
            for file in files:
                if file.endswith(".lua"):
                    src = os.path.join(root, file)
                    with open(src, "r", encoding="utf-8", errors="ignore") as f:
                        lines = f.readlines()
                    
                    # Comment out setManifestid
                    new_lines = []
                    for line in lines:
                        if line.strip().startswith("setManifestid("):
                            new_lines.append("--" + line)
                        else:
                            new_lines.append(line)
                    
                    dst = os.path.join(stplug_dir, file)
                    if os.path.isfile(dst):
                        ts = time.strftime("%Y%m%d_%H%M%S")
                        try:
                            shutil.copy2(dst, os.path.join(backup_dir, f"{appid}_{ts}.lua"))
                        except:
                            pass
                    
                    with open(dst, "w", encoding="utf-8") as f:
                        f.writelines(new_lines)
                    print(f"[+] Installed {file} -> {stplug_dir}")

        # Cleanup
        try: shutil.rmtree(extract_dir)
        except: pass
        try: os.remove(bin_path)
        except: pass

        with open(success_file, "w", encoding="utf-8") as f:
            f.write("SUCCESS")
        print(f"[+] Successfully unlocked AppID {appid}")

    except Exception as e:
        err_msg = str(e)
        print(f"[-] Error: {err_msg}")
        with open(error_file, "w", encoding="utf-8") as f:
            f.write(err_msg)

if __name__ == "__main__":
    if len(sys.argv) < 3:
        print("Usage: python manifest_downloader.py <appid> <steam_path> [temp_dir]")
        sys.exit(1)
    
    appid_arg = sys.argv[1]
    steam_arg = sys.argv[2]
    temp_arg = sys.argv[3] if len(sys.argv) > 3 else os.environ.get("TEMP", r"C:\Windows\Temp")
    
    download_manifest(appid_arg, steam_arg, temp_arg)
