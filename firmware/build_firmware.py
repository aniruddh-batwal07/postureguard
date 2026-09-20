"""Direct builder for PostureGuard Arduino Uno Firmware.
Compiles C/C++ sources using toolchain-atmelavr directly to bypass PlatformIO/SCons Windows temp path issues.
"""

import os
import sys
import subprocess
import glob

AVR_BIN = r"C:\Rishabh\RKDM\.platformio\packages\toolchain-atmelavr\bin"
AVR_GCC = os.path.join(AVR_BIN, "avr-gcc.exe")
AVR_GXX = os.path.join(AVR_BIN, "avr-g++.exe")
AVR_AR  = os.path.join(AVR_BIN, "avr-ar.exe")
AVR_OBJCOPY = os.path.join(AVR_BIN, "avr-objcopy.exe")

CORE_DIR = r"C:\Rishabh\RKDM\.platformio\packages\framework-arduino-avr\cores\arduino"
VARIANT_DIR = r"C:\Rishabh\RKDM\.platformio\packages\framework-arduino-avr\variants\standard"
WIRE_DIR = r"C:\Rishabh\RKDM\.platformio\packages\framework-arduino-avr\libraries\Wire\src"
SPI_DIR = r"C:\Rishabh\RKDM\.platformio\packages\framework-arduino-avr\libraries\SPI\src"
EEPROM_DIR = r"C:\Rishabh\RKDM\.platformio\packages\framework-arduino-avr\libraries\EEPROM\src"
ADAFRUIT_PWM_DIR = r"C:\rishabh\RKDM\.pio\libdeps\uno\Adafruit PWM Servo Driver Library"
ADAFRUIT_BUSIO_DIR = r"C:\rishabh\RKDM\.pio\libdeps\uno\Adafruit BusIO"

FIRMWARE_DIR = os.path.dirname(os.path.abspath(__file__))
SKETCH_DIR = os.path.join(FIRMWARE_DIR, "PostureGuard_Arm")
BUILD_DIR = os.path.join(FIRMWARE_DIR, "build_output", "uno")

os.makedirs(BUILD_DIR, exist_ok=True)

INCLUDES = [
    f"-I{SKETCH_DIR}",
    f"-I{CORE_DIR}",
    f"-I{VARIANT_DIR}",
    f"-I{WIRE_DIR}",
    f"-I{SPI_DIR}",
    f"-I{EEPROM_DIR}",
    f"-I{ADAFRUIT_PWM_DIR}",
    f"-I{ADAFRUIT_BUSIO_DIR}",
]

DEFINES = [
    "-DPLATFORMIO=60200",
    "-DARDUINO_AVR_UNO",
    "-DF_CPU=16000000L",
    "-DARDUINO_ARCH_AVR",
    "-DARDUINO=10808",
]

COMMON_FLAGS = [
    "-mmcu=atmega328p",
    "-Os",
    "-Wall",
    "-pipe",  # v1.3: use pipes instead of temp files (bypasses Windows temp-folder ACL issues)
    "-ffunction-sections",
    "-fdata-sections",
    "-flto",
]

C_FLAGS = COMMON_FLAGS + ["-std=gnu11", "-fno-fat-lto-objects"] + DEFINES + INCLUDES
CXX_FLAGS = COMMON_FLAGS + ["-std=gnu++11", "-fno-exceptions", "-fno-threadsafe-statics", "-fpermissive"] + DEFINES + INCLUDES

def run_cmd(cmd):
    res = subprocess.run(cmd, capture_output=True, text=True)
    if res.returncode != 0:
        print(f"FAILED: {' '.join(cmd)}")
        if res.stdout:
            print(res.stdout)
        if res.stderr:
            print(res.stderr)
        sys.exit(1)
    return res

def main():
    print("=" * 60)
    print(" Building PostureGuard Arduino Uno Firmware...")
    print("=" * 60)

    objects = []

    # 1. Compile Arduino Core (C files)
    core_c_files = [
        "wiring.c", "wiring_digital.c", "wiring_analog.c",
        "wiring_shift.c", "wiring_pulse.c", "hooks.c", "WInterrupts.c"
    ]
    for fn in core_c_files:
        src = os.path.join(CORE_DIR, fn)
        obj = os.path.join(BUILD_DIR, f"core_{fn}.o")
        run_cmd([AVR_GCC, "-c", src, "-o", obj] + C_FLAGS)
        objects.append(obj)

    # 2. Compile Arduino Core (C++ files)
    core_cpp_files = [
        "HardwareSerial.cpp", "HardwareSerial0.cpp", "Print.cpp",
        "Stream.cpp", "WString.cpp", "WMath.cpp", "abi.cpp", "new.cpp", "main.cpp"
    ]
    for fn in core_cpp_files:
        src = os.path.join(CORE_DIR, fn)
        obj = os.path.join(BUILD_DIR, f"core_{fn}.o")
        run_cmd([AVR_GXX, "-c", src, "-o", obj] + CXX_FLAGS)
        objects.append(obj)

    # 3. Wire Library
    wire_c = os.path.join(WIRE_DIR, "utility", "twi.c")
    wire_c_obj = os.path.join(BUILD_DIR, "wire_twi.c.o")
    run_cmd([AVR_GCC, "-c", wire_c, "-o", wire_c_obj] + C_FLAGS)
    objects.append(wire_c_obj)

    wire_cpp = os.path.join(WIRE_DIR, "Wire.cpp")
    wire_cpp_obj = os.path.join(BUILD_DIR, "wire_Wire.cpp.o")
    run_cmd([AVR_GXX, "-c", wire_cpp, "-o", wire_cpp_obj] + CXX_FLAGS)
    objects.append(wire_cpp_obj)

    # 4. Adafruit BusIO
    for busio_src in ["Adafruit_I2CDevice.cpp", "Adafruit_BusIO_Register.cpp", "Adafruit_GenericDevice.cpp"]:
        p = os.path.join(ADAFRUIT_BUSIO_DIR, busio_src)
        if os.path.exists(p):
            obj = os.path.join(BUILD_DIR, f"busio_{busio_src}.o")
            run_cmd([AVR_GXX, "-c", p, "-o", obj] + CXX_FLAGS)
            objects.append(obj)

    # 5. Adafruit PWMServoDriver
    pwm_cpp = os.path.join(ADAFRUIT_PWM_DIR, "Adafruit_PWMServoDriver.cpp")
    pwm_obj = os.path.join(BUILD_DIR, "Adafruit_PWMServoDriver.o")
    run_cmd([AVR_GXX, "-c", pwm_cpp, "-o", pwm_obj] + CXX_FLAGS)
    objects.append(pwm_obj)

    # 6. PostureGuard Arm Sketch (main.cpp)
    sketch_src = os.path.join(SKETCH_DIR, "main.cpp")
    if not os.path.exists(sketch_src):
        sketch_src = os.path.join(SKETCH_DIR, "PostureGuard_Arm.ino")
    sketch_obj = os.path.join(BUILD_DIR, "PostureGuard_Arm.o")
    run_cmd([AVR_GXX, "-c", sketch_src, "-o", sketch_obj] + CXX_FLAGS)
    objects.append(sketch_obj)

    # 7. Link to ELF
    elf_path = os.path.join(BUILD_DIR, "firmware.elf")
    hex_path = os.path.join(BUILD_DIR, "firmware.hex")

    link_cmd = [
        AVR_GCC,
        "-mmcu=atmega328p",
        "-Os",
        "-Wall",
        "-flto",
        "-fuse-linker-plugin",
        "-Wl,--gc-sections",
        "-o", elf_path,
    ] + objects + ["-lm"]
    run_cmd(link_cmd)

    # 8. Convert to HEX
    objcopy_cmd = [
        AVR_OBJCOPY,
        "-O", "ihex",
        "-R", ".eeprom",
        elf_path,
        hex_path
    ]
    run_cmd(objcopy_cmd)

    size = os.path.getsize(hex_path)
    print(f"SUCCESS: Built {hex_path} ({size} bytes)!")

if __name__ == "__main__":
    main()
