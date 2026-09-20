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

print("\n[Step 1] Testing OPEN at 130 degrees...")
send("5 130")
print("--> Observing for 3.5 seconds...")
time.sleep(3.5)

print("\n[Step 2] Testing WIDE OPEN at 150 degrees...")
send("5 150")
print("--> Observing for 3.5 seconds...")
time.sleep(3.5)

print("\n[Step 3] Testing FULL OPEN at 165 degrees...")
send("5 165")
print("--> Observing for 3.5 seconds...")
time.sleep(3.5)

print("\n[Step 4] Testing CLOSE at 80 degrees (Gentle clamp)...")
send("5 80")
print("--> Observing for 3.5 seconds...")
time.sleep(3.5)

print("\n[Step 5] Testing OPEN AGAIN at 155 degrees...")
send("5 155")
print("--> Observing for 3.5 seconds...")
time.sleep(3.5)

ser.close()
print("\n==========================================")
print(" Test complete. Serial port closed.")
print("==========================================")
