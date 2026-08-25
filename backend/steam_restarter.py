import time, os, subprocess

log_path = r"C:\ProgramData\PieTools\tmp\restart_debug.log"

def log(m):
    try:
        with open(log_path, "a", encoding="utf-8") as f:
            f.write(f"[{time.strftime('%Y-%m-%d %H:%M:%S')}] {m}\n")
    except:
        pass

def main():
    log("steam_restarter started")
    steam_exe = r"C:\Program Files (x86)\Steam\steam.exe"
    steam_dir = r"C:\Program Files (x86)\Steam"

    # Step 1: Send shutdown asynchronously
    try:
        subprocess.Popen([steam_exe, "-shutdown"], cwd=steam_dir)
        log("Issued async steam.exe -shutdown")
    except Exception as e:
        log(f"Error sending shutdown: {e}")

    # Step 2: Poll tasklist until steam exits
    steam_stopped = False
    for i in range(40):
        time.sleep(0.5)
        try:
            r = subprocess.run(["tasklist", "/FI", "IMAGENAME eq steam.exe"], capture_output=True, text=True, timeout=5)
            if "steam.exe" not in r.stdout:
                log(f"Steam stopped after {(i+1)*0.5}s")
                steam_stopped = True
                break
        except Exception as e:
            log(f"tasklist err: {e}")

    if not steam_stopped:
        log("Steam did not stop within 20s, terminating lingering processes")
        subprocess.run(["taskkill", "/F", "/IM", "steam.exe", "/IM", "steamwebhelper.exe"], capture_output=True)
        time.sleep(1)

    # Step 3: Wait 1.5s for OS to release all socket / file locks
    time.sleep(1.5)

    # Step 4: Relaunch Steam using cmd start
    log("Relaunching Steam...")
    try:
        subprocess.Popen(["cmd.exe", "/c", "start", "", steam_exe], cwd=steam_dir)
        log("cmd.exe start executed")
    except Exception as e:
        log(f"cmd start error: {e}")

    time.sleep(3)
    # Check if steam is back up
    try:
        r2 = subprocess.run(["tasklist", "/FI", "IMAGENAME eq steam.exe"], capture_output=True, text=True, timeout=5)
        if "steam.exe" in r2.stdout:
            log("SUCCESS: Steam is running!")
        else:
            log("Steam not running after cmd start, launching via explorer.exe steam://open/main")
            subprocess.Popen(["explorer.exe", "steam://open/main"])
    except:
        pass

if __name__ == "__main__":
    main()
