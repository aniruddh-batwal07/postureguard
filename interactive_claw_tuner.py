"""PostureGuard - Interactive Real-Time Claw Tuner.

Safely tunes Channel 5 (Gripper Claw) in gentle 2°-3° steps
so you can find the exact Close and Open angles WITHOUT mechanical over-travel or jamming.

Supports negative angles down to -25° (sub-140 pulse range) so claw tips can touch tightly.

Features:
- Automatically frees COM13 if backend is running
- Moves in tiny increments (+2° / -2°) down to -25°
- Supports direct angle jump (e.g. 30, 15, 0, -5, -10, -15)
- Supports direct raw PCA9685 pulse command (e.g. p 120, p 100)
- Automatically saves your chosen angles to firmware and flashes the board
"""

import os
import sys
import time
import subprocess
import serial
import serial.tools.list_ports

PORT = "COM13"
BAUD = 115200

def free_port():
    print("[1/3] Ensuring COM13 is free (stopping background Node backend if running)...")
    subprocess.run(["taskkill", "/F", "/FI", "WINDOWTITLE eq PostureGuard Backend*"], capture_output=True)
    subprocess.run(["taskkill", "/F", "/IM", "node.exe"], capture_output=True)
    time.sleep(1.5)

def update_firmware_and_flash(open_angle, close_angle):
    base_dir = os.path.dirname(os.path.abspath(__file__))
    ino_path = os.path.join(base_dir, "firmware", "PostureGuard_Arm", "PostureGuard_Arm.ino")
    cpp_path = os.path.join(base_dir, "firmware", "PostureGuard_Arm", "main.cpp")
    build_script = os.path.join(base_dir, "firmware", "build_firmware.py")
    flash_script = os.path.join(base_dir, "firmware", "flash_firmware.py")

    print(f"\n========================================================")
    print(f" Saving Calibrated Angles: OPEN={open_angle}°, CLOSE={close_angle}°")
    print(f"========================================================")

    for path in [ino_path, cpp_path]:
        with open(path, "r", encoding="utf-8") as f:
            lines = f.readlines()
        new_lines = []
        for line in lines:
            if "int gripperOpenAngle" in line and "=" in line and ";" in line:
                new_lines.append(f"int gripperOpenAngle       = {open_angle};    // User calibrated: half open (~2cm gap), exactly desired max open\n")
            elif "int gripperCloseAngle" in line and "=" in line and ";" in line:
                new_lines.append(f"int gripperCloseAngle      = {close_angle};   // Calibrated clamp angle (sub-zero allows claw tips to meet tightly)\n")
            elif "int angleCh5" in line and "=" in line and ";" in line:
                new_lines.append(f"int angleCh5               = {close_angle};   // Default closed\n")
            else:
                new_lines.append(line)
        with open(path, "w", encoding="utf-8") as f:
            f.writelines(new_lines)
        print(f"[+] Updated {os.path.basename(path)}")

    print("\nRebuilding firmware...")
    res = subprocess.run([sys.executable, build_script])
    if res.returncode != 0:
        print("[!] Build failed!")
        return False

    print("\nFlashing firmware to Arduino Uno...")
    res = subprocess.run([sys.executable, flash_script])
    if res.returncode == 0:
        print(f"\n>>> SUCCESS! Claw calibrated to OPEN={open_angle}°, CLOSE={close_angle}° and flashed! <<<")
        return True
    else:
        print("[!] Flashing failed. Please check connection.")
        return False

def angle_to_pulse(ang):
    return int(round(140 + (ang * (520 - 140) / 180)))

def pulse_to_angle(p):
    return int(round((p - 140) * 180 / (520 - 140)))

def main():
    print("=" * 65)
    print(" PostureGuard - Live Interactive Claw Tuner (with Sub-Zero Range)")
    print("=" * 65)
    print("\nIMPORTANT BEFORE STARTING:")
    print("If your claw is currently jammed in the wide-open position:")
    print("--> Gently squeeze the two claw tips together with your fingers.")
    print("    You will feel the linkage pop out of the over-center lock.")
    print("-" * 65)

    free_port()

    try:
        ser = serial.Serial(PORT, BAUD, timeout=1.0)
    except Exception as e:
        print(f"[!] Could not open {PORT}: {e}")
        return 1

    print(f"Connected to {PORT}. Waiting 2.5s for Arduino to settle...")
    time.sleep(2.5)

    while ser.in_waiting:
        ser.readline()

    def send_cmd(cmd):
        ser.reset_input_buffer()
        ser.write((cmd + "\n").encode("ascii"))
        ser.flush()
        time.sleep(0.15)
        resp = []
        start = time.time()
        while time.time() - start < 1.0:
            if ser.in_waiting:
                l = ser.readline().decode("ascii", errors="replace").strip()
                if l:
                    resp.append(l)
                    if any(k in l for k in ["_OK", "ERROR_"]):
                        break
            time.sleep(0.02)
        return resp

    current_ang = 30
    print(f"\nMoving claw to your calibrated OPEN position: {current_ang}° (Pulse {angle_to_pulse(current_ang)})...")
    send_cmd(f"5 {current_ang}")

    saved_open = 30
    saved_close = -25

    print("\n" + "=" * 65)
    print(" Controls (Claw Closing Range: -25° to 35°):")
    print("   [-] or [d] : Step DOWN by -2° (CLOSES the claw: 28°, 26° ... 0°, -2°, -4°...)")
    print("   [+] or [u] : Step UP by +2° (OPENS the claw towards 30°)")
    print("   [number]   : jump to exact angle (e.g. 20, 10, 0, -5, -10, -15)")
    print("   p [pulse]  : send direct PCA9685 pulse count (e.g. p 120, p 105, p 90)")
    print("   [c]        : save current angle as CLOSE")
    print("   [o]        : save current angle as OPEN (default: 30°)")
    print("   [t]        : test Open (30°) <-> Close cycle")
    print("   [s]        : save & flash to Arduino permanently")
    print("   [q]        : quit")
    print("=" * 65)

    try:
        while True:
            c_str = f" [CLOSE={saved_close}°]" if saved_close is not None else " [CLOSE not set]"
            o_str = f" [OPEN={saved_open}°]" if saved_open is not None else " [OPEN not set]"
            cur_p = angle_to_pulse(current_ang)
            prompt = f"\n[Angle: {current_ang}°, Pulse: {cur_p}]{o_str}{c_str}\nEnter command (-, +, angle -45 to 35, p <pulse>, c, o, t, s, q): "
            user_in = input(prompt).strip().lower()

            if not user_in or user_in == 'q':
                break
            elif user_in in ['+', 'u']:
                current_ang = min(35, current_ang + 2)
                cur_p = angle_to_pulse(current_ang)
                print(f"--> Moving to {current_ang}° (Pulse {cur_p})")
                send_cmd(f"5 {current_ang}")
            elif user_in in ['-', 'd']:
                current_ang = max(-45, current_ang - 2)
                cur_p = angle_to_pulse(current_ang)
                print(f"--> Closing to {current_ang}° (Pulse {cur_p})")
                send_cmd(f"5 {current_ang}")
            elif user_in.startswith("p "):
                try:
                    pulse_val = int(user_in.split()[1])
                    if 60 <= pulse_val <= 600:
                        current_ang = pulse_to_angle(pulse_val)
                        print(f"--> Sending raw pulse {pulse_val} (equiv angle ~{current_ang}°)...")
                        send_cmd(f"PULSE 5 {pulse_val}")
                    else:
                        print("Please enter a pulse between 60 and 600.")
                except ValueError:
                    print("Invalid pulse value.")
            elif user_in.replace('-', '', 1).isdigit():
                val = int(user_in)
                if -45 <= val <= 35:
                    current_ang = val
                    cur_p = angle_to_pulse(current_ang)
                    print(f"--> Moving to {current_ang}° (Pulse {cur_p})")
                    send_cmd(f"5 {current_ang}")
                else:
                    print("Please enter an angle between -45° and 35° to protect the linkage.")
            elif user_in == 'c':
                saved_close = current_ang
                print(f"[+] Saved CLOSE angle = {saved_close}° (Pulse {angle_to_pulse(saved_close)})")
            elif user_in == 'o':
                saved_open = current_ang
                print(f"[+] Saved OPEN angle = {saved_open}° (Pulse {angle_to_pulse(saved_open)})")
            elif user_in == 't':
                if saved_open is None or saved_close is None:
                    print("[!] Please set both [o] (open) and [c] (close) before testing cycle.")
                else:
                    print(f"\n--- Testing Cycle: OPEN ({saved_open}°) -> CLOSE ({saved_close}°) ---")
                    send_cmd(f"5 {saved_open}")
                    time.sleep(2.0)
                    send_cmd(f"5 {saved_close}")
                    time.sleep(2.0)
                    print("Cycle finished.")
            elif user_in == 's':
                if saved_open is None or saved_close is None:
                    print("[!] Please set both [o] (open) and [c] (close) first!")
                else:
                    ser.close()
                    time.sleep(0.5)
                    update_firmware_and_flash(saved_open, saved_close)
                    print("\nAll done! You can now run start_app.bat to launch your session.")
                    return 0
    finally:
        if ser.is_open:
            ser.close()

if __name__ == "__main__":
    sys.exit(main())
