"""Interactive, single-session gripper test tool.

Keeps COM13 open continuously so the Arduino NEVER reboots between commands.
Sends commands ONLY to Channel 5 (MG90S Gripper Claw).
All other 5 joints (Base, Shoulder, Elbow, Wrist Roll, Wrist Pitch) remain completely untouched and safe.
"""

import sys
import time
import serial
import serial.tools.list_ports

def main():
    port = "COM13"
    print(f"\n==========================================")
    print(f" PostureGuard Gripper Diagnostic Tool")
    print(f" Connecting to {port} (115200 baud)...")
    print(f"==========================================")

    try:
        ser = serial.Serial(port, 115200, timeout=1.0)
    except Exception as e:
        print(f"ERROR: Could not open {port}: {e}")
        return 1

    print("Waiting 2.5s for Arduino to settle...")
    time.sleep(2.5)

    # Drain boot lines
    while ser.in_waiting:
        line = ser.readline().decode("ascii", errors="replace").strip()
        if line:
            print(f"[boot] {line}")

    def send_cmd(cmd):
        ser.reset_input_buffer()
        ser.write((cmd.strip() + "\n").encode("ascii"))
        ser.flush()
        time.sleep(0.15)
        resp = []
        start = time.time()
        while time.time() - start < 3.0:
            if ser.in_waiting:
                line = ser.readline().decode("ascii", errors="replace").strip()
                if line:
                    resp.append(line)
                    if any(x in line for x in ["_OK", "ERROR_"]):
                        break
            time.sleep(0.05)
        return resp

    print("\n--- Current Status ---")
    print("STATUS ->", ", ".join(send_cmd("STATUS")))

    print("\nReady. Enter an angle between 10 and 170 (e.g. 30, 60, 90, 110, 140), or 'q' to quit.")
    print("Commands only target Channel 5. Other joints will NOT move.\n")

    if len(sys.argv) > 1:
        # One-shot command from CLI argument if provided
        cmd_arg = sys.argv[1]
        print(f">>> Sending single command: 5 {cmd_arg}")
        print("Response:", ", ".join(send_cmd(f"5 {cmd_arg}")))
        ser.close()
        return 0

    try:
        while True:
            user_input = input("Enter angle (or 'q'): ").strip()
            if not user_input or user_input.lower() == 'q':
                break
            if user_input.isdigit():
                ang = int(user_input)
                if 10 <= ang <= 170:
                    print(f">>> Sending: 5 {ang}")
                    resp = send_cmd(f"5 {ang}")
                    print(f"    Arduino response: {', '.join(resp)}")
                else:
                    print("Please enter an angle between 10 and 170.")
            else:
                # Raw command
                print(f">>> Sending raw: {user_input}")
                resp = send_cmd(user_input)
                print(f"    Arduino response: {', '.join(resp)}")
    finally:
        ser.close()
        print("Serial closed safely.")

if __name__ == "__main__":
    sys.exit(main())
