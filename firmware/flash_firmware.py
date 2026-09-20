import os
import sys
import time
import subprocess
import serial.tools.list_ports
import serial

print("=" * 60)
print("   PostureGuard - Flashing Phase 5 Firmware to Arduino Uno")
print("=" * 60)

FIRMWARE_DIR = os.path.dirname(os.path.abspath(__file__))
HEX_PATH = os.path.join(FIRMWARE_DIR, "build_output", "uno", "firmware.hex")

if not os.path.exists(HEX_PATH):
    print(f"[!] Error: firmware.hex not found at: {HEX_PATH}")
    sys.exit(1)

AVRDUDE = r"C:\Rishabh\RKDM\avrdude_x64\avrdude.exe"
AVRCONF = r"C:\Rishabh\RKDM\avrdude_x64\avrdude.conf"

def find_arduino_port():
    ports = serial.tools.list_ports.comports()
    for p in ports:
        desc = p.description.lower()
        if "ch340" in desc or "arduino" in desc or "usb-serial" in desc:
            return p.device
    # Fallback to COM13 if present
    for p in ports:
        if p.device.upper() == "COM13":
            return "COM13"
    return None

port = find_arduino_port()
if not port:
    print("[!] Arduino Uno not found. Available COM ports:")
    for p in serial.tools.list_ports.comports():
        print(f"    - {p.device}: {p.description}")
    sys.exit(1)

print(f"[+] Detected Arduino Uno on port: {port}")

# Test port access
print(f"Checking access to {port}...")
accessible = False
for attempt in range(10):
    try:
        s = serial.Serial(port, 115200, timeout=0.5)
        s.close()
        accessible = True
        break
    except Exception as e:
        print(f"    Attempt {attempt+1}: Port busy ({e}), retrying in 1s...")
        time.sleep(1)

if not accessible:
    print(f"[!] Cannot open {port}. Ensure no other program (e.g. Serial Monitor) is using it.")
    sys.exit(1)

print(f"[+] {port} is accessible! Flashing {HEX_PATH}...")
time.sleep(1.0)

cmd = [
    AVRDUDE,
    "-C", AVRCONF,
    "-v",
    "-p", "m328p",
    "-c", "arduino",
    "-P", port,
    "-b", "115200",
    "-D",
    f"-Uflash:w:{HEX_PATH}:i"
]

res = subprocess.run(cmd)
if res.returncode == 0:
    print("\n" + "=" * 60)
    print(f">>> SUCCESS: Firmware successfully flashed to {port}! <<<")
    print("=" * 60)
else:
    print(f"\n[!] avrdude failed with code: {res.returncode}")
    sys.exit(res.returncode)
