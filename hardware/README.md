# PostureGuard hardware

Notes for the physical build (product-spec §6):

- Arduino controller (NOT ESP32)
- 4-DOF robotic arm
- 6 servos: 3 x MG996R + 3 x SG90 (mapping to joints is ADR-8)
- PCA9685 servo driver
- Blocker card + dock ("Fix your posture.")
- Power supply (servos powered separately from the Arduino logic supply)
- Additional supporting hardware: mounting, linkage, cabling

Planned inclusions: BOM, wiring diagrams, assembly instructions. Not yet
written. See `docs/development-plan.md` Phase 5.