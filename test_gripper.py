import time
import serial

port = "COM13"
print(f"Connecting to {port} (115200 baud)...")
ser = serial.Serial(port, 115200, timeout=1.0)

print("Waiting 2.5s for Arduino boot to settle...")
time.sleep(2.5)

# Drain any boot messages
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

print("\n[Step 1] Moving Gripper to 90 degrees (CENTER)...")
send("5 90")
print("--> Observing for 3.5 seconds...")
time.sleep(3.5)

print("\n[Step 2] Moving Gripper to 120 degrees (HIGHER)...")
send("5 120")
print("--> Observing for 3.5 seconds...")
time.sleep(3.5)

print("\n[Step 3] Moving Gripper to 150 degrees (EVEN HIGHER)...")
send("5 150")
print("--> Observing for 3.5 seconds...")
time.sleep(3.5)

print("\n[Step 4] Returning Gripper to 90 degrees (CENTER)...")
send("5 90")
print("--> Observing for 3.5 seconds...")
time.sleep(3.5)

print("\n[Step 5] Moving Gripper to 60 degrees (LOWER)...")
send("5 60")
print("--> Observing for 3.5 seconds...")
time.sleep(3.5)

print("\n[Step 6] Moving Gripper to 30 degrees (EVEN LOWER)...")
send("5 30")
print("--> Observing for 3.5 seconds...")
time.sleep(3.5)

print("\n[Step 7] Returning Gripper to 90 degrees (CENTER)...")
send("5 90")
print("--> Observing for 3.5 seconds...")
time.sleep(3.5)

ser.close()
print("\n==========================================")
print(" Test complete. Serial port closed.")
print("==========================================")
