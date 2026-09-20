import time
import serial

port = "COM13"
print(f"Connecting to {port} (115200 baud)...")
ser = serial.Serial(port, 115200, timeout=1.0)

print("Waiting 2.5s for Arduino to settle...")
time.sleep(2.5)

while ser.in_waiting:
    line = ser.readline().decode('ascii', errors='replace').strip()
    if line:
        print(f"[boot] {line}")

def send(cmd):
    print(f"\n==========================================")
    print(f">>> SENDING: {cmd}")
    ser.reset_input_buffer()
    ser.write((cmd + "\n").encode('ascii'))
    ser.flush()
    time.sleep(0.2)
    start = time.time()
    while time.time() - start < 3.0:
        if ser.in_waiting:
            line = ser.readline().decode('ascii', errors='replace').strip()
            if line:
                print(f"[arduino] {line}")
                if any(x in line for x in ["_OK", "ERROR_"]):
                    break
        time.sleep(0.05)

print("\n--- Status Check ---")
send("STATUS")

print("\n[Step 1] Commanding 150 degrees (Direct full torque + active hold)...")
send("5 150")
print("--> Observing for 4 seconds...")
time.sleep(4.0)

print("\n[Step 2] Commanding 85 degrees (Clamp position)...")
send("5 85")
print("--> Observing for 4 seconds...")
time.sleep(4.0)

print("\n[Step 3] Commanding 35 degrees (Low angle test)...")
send("5 35")
print("--> Observing for 4 seconds...")
time.sleep(4.0)

print("\n[Step 4] Returning to 85 degrees...")
send("5 85")
print("--> Observing for 3 seconds...")
time.sleep(3.0)

ser.close()
print("\n==========================================")
print(" Test complete. Serial port closed.")
print("==========================================")
