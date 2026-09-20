"""Robotic arm interactive calibration script for PostureGuard.

Communicates with the Arduino Uno over Serial (115200 baud) to calibrate
individual servo joints or initialize all servos to base/home angles.

Calibrated Base / Home Angles:
  - Channel 0: Waist / Base  -> 90° (360° continuous rotation centered)
  - Channel 1: Shoulder     -> 135° (MG995, 0-180 deg resting recline)
  - Channel 2: Elbow        -> 180° (MG995, 0-180 deg resting fold)
  - Channel 3: Wrist Roll   -> 90° (SG90, Symmetrical CW 480 / CCW 140)
  - Channel 4: Wrist Pitch  -> 90° (SG90, 0-180 deg resting level)
  - Channel 5: Gripper Claw -> 70° Closed / 110° Open

Calibrated Cardboard Placing (Blocking) Angles:
  - Channel 0: Base         -> 90°
  - Channel 1: Shoulder     -> 75°
  - Channel 2: Elbow        -> 140°
  - Channel 3: Wrist Roll   -> 90°
  - Channel 4: Wrist Pitch  -> 120°

Calibrated Cardboard Pickup Dock Angles (Left Side):
  - Channel 0: Base         -> 45° (approx 45° left from center 90°)
  - Channel 1: Shoulder     -> 110° (reaches down to dock)
  - Channel 2: Elbow        -> 160° (extends down to dock)
  - Channel 4: Wrist Pitch  -> 90° (level with dock)
"""

import argparse
import sys
import time
import serial
import serial.tools.list_ports

CHANNEL_NAMES = {
    0: "Waist / Base (360°)",
    1: "Shoulder",
    2: "Elbow",
    3: "Wrist Roll",
    4: "Wrist Pitch",
    5: "Gripper Claw",
}

def detect_port(requested=None):
    if requested:
        return requested
    ports = list(serial.tools.list_ports.comports())
    for p in ports:
        if p.device == "COM13":
            return "COM13"
    for p in ports:
        desc = (p.description or "").lower()
        if "ch340" in desc or "arduino" in desc or "usb-serial" in desc:
            return p.device
    for p in ports:
        if p.device == "COM14":
            return "COM14"
    return "COM13"

def send_command(ser, cmd, timeout=3.0):
    cmd_bytes = (cmd.strip() + "\n").encode("ascii")
    ser.reset_input_buffer()
    ser.write(cmd_bytes)
    ser.flush()
    time.sleep(0.1)

    start = time.time()
    lines = []
    while time.time() - start < timeout:
        if ser.in_waiting:
            line = ser.readline().decode("ascii", errors="replace").strip()
            if line:
                lines.append(line)
                if any(kw in line for kw in ["_OK", "STATE_", "ERROR_"]):
                    break
        time.sleep(0.05)
    return lines

def main():
    parser = argparse.ArgumentParser(description="PostureGuard Arm Calibration Tool")
    parser.add_argument("--port", type=str, default=None, help="Serial port (default: auto COM13)")
    parser.add_argument("--all-90", action="store_true", help="Set all servos to 90 degrees sequentially")
    parser.add_argument("--set", nargs=2, type=int, metavar=("CHANNEL", "ANGLE"), help="Move single channel: --set <channel> <angle>")
    
    # Base Channel 0
    parser.add_argument("--cw", type=int, metavar="MS", help="Spin Base (Ch 0) CW for MS milliseconds")
    parser.add_argument("--ccw", type=int, metavar="MS", help="Spin Base (Ch 0) CCW for MS milliseconds")
    parser.add_argument("--left", type=int, metavar="MS", help="Spin Base (Ch 0) Left (CCW) for MS milliseconds")
    parser.add_argument("--right", type=int, metavar="MS", help="Spin Base (Ch 0) Right (CW) for MS milliseconds")
    parser.add_argument("--spin", type=int, metavar="DEG", help="Spin Base (Ch 0) by relative degrees (e.g. 360, -180)")
    
    # Wrist Roll Channel 3
    parser.add_argument("--w3-cw", type=int, metavar="MS", help="Spin Wrist (Ch 3) CW for MS ms")
    parser.add_argument("--w3-ccw", type=int, metavar="MS", help="Spin Wrist (Ch 3) CCW for MS ms (high torque)")
    parser.add_argument("--w3-left", type=int, metavar="MS", help="Spin Wrist (Ch 3) Left for MS ms")
    parser.add_argument("--w3-right", type=int, metavar="MS", help="Spin Wrist (Ch 3) Right for MS ms")
    parser.add_argument("--w3-mode", choices=["180", "360"], help="Set Wrist Ch 3 mode: 180 (positional) or 360 (continuous)")
    parser.add_argument("--w3-reset", action="store_true", help="Reset Wrist Ch 3 reference to 90 deg")
    
    parser.add_argument("--home", "--base", dest="home", action="store_true", help="Send arm to calibrated base/home position (Ch1:135, Ch2:180, Ch3:90, Ch4:90)")
    parser.add_argument("--pickup", action="store_true", help="Test pickup routine from left dock (rotates left, reaches down, clamps, returns to base)")
    parser.add_argument("--putback", action="store_true", help="Test putback routine (rotates left, lowers, releases card, returns to base)")
    parser.add_argument("--set-pickup", nargs=4, type=int, metavar=("CH0", "CH1", "CH2", "CH4"), help="Set pickup angles live: --set-pickup <ch0> <ch1> <ch2> <ch4>")
    parser.add_argument("--get-pickup", action="store_true", help="Query current pickup angles from Arduino")
    parser.add_argument("--pickup-mode", choices=["0", "1"], help="Enable (1) or disable (0) pickup sequence in BLOCK/RETRIEVE")
    parser.add_argument("--block", action="store_true", help="Execute BLOCK sequence (pickup from left dock + deploy to screen: Ch1:75, Ch2:140, Ch4:120)")
    parser.add_argument("--retrieve", action="store_true", help="Execute RETRIEVE sequence (retract from screen + return card to left dock)")
    parser.add_argument("--cycle", action="store_true", help="Execute complete check cycle: BLOCK (pickup + place) -> wait 5s -> RETRIEVE (retract + putback)")
    parser.add_argument("--raw", type=str, help="Send raw command string")
    parser.add_argument("--status", action="store_true", help="Query arm status")
    args = parser.parse_args()

    port = detect_port(args.port)
    print(f"[calibrate] Connecting to Arduino on {port} (115200 baud)...")

    try:
        ser = serial.Serial(port, 115200, timeout=1.0)
    except Exception as e:
        print(f"[calibrate] ERROR: Could not open {port}: {e}", file=sys.stderr)
        return 1

    time.sleep(1.8)
    while ser.in_waiting:
        boot_msg = ser.readline().decode("ascii", errors="replace").strip()
        if boot_msg:
            print(f"[arduino] {boot_msg}")

    try:
        if args.all_90:
            print("\n" + "=" * 55)
            print(" Setting ALL 6 joints to 90 DEGREES sequentially...")
            print("=" * 55)
            order = [0, 1, 2, 4, 3, 5]
            for ch in order:
                name = CHANNEL_NAMES.get(ch, f"CH {ch}")
                print(f"[calibrate] Moving Channel {ch} ({name}) -> 90 deg...")
                resp = send_command(ser, f"{ch} 90")
                print(f"            Response: {', '.join(resp)}")
                time.sleep(0.3)
            print("\n>>> ALL JOINTS INITIALIZED TO 90 DEGREES! <<<\n")

        elif args.cw:
            print(f"[calibrate] Spinning Base (Ch 0) CW for {args.cw} ms...")
            resp = send_command(ser, f"0 CW {args.cw}")
            print(f"            Response: {', '.join(resp)}")

        elif args.ccw:
            print(f"[calibrate] Spinning Base (Ch 0) CCW for {args.ccw} ms...")
            resp = send_command(ser, f"0 CCW {args.ccw}")
            print(f"            Response: {', '.join(resp)}")

        elif args.left:
            print(f"[calibrate] Spinning Base (Ch 0) Left for {args.left} ms...")
            resp = send_command(ser, f"0 LEFT {args.left}")
            print(f"            Response: {', '.join(resp)}")

        elif args.right:
            print(f"[calibrate] Spinning Base (Ch 0) Right for {args.right} ms...")
            resp = send_command(ser, f"0 RIGHT {args.right}")
            print(f"            Response: {', '.join(resp)}")

        elif args.spin:
            print(f"[calibrate] Spinning Base (Ch 0) by {args.spin} degrees...")
            resp = send_command(ser, f"0 SPIN {args.spin}")
            print(f"            Response: {', '.join(resp)}")

        elif args.w3_cw:
            print(f"[calibrate] Spinning Wrist (Ch 3) CW for {args.w3_cw} ms...")
            resp = send_command(ser, f"3 CW {args.w3_cw}")
            print(f"            Response: {', '.join(resp)}")

        elif args.w3_ccw:
            print(f"[calibrate] Spinning Wrist (Ch 3) CCW for {args.w3_ccw} ms...")
            resp = send_command(ser, f"3 CCW {args.w3_ccw}")
            print(f"            Response: {', '.join(resp)}")

        elif args.w3_left:
            print(f"[calibrate] Spinning Wrist (Ch 3) Left for {args.w3_left} ms...")
            resp = send_command(ser, f"3 LEFT {args.w3_left}")
            print(f"            Response: {', '.join(resp)}")

        elif args.w3_right:
            print(f"[calibrate] Spinning Wrist (Ch 3) Right for {args.w3_right} ms...")
            resp = send_command(ser, f"3 RIGHT {args.w3_right}")
            print(f"            Response: {', '.join(resp)}")

        elif args.w3_mode:
            print(f"[calibrate] Setting Wrist (Ch 3) mode to {args.w3_mode}...")
            resp = send_command(ser, f"MODE 3 {args.w3_mode}")
            print(f"            Response: {', '.join(resp)}")

        elif args.w3_reset:
            print("[calibrate] Resetting Wrist (Ch 3) reference to 90 deg...")
            resp = send_command(ser, "RESET 3")
            print(f"            Response: {', '.join(resp)}")

        elif args.set:
            ch, ang = args.set
            name = CHANNEL_NAMES.get(ch, f"CH {ch}")
            print(f"[calibrate] Moving Channel {ch} ({name}) -> {ang} deg...")
            resp = send_command(ser, f"{ch} {ang}")
            print(f"            Response: {', '.join(resp)}")

        elif args.home:
            print("[calibrate] Sending HOME (Moving joints to base angles: Ch1: 135°, Ch2: 180°, Ch3: 90°, Ch4: 90°)...")
            resp = send_command(ser, "HOME", timeout=16.0)
            print(f"            Response: {', '.join(resp)}")

        elif args.pickup:
            print("[calibrate] Sending PICKUP (Rotating to left dock, bending down, clamping card, returning to base)...")
            resp = send_command(ser, "PICKUP", timeout=18.0)
            print(f"            Response: {', '.join(resp)}")

        elif args.putback:
            print("[calibrate] Sending PUTBACK (Rotating to left dock, lowering, releasing card, returning to base)...")
            resp = send_command(ser, "PUTBACK", timeout=18.0)
            print(f"            Response: {', '.join(resp)}")

        elif args.set_pickup:
            p0, p1, p2, p4 = args.set_pickup
            print(f"[calibrate] Setting pickup dock angles: Ch0={p0}°, Ch1={p1}°, Ch2={p2}°, Ch4={p4}°...")
            resp = send_command(ser, f"SETPICKUP {p0} {p1} {p2} {p4}")
            print(f"            Response: {', '.join(resp)}")

        elif args.get_pickup:
            print("[calibrate] Querying current pickup dock angles...")
            resp = send_command(ser, "GETPICKUP")
            print(f"            Response: {', '.join(resp)}")

        elif args.pickup_mode:
            print(f"[calibrate] Setting pickup mode to {args.pickup_mode} (1=pickup enabled, 0=direct)...")
            resp = send_command(ser, f"PICKUPMODE {args.pickup_mode}")
            print(f"            Response: {', '.join(resp)}")

        elif args.block:
            print("[calibrate] Sending BLOCK (Pickup from dock if needed + deploy to screen position)...")
            resp = send_command(ser, "BLOCK", timeout=25.0)
            print(f"            Response: {', '.join(resp)}")

        elif args.retrieve:
            print("[calibrate] Sending RETRIEVE (Retract from screen + return card to left dock)...")
            resp = send_command(ser, "RETRIEVE", timeout=25.0)
            print(f"            Response: {', '.join(resp)}")

        elif args.cycle:
            print("\n" + "=" * 60)
            print(" EXECUTING COMPLETE CHECK CYCLE")
            print("=" * 60)
            print("[Step 1] Sending BLOCK (Pick up card from left dock & place in front of screen)...")
            resp1 = send_command(ser, "BLOCK", timeout=25.0)
            print(f"         Response: {', '.join(resp1)}")

            print("\n[Step 2] Cardboard is in front of screen! Simulating 5s blocked posture...")
            for s in range(5, 0, -1):
                print(f"         Holding... {s}s")
                time.sleep(1.0)

            print("\n[Step 3] Posture corrected! Sending RETRIEVE (Retract card & return to left dock)...")
            resp2 = send_command(ser, "RETRIEVE", timeout=25.0)
            print(f"         Response: {', '.join(resp2)}")

            print("\n" + "=" * 60)
            print(">>> COMPLETE CHECK CYCLE FINISHED SUCCESSFULLY! <<<")
            print("=" * 60)

        elif args.raw:
            print(f"[calibrate] Sending: {args.raw}")
            resp = send_command(ser, args.raw)
            print(f"Response: {', '.join(resp)}")

        elif args.status:
            resp = send_command(ser, "STATUS")
            print(f"Status: {', '.join(resp)}")

        else:
            parser.print_help()

    finally:
        ser.close()
        print("[calibrate] Disconnected.")
    return 0

if __name__ == "__main__":
    sys.exit(main())
