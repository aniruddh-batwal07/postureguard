"""Test Closing Angles Script.

Sweeps downward from 30° down through 0° into negative angles:
  30° (half-open) -> 20° -> 10° -> 0° -> -5° -> -10° -> -15° -> -20°
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

def angle_to_pulse(ang):
    # map(ang, 0, 180, 140, 520)
    return int(round(140 + (ang * (520 - 140) / 180)))

def main():
    free_port()

    print("=" * 65)
    print(" PostureGuard - Testing Closing Angles (30° down to -20°)")
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

    angles_to_test = [30, 20, 10, 0, -5, -10, -15, -20]

    for ang in angles_to_test:
        pulse = angle_to_pulse(ang)
        print(f"\n>>> Moving to {ang}° [Pulse {pulse}] (command: 5 {ang})...")
        send(f"5 {ang}")
        print(f"    --> Look at claw tips now. Are they touching at {ang}°?")
        print(f"        (Holding position for 4 seconds...)")
        time.sleep(4.0)

    # Return to 30 (user's preferred half-open)
    print("\n>>> Returning to 30° (half-open)...")
    send("5 30")
    time.sleep(2.0)

    ser.close()
    print("\n" + "=" * 65)
    print(" Test finished! Which angle (0°, -5°, -10°, -15°, or -20°) closed it completely?")
    print("=" * 65)
    return 0

if __name__ == "__main__":
    sys.exit(main())
