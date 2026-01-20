import psutil
import os

def kill_renamer_processes():
    print("Searching for renamer-api.exe processes...")
    killed = 0
    for proc in psutil.process_iter(['pid', 'name']):
        try:
            if proc.info['name'] == 'renamer-api.exe':
                print(f"Killing PID {proc.info['pid']}")
                proc.kill()
                killed += 1
        except (psutil.NoSuchProcess, psutil.AccessDenied, psutil.ZombieProcess):
            pass
            
    if killed == 0:
        print("No renamer-api.exe processes found.")
    else:
        print(f"Successfully killed {killed} processes.")

if __name__ == "__main__":
    kill_renamer_processes()
