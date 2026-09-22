"""Test Closing Angles Script.

Sweeps downward from 30° to 0°:
  30° -> 20° -> 15° -> 10° -> 5° -> 0°
to identify the exact angle where the claw tips firmly meet.
"""

import sys
import time
import subprocess
import serial

PORT = "COM13"
BAUD = 115200

def free_port():
    print("Ensuring COM13 is free (closing any background backend)...")
    subprocess.run(["taskkill", "/F", "/FI", "WINDOWTITLE eq PostureGuard Backend*"], capture_output=True)
    subprocess.run(["taskkill", "/F", "/IM", "node.exe"], capture_output=True)
    time.sleep(1.5)

def main():
    free_port()

    print("=" * 65)
    print(" PostureGuard - Testing Closing Angles (30° down to 0°)")
    print(f" Connecting to {PORT} ({BAUD} baud)...")
    print("=" * 65)

    try:
        ser = serial.Serial(PORT, BAUD, timeout=1.0)
    except Exception as e:
        print(f"[!] Could not open {PORT}: {e}")
        return 1

    print("Waiting 2.5s for Arduino to settle...")
    time.sleep(2.5)

    while ser.in_waiting:
        ser.readline()

    def send(cmd):
        ser.reset_input_buffer()
        ser.write((cmd + "\n").encode('ascii'))
        ser.flush()
        time.sleep(0.15)
        while ser.in_waiting:
            ser.readline()

    angles_to_test = [30, 20, 15, 10, 5, 0]

    for ang in angles_to_test:
        print(f"\n>>> Moving to {ang}° (command: 5 {ang})...")
        send(f"5 {ang}")
        print(f"    --> Look at the claw tips now. Is it closed at {ang}°?")
        print(f"        (Holding position for 4 seconds...)")
        time.sleep(4.0)

    # Return to 30 (user's preferred half-open)
    print("\n>>> Returning to 30° (half-open)...")
    send("5 30")
    time.sleep(2.0)

    ser.close()
    print("\n" + "=" * 65)
    print(" Test finished! Which angle (20°, 15°, 10°, 5°, or 0°) closed it best?")
    print("=" * 65)
    return 0

if __name__ == "__main__":
    sys.exit(main())
