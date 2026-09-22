"""PostureGuard Gripper Verification Script.

Tests the calibrated MG90S gripper claw on Channel 5:
- OPEN command (75°: controlled ~2cm opening, no strain on linkage)
- CLOSE command (40°: firm clamp where claw tips meet)
- GETGRIPPER command (queries calibrated angles)
"""

import time
import sys
import serial

PORT = "COM13"
BAUD = 115200

def main():
    print("=" * 60)
    print(" PostureGuard - Calibrated Gripper Verification")
    print(f" Connecting to {PORT} ({BAUD} baud)...")
    print("=" * 60)

    try:
        ser = serial.Serial(PORT, BAUD, timeout=1.0)
    except Exception as e:
        print(f"\n[!] Error opening {PORT}: {e}")
        print("    If backend, CV, or Serial Monitor is running, please close it first.")
        return 1

    print("Waiting 2.5s for Arduino Uno to settle...")
    time.sleep(2.5)

    while ser.in_waiting:
        line = ser.readline().decode('ascii', errors='replace').strip()
        if line:
            print(f"[boot] {line}")

    def send(cmd):
        print(f"\n>>> SEND: {cmd}")
        ser.reset_input_buffer()
        ser.write((cmd + "\n").encode('ascii'))
        ser.flush()
        time.sleep(0.2)
        start = time.time()
        resp = []
        while time.time() - start < 3.0:
            if ser.in_waiting:
                line = ser.readline().decode('ascii', errors='replace').strip()
                if line:
                    print(f"    [arduino] {line}")
                    resp.append(line)
                    if any(x in line for x in ["_OK", "ERROR_", "GRIPPER_ANGLES"]):
                        break
            time.sleep(0.05)
        return resp

    # 1. Query calibrated angles
    send("GETGRIPPER")
    send("STATUS")

    # 2. Test gentle controlled OPEN
    print("\n[Step 1] Opening Gripper (OPEN -> 75° gentle opening)...")
    send("OPEN")
    time.sleep(2.5)

    # 3. Test firm CLOSE
    print("\n[Step 2] Closing Gripper (CLOSE -> 40° firm clamp)...")
    send("CLOSE")
    time.sleep(2.5)

    # 4. Cycle once more to verify repeatability
    print("\n[Step 3] Opening Gripper again (OPEN -> 75°)...")
    send("OPEN")
    time.sleep(2.5)

    print("\n[Step 4] Closing Gripper again (CLOSE -> 40°)...")
    send("CLOSE")
    time.sleep(2.0)

    ser.close()
    print("\n" + "=" * 60)
    print(" Test complete! Serial port closed safely.")
    print("=" * 60)
    return 0

if __name__ == "__main__":
    sys.exit(main())
