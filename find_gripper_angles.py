"""Interactive Gripper Finder Script.

Tests Channel 5 at safe incremental angles with 3-second pauses
so you can visually identify which angle closes and which angle opens:
- Angle 30°
- Angle 60°
- Angle 90°
- Angle 120°
- Angle 140°
"""

import time
import sys
import serial

PORT = "COM13"
BAUD = 115200

def main():
    print("=" * 65)
    print(" PostureGuard - Interactive Gripper Angle Calibrator")
    print(f" Connecting to {PORT} ({BAUD} baud)...")
    print("=" * 65)

    try:
        ser = serial.Serial(PORT, BAUD, timeout=1.0)
    except Exception as e:
        print(f"\n[!] Error opening {PORT}: {e}")
        print("    --> Note: If the backend (Node.js) or web app is running,")
        print("        please close that terminal first so COM13 is released.")
        return 1

    print("Waiting 2.5s for Arduino to settle...")
    time.sleep(2.5)

    while ser.in_waiting:
        line = ser.readline().decode('ascii', errors='replace').strip()
        if line:
            print(f"[boot] {line}")

    def send(cmd):
        ser.reset_input_buffer()
        ser.write((cmd + "\n").encode('ascii'))
        ser.flush()
        time.sleep(0.2)
        while ser.in_waiting:
            line = ser.readline().decode('ascii', errors='replace').strip()
            if line:
                print(f"    [arduino] {line}")

    test_angles = [30, 60, 90, 120, 140]

    print("\n--- Starting Sequential Test on Channel 5 ---")
    print("Watch the claw physically and note which angle CLOSES it.\n")

    for ang in test_angles:
        print(f">>> Moving Gripper to {ang} degrees (command: 5 {ang})...")
        send(f"5 {ang}")
        print(f"    Observing at {ang}° for 3 seconds...")
        time.sleep(3.0)

    # Return to neutral 90
    print("\n>>> Returning Gripper to 90 degrees...")
    send("5 90")
    time.sleep(1.5)

    ser.close()
    print("\n" + "=" * 65)
    print(" Test complete! Which angle closed the claw the best?")
    print("=" * 65)
    return 0

if __name__ == "__main__":
    sys.exit(main())
