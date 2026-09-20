import time
import serial
import sys

port = "COM13"
print(f"Connecting to {port} to immediately relax and protect Channel 5...")
try:
    ser = serial.Serial(port, 115200, timeout=1.0)
except Exception as e:
    print(f"Could not open {port}: {e}")
    sys.exit(1)

time.sleep(2.0)
while ser.in_waiting:
    line = ser.readline().decode('ascii', errors='replace').strip()
    if line:
        print(f"[boot] {line}")

def send(cmd):
    print(f">>> {cmd}")
    ser.reset_input_buffer()
    ser.write((cmd + "\n").encode('ascii'))
    ser.flush()
    time.sleep(0.3)
    start = time.time()
    while time.time() - start < 2.0:
        if ser.in_waiting:
            line = ser.readline().decode('ascii', errors='replace').strip()
            if line:
                print(f"[arduino] {line}")
                if "_OK" in line or "ERROR" in line:
                    break
        time.sleep(0.05)

# 1. Turn off active hold power for channel 5
print("\n1. Disabling holding power for Channel 5 (HOLD 5 0)...")
send("HOLD 5 0")

# 2. Return gripper to gentle neutral resting angle (80 deg)
print("\n2. Moving gripper to neutral resting position (80 deg)...")
send("5 80")

# 3. Cut PWM to all motors completely so no current flows
print("\n3. Stopping all motor pulses (STOP)...")
send("STOP")

ser.close()
print("\n>>> Channel 5 is now RELAXED and UNPOWERED. The motor should cool down immediately.")
