# PostureGuard firmware

Arduino firmware for the 4-DOF robotic arm. Sits on the software side of the
hardware/software boundary (architecture §9): it only executes `BLOCK` /
`RETRIEVE` / `STATUS` commands from the backend over the serial link and
reports completion.

**Status:** Planned for Phase 5 of `docs/development-plan.md`. No firmware
exists yet.

Layout (from architecture §6):

- `command_parser/` — serial protocol parsing
- `arm_controller/` — joint positions / motion sequencing
- `servo_driver/` — PCA9685 + MG996R/SG90 control