/*
  PostureGuard - Phase 5 Arduino Firmware (v1.3)
  Hardware: Arduino Uno + PCA9685 16-Channel PWM Servo Driver (I2C 0x40)
  
  Physical Channel Mapping:
    - Channel 0: Waist / Base   (360° Continuous Rotation Servo - Timed CW/CCW Pulses)
    - Channel 1: Shoulder      (MG995 180° Positional Servo)
    - Channel 2: Elbow         (MG995 180° Positional Servo)
    - Channel 3: Wrist Roll    (SG90 Hybrid 360° Continuous / 180° Positional)
      -> Symmetrical High Torque: CW = 480, CCW = 140 (fixed weak reverse bug)
    - Channel 4: Wrist Pitch   (SG90 180° Positional Servo)
    - Channel 5: Gripper Claw  (MG90S 180° Metal-Gear Positional Servo)
      -> Calibrated: OPEN = 110°, CLOSE = 70°
      -> Default hold power = OFF to protect power supply from stall current

  v1.3 Behavior Contract:
    - BOOT RECOVERY: the last arm state (joints, cardboard-in-claw, docked/
      blocked) is persisted to EEPROM. The Uno resets every time the backend
      opens the serial port; on boot the arm automatically retracts, puts the
      cardboard back and comes to the resting home dock if it was left
      anywhere else. A docked arm does not move at all.
    - CLEAN BASE SWEEPS: base pans are single constant-torque sweeps (no
      stutter ramps, no reverse-jerk braking) -> one clean 75° left rotation
      to the cardboard dock and one clean return to center (90°).
    - BLOCK  : open claw -> pan 75° left to dock -> bend Ch1/Ch2 -> clamp ->
               lift to transit -> pan back to center -> adjust Ch4 -> Ch3 ->
               Ch2 -> reach with Ch1 -> hold in front of screen.
    - RETRIEVE: retract to resting home (5 -> 4 -> 3 -> 2 -> 1 -> 0) ->
               pan 75° left to dock -> lower Ch1/Ch2 -> release cardboard ->
               retract back to resting home -> RETRIEVE_OK.

  Protocol Contract (Newline-delimited ASCII tokens at 115200 baud):
    - BLOCK    -> Deploys blocker sheet in front of screen -> replies "BLOCK_OK"
    - RETRIEVE -> Returns blocker sheet to dock position   -> replies "RETRIEVE_OK"
    - STATUS   -> Replies "STATE_DOCKED" | "STATE_BLOCKED" | "STATE_BUSY"
*/

#include <Arduino.h>
#include <Wire.h>
#include <EEPROM.h>
#include <Adafruit_PWMServoDriver.h>

Adafruit_PWMServoDriver pwm = Adafruit_PWMServoDriver(0x40);

// Hardware Channels
const int CH_WAIST    = 0; // 360 deg Continuous Rotation Servo
const int CH_SHOULDER = 1; // 180 deg Positional (MG995)
const int CH_ELBOW    = 2; // 180 deg Positional (MG995)
const int CH_WRIST_3  = 3; // Wrist Roll (SG90)
const int CH_WRIST_4  = 4; // Wrist Pitch (180 deg positional)
const int CH_GRIPPER  = 5; // Gripper claw (MG90S positional)

// 180-Degree Servo Calibration (50Hz on PCA9685)
#define SERVOMIN   140 // approx 0 deg
#define SERVOMAX   580 // approx 180 deg
#define SERVO_FREQ 50  // 50 Hz

// Continuous Rotation Pulses (Balanced, graceful motion around neutral ~307)
#define NEUTRAL_PULSE        307  // Stationary neutral pulse width
#define BASE_CRUISE_OFFSET   95   // Strong, smooth torque offset (~402 CW / ~212 CCW)
#define BASE_CW_CRUISE       (NEUTRAL_PULSE + BASE_CRUISE_OFFSET)
#define BASE_CCW_CRUISE      (NEUTRAL_PULSE - BASE_CRUISE_OFFSET)
#define WRIST3_CRUISE_OFFSET 48   // Gentle wrist roll speed
#define WRIST3_CW_CRUISE     (NEUTRAL_PULSE + WRIST3_CRUISE_OFFSET)
#define WRIST3_CCW_CRUISE    (NEUTRAL_PULSE - WRIST3_CRUISE_OFFSET)
#define FULL_CW              480  // Legacy full torque CW
#define FULL_CCW             140  // Legacy full torque CCW
#define STOP_PULSE           0    // PWM disabled (rest)

#define MS_PER_DEG_WRIST3    12   // Calibrated for smooth, controlled SG90 roll
#define MS_PER_DEG_BASE      20   // Calibrated for smooth, stable base panning

// Base / Home Angles (Resting / Docked)
const int BASE_ANGLE_CH0 = 90;   // Waist / Base (360° virtual center)
const int BASE_ANGLE_CH1 = 135;  // Shoulder (resting recline 135°)
const int BASE_ANGLE_CH2 = 180;  // Elbow (resting fold 180°)
const int BASE_ANGLE_CH3 = 90;   // Wrist Roll (resting level 90°)
const int BASE_ANGLE_CH4 = 90;   // Wrist Pitch (resting level 90°)

// Deployed / Screen Blocking Angles (Places cardboard ahead in front of screen)
const int BLOCK_ANGLE_CH0 = 90;   // Base centered facing screen
const int BLOCK_ANGLE_CH1 = 75;   // Shoulder deployed angle (75°)
const int BLOCK_ANGLE_CH2 = 140;  // Elbow deployed angle (140°)
const int BLOCK_ANGLE_CH3 = 90;   // Wrist Roll kept level (90°)
const int BLOCK_ANGLE_CH4 = 120;  // Wrist Pitch deployed angle (120°)

// Cardboard Pickup Dock Angles (Left-side dock: 75° left from center 90°)
int pickupAngleCh0 = 15;  // Base rotated 75° left to cardboard dock (center is 90°)
int pickupAngleCh1 = 115; // Shoulder gentle bend down (from resting 135°)
int pickupAngleCh2 = 165; // Elbow gentle dip down (from resting 180°)
int pickupAngleCh4 = 90;  // Wrist pitch aligned with card dock
bool enablePickupSequence = true; // Enables pickup before placing
bool cardInClaw = false;   // Tracks whether cardboard is currently clamped in gripper

// Tracked Joint Positions (Defaulted to Base / Home Angles)
int angleCh0 = BASE_ANGLE_CH0;   // 90°
int angleCh1 = BASE_ANGLE_CH1;   // 135°
int angleCh2 = BASE_ANGLE_CH2;   // 180°
int angleCh4 = BASE_ANGLE_CH4;   // 90°
int wrist3Angle = BASE_ANGLE_CH3; // 90°

// Wrist 3 Mode (Channel 3 - default continuous with symmetrical torque)
bool wrist3IsPositional = false;

// Gripper Claw Settings (Channel 5 - MG90S Positional Servo)
bool isPositional180Mode   = true;  
bool gripperHoldPower      = false; // Cut PWM after move: prevents motor from stalling and overheating
int gripperOpenAngle       = 115;   // Safe open angle: avoids mechanical linkage toggle-lock
int gripperCloseAngle      = 80;    // Calibrated gentle clamp angle
int angleCh5               = 80;    // Default closed
bool gripperIsOpen         = false;

// Arm Operational States per docs/architecture.md §4.3
enum ArmState {
  STATE_DOCKED,
  STATE_BLOCKED,
  STATE_BUSY
};
ArmState currentArmState = STATE_DOCKED;

// -------------------------------------------------------------
// PERSISTED ARM STATE (EEPROM) — v1.3
// The Uno resets every time something opens the serial port (DTR) and on
// power cycles. Persisting the tracked joint angles + arm state lets the
// firmware know where the arm physically was and recover to the resting
// home dock on boot ("come home no matter where the arm is").
// EEPROM.put()/update semantics only rewrite bytes that actually changed.
// -------------------------------------------------------------
struct PersistedArmState {
  uint8_t magic;      // 0xA5 signature
  uint8_t state;      // ArmState
  uint8_t cardInClaw; // 0/1
  uint8_t pickup;     // enablePickupSequence 0/1
  int16_t ch0;        // base virtual angle (0..360)
  uint8_t ch1;        // shoulder
  uint8_t ch2;        // elbow
  uint8_t ch3;        // wrist roll reference
  uint8_t ch4;        // wrist pitch
  uint8_t ch5;        // gripper
};

const uint8_t PERSIST_MAGIC  = 0xA5;
const int      PERSIST_ADDR  = 0;

void persistState() {
  PersistedArmState s;
  s.magic      = PERSIST_MAGIC;
  s.state      = (uint8_t)currentArmState;
  s.cardInClaw = cardInClaw ? 1 : 0;
  s.pickup     = enablePickupSequence ? 1 : 0;
  s.ch0        = (int16_t)angleCh0;
  s.ch1        = (uint8_t)angleCh1;
  s.ch2        = (uint8_t)angleCh2;
  s.ch3        = (uint8_t)wrist3Angle;
  s.ch4        = (uint8_t)angleCh4;
  s.ch5        = (uint8_t)angleCh5;
  EEPROM.put(PERSIST_ADDR, s);
}

bool restoreState() {
  PersistedArmState s;
  EEPROM.get(PERSIST_ADDR, s);
  if (s.magic != PERSIST_MAGIC) {
    return false; // fresh EEPROM / first boot: keep home defaults, no motion
  }
  if (s.state <= (uint8_t)STATE_BUSY) {
    currentArmState = (ArmState)s.state;
  }
  cardInClaw           = (s.cardInClaw == 1);
  enablePickupSequence = (s.pickup == 1);
  angleCh0             = constrain((int)s.ch0, 0, 360);
  angleCh1             = constrain(s.ch1, 0, 180);
  angleCh2             = constrain(s.ch2, 0, 180);
  wrist3Angle          = constrain(s.ch3, 0, 180);
  angleCh4             = constrain(s.ch4, 0, 180);
  angleCh5             = constrain(s.ch5, 0, 180);
  gripperIsOpen        = (angleCh5 >= gripperOpenAngle);
  return true;
}

// Forward Declarations
int angleToPulse(int ang);
void stopAllMotors();
void rotateBaseSmooth(int dir, int durationMs);
void rotateBaseContinuous(int dir, int durationMs);
void moveBaseToAngle(int targetAngle);
void rotateWrist3Smooth(int dir, int durationMs);
void moveWrist3Continuous(int dir, int durationMs);
void moveWrist3ToAngle(int targetAngle);
void moveGripperPositional(int targetAngle);
void gripperOpen();
void gripperClose();
void setPositionalJoint(int ch, int targetAngle);
void setWristPitch(int targetAngle);
void homeArm();
void executePickup();
void executePutback();
void executeBlock();
void executeRetrieve();
void printStatus();

int angleToPulse(int ang) {
  ang = constrain(ang, 0, 180);
  return map(ang, 0, 180, SERVOMIN, SERVOMAX);
}

void stopAllMotors() {
  for (int i = 0; i < 16; i++) {
    pwm.setPWM(i, 0, STOP_PULSE);
  }
}

// -------------------------------------------------------------
// CHANNEL 0: 360° CONTINUOUS ROTATION BASE (Clean Constant Sweep)
// -------------------------------------------------------------
// v1.4: immediate PWM cutoff to eliminate rebound/jerk.
// The neutral pulse (307) previously caused an active reverse drive kick for 50ms
// due to servo potentiometer offset, which produced a ~15° backward rebound.
// Cutting directly to STOP_PULSE (0) allows the high-ratio metal gearbox to hold
// position dead on target without any reverse bounce.
void rotateBaseSmooth(int dir, int totalMs) {
  if (totalMs <= 0) return;

  int cruisePulse = (dir > 0) ? BASE_CW_CRUISE : BASE_CCW_CRUISE;

  // Steady constant-torque cruise (full sweep, single direction)
  pwm.setPWM(CH_WAIST, 0, cruisePulse);
  delay(totalMs);

  // Cut PWM immediately to halt motor cleanly with zero rebound
  pwm.setPWM(CH_WAIST, 0, STOP_PULSE);
}

void rotateBaseContinuous(int dir, int durationMs) {
  if (durationMs <= 0) durationMs = 100;
  durationMs = constrain(durationMs, 10, 10000);
  rotateBaseSmooth(dir, durationMs);
}

void moveBaseToAngle(int targetAngle) {
  targetAngle = constrain(targetAngle, 0, 360);
  int delta = targetAngle - angleCh0;
  if (delta == 0) return;

  int durationMs = abs(delta) * MS_PER_DEG_BASE;
  if (durationMs < 30) durationMs = 30;

  rotateBaseSmooth(delta > 0 ? 1 : -1, durationMs);
  angleCh0 = targetAngle;
}

// -------------------------------------------------------------
// CHANNEL 3: WRIST ROLL (Smooth S-Curve Rotation)
// -------------------------------------------------------------
void rotateWrist3Smooth(int dir, int totalMs) {
  if (totalMs <= 0) return;
  int rampMs = min(100, totalMs / 4);
  int cruiseMs = totalMs - (2 * rampMs);
  if (cruiseMs < 0) {
    rampMs = totalMs / 2;
    cruiseMs = 0;
  }

  int rampSteps = 3;
  int stepDelay = rampMs / rampSteps;
  if (stepDelay < 10) stepDelay = 10;

  for (int i = 1; i <= rampSteps; i++) {
    int offset = (WRIST3_CRUISE_OFFSET * i) / rampSteps;
    int pulse = (dir > 0) ? (NEUTRAL_PULSE + offset) : (NEUTRAL_PULSE - offset);
    pwm.setPWM(CH_WRIST_3, 0, pulse);
    delay(stepDelay);
  }

  if (cruiseMs > 0) {
    int cruisePulse = (dir > 0) ? WRIST3_CW_CRUISE : WRIST3_CCW_CRUISE;
    pwm.setPWM(CH_WRIST_3, 0, cruisePulse);
    delay(cruiseMs);
  }

  for (int i = rampSteps - 1; i >= 1; i--) {
    int offset = (WRIST3_CRUISE_OFFSET * i) / rampSteps;
    int pulse = (dir > 0) ? (NEUTRAL_PULSE + offset) : (NEUTRAL_PULSE - offset);
    pwm.setPWM(CH_WRIST_3, 0, pulse);
    delay(stepDelay);
  }

  // Cut PWM immediately to halt motor cleanly with zero rebound
  pwm.setPWM(CH_WRIST_3, 0, STOP_PULSE);
}

void moveWrist3Continuous(int dir, int durationMs) {
  if (durationMs <= 0) durationMs = 100;
  durationMs = constrain(durationMs, 15, 5000);
  rotateWrist3Smooth(dir, durationMs);
}

void moveWrist3ToAngle(int targetAngle) {
  if (wrist3IsPositional) {
    setPositionalJoint(CH_WRIST_3, targetAngle);
    return;
  }
  targetAngle = constrain(targetAngle, 0, 180);
  int delta = targetAngle - wrist3Angle;
  if (delta == 0) return;
  
  int durationMs = abs(delta) * MS_PER_DEG_WRIST3;
  if (durationMs < 40) durationMs = 40;
  
  rotateWrist3Smooth(delta > 0 ? 1 : -1, durationMs);
  wrist3Angle = targetAngle;
}

// -------------------------------------------------------------
// CHANNEL 5: GRIPPER CLAW (Direct High-Torque Drive + Active Hold)
// -------------------------------------------------------------
// Direct pulse drive delivers 100% full motor torque to overcome
// linkage gear mesh friction without stalling or weak creep.
void moveGripperPositional(int targetAngle) {
  targetAngle = constrain(targetAngle, 10, 170);

  pwm.setPWM(CH_GRIPPER, 0, angleToPulse(targetAngle));
  delay(350); // Settle time for full claw stroke

  if (!gripperHoldPower) {
    pwm.setPWM(CH_GRIPPER, 0, STOP_PULSE);
  }
  angleCh5 = targetAngle;
}

void gripperOpen() {
  moveGripperPositional(gripperOpenAngle);
  gripperIsOpen = true;
}

void gripperClose() {
  moveGripperPositional(gripperCloseAngle);
  gripperIsOpen = false;
}

// -------------------------------------------------------------
// CHANNELS 1, 2, 3(optional), 4: 180° POSITIONAL JOINTS
// -------------------------------------------------------------
// Cinematic Robotic Motion Profile:
// 1° microstepping with smooth acceleration (ease-in), cruising, and deceleration (ease-out)
// Specially dampened for heavy Shoulder and Elbow joints to prevent losing balance.
void setPositionalJoint(int ch, int targetAngle) {
  targetAngle = constrain(targetAngle, 0, 180);
  int* currentAnglePtr;
  
  switch (ch) {
    case 1: currentAnglePtr = &angleCh1; break;
    case 2: currentAnglePtr = &angleCh2; break;
    case 3: currentAnglePtr = &wrist3Angle; break;
    case 4: currentAnglePtr = &angleCh4; break;
    default: return;
  }

  int start = *currentAnglePtr;
  if (start == targetAngle) {
    // Pulse servo to target angle to guarantee physical arm holds at base position even if software state already matched
    pwm.setPWM(ch, 0, angleToPulse(targetAngle));
    delay(150);
    pwm.setPWM(ch, 0, STOP_PULSE);
    return;
  }

  int stepDir = (targetAngle > start) ? 1 : -1;

  for (int a = start; a != targetAngle; a += stepDir) {
    pwm.setPWM(ch, 0, angleToPulse(a));

    int distTraveled = abs(a - start);
    int distRemaining = abs(targetAngle - a);
    int edgeDist = min(distTraveled, distRemaining);

    int stepDelay;
    if (ch == CH_SHOULDER || ch == CH_ELBOW) {
      // Heavy joints (Shoulder & Elbow): Gentle acceleration & deceleration to preserve balance
      if (edgeDist < 4) {
        stepDelay = 42; // Soft start & cushioned stop
      } else if (edgeDist < 8) {
        stepDelay = 34; // Smooth transition
      } else if (edgeDist < 14) {
        stepDelay = 28; // Controlled ramp
      } else {
        stepDelay = 24; // Smooth, balanced cruise (no violent flinging)
      }
    } else {
      // Lighter joints (Wrist pitch & roll): Smooth and responsive
      if (edgeDist < 4) {
        stepDelay = 32;
      } else if (edgeDist < 8) {
        stepDelay = 24;
      } else {
        stepDelay = 18;
      }
    }
    delay(stepDelay);
  }

  // Exact target position
  pwm.setPWM(ch, 0, angleToPulse(targetAngle));
  // Settle hold: firm robotic damping to eliminate physical overshoot & vibration
  delay(260);

  // Cut PWM signal after reaching target to protect 5V rail / USB from stall current
  pwm.setPWM(ch, 0, STOP_PULSE);
  *currentAnglePtr = targetAngle;
}

void setWristPitch(int targetAngle) {
  setPositionalJoint(CH_WRIST_4, targetAngle);
}

// -------------------------------------------------------------
// CARDBOARD PICKUP FROM LEFT DOCK (Smooth, Balanced Sequence)
// -------------------------------------------------------------
void executePickup() {
  // 1. Open gripper claw to prepare for grabbing the card
  gripperOpen();
  delay(150);

  // 2. Rotate base smoothly to left pickup dock (15° = 75° left from 90°)
  moveBaseToAngle(pickupAngleCh0);
  delay(200);

  // 3. Sequenced robotic bend down to cardboard dock
  // Shoulder reaches down gently (135° -> 115°)
  setPositionalJoint(CH_SHOULDER, pickupAngleCh1);
  delay(150);

  // Forearm extends down gently (180° -> 165°)
  setPositionalJoint(CH_ELBOW, pickupAngleCh2);
  delay(150);

  // Wrist pitch levels with card dock (90°)
  setPositionalJoint(CH_WRIST_4, pickupAngleCh4);
  delay(200);

  // 4. Firmly clamp cardboard in gripper claw
  gripperClose();
  delay(250);
  cardInClaw = true;

  // 5. Lift cardboard safely off the dock into compact transit posture
  setPositionalJoint(CH_WRIST_4, BASE_ANGLE_CH4);
  delay(150);
  setPositionalJoint(CH_ELBOW, 175);
  delay(150);
  setPositionalJoint(CH_SHOULDER, 120);
  delay(200);

  // 6. Return base smoothly to center position (90°) with cardboard safely elevated
  moveBaseToAngle(BASE_ANGLE_CH0);
  delay(250);

  persistState();
}

// -------------------------------------------------------------
// CARDBOARD PUTBACK TO LEFT DOCK (v1.3: Home -> 75° left -> Drop -> Home)
// -------------------------------------------------------------
// Assumes the arm starts from the resting home dock posture (no-ops if it is
// already there). Pans 75° left to the cardboard dock, lowers Ch1/Ch2,
// releases the cardboard, then retracts strictly in reverse joint order
// (Ch4 -> Ch3 -> Ch2 -> Ch1 -> Ch0) back to the resting home dock.
void executePutback() {
  // 1. Affirm resting home posture before leaving the center (no-op if there)
  gripperClose();
  delay(100);
  setPositionalJoint(CH_WRIST_4, BASE_ANGLE_CH4);
  delay(100);
  moveWrist3ToAngle(BASE_ANGLE_CH3);
  delay(100);
  setPositionalJoint(CH_ELBOW, BASE_ANGLE_CH2);
  delay(150);
  setPositionalJoint(CH_SHOULDER, BASE_ANGLE_CH1);
  delay(150);

  // 2. Rotate base in one clean 75° left sweep to the cardboard dock
  moveBaseToAngle(pickupAngleCh0);
  delay(200);

  // 3. Lower arm into dock position (gentle bend, same geometry as pickup)
  setPositionalJoint(CH_SHOULDER, pickupAngleCh1);
  delay(150);
  setPositionalJoint(CH_ELBOW, pickupAngleCh2);
  delay(150);
  setPositionalJoint(CH_WRIST_4, pickupAngleCh4);
  delay(200);

  // 4. Open gripper to release the cardboard onto the dock
  gripperOpen();
  delay(250);
  cardInClaw = false;

  // 5. RETRACT AND RETURN TO BASE: strictly Ch4 -> Ch3 -> Ch2 -> Ch1 -> Ch0
  gripperClose();
  delay(100);

  setPositionalJoint(CH_WRIST_4, BASE_ANGLE_CH4);
  delay(100);

  moveWrist3ToAngle(BASE_ANGLE_CH3);
  delay(100);

  setPositionalJoint(CH_ELBOW, BASE_ANGLE_CH2);
  delay(150);

  setPositionalJoint(CH_SHOULDER, BASE_ANGLE_CH1);
  delay(150);

  moveBaseToAngle(BASE_ANGLE_CH0);
  delay(250);

  persistState();
}

// -------------------------------------------------------------
// MOTION SEQUENCES (Strict 5 -> 4 -> 3 -> 2 -> 1 -> 0 Homing)
// -------------------------------------------------------------
void homeArm() {
  currentArmState = STATE_BUSY;
  // If holding card and returning to true home, put card back to left dock
  if (enablePickupSequence && cardInClaw) {
    executePutback();
  }
  // Staged homing to base angles strictly in 5 -> 4 -> 3 -> 2 -> 1 -> 0 order:
  // Step 1: Channel 5 - Gripper claw parks first
  gripperClose();
  delay(150);

  // Step 2: Channel 4 - Wrist pitch levels to 90°
  setPositionalJoint(CH_WRIST_4, BASE_ANGLE_CH4);
  delay(150);

  // Step 3: Channel 3 - Wrist roll levels to 90°
  moveWrist3ToAngle(BASE_ANGLE_CH3);
  delay(100);

  // Step 4: Channel 2 - Forearm folds completely back into body (180°)
  setPositionalJoint(CH_ELBOW, BASE_ANGLE_CH2);
  delay(200);

  // Step 5: Channel 1 - Shoulder reclines smoothly into home dock (135°)
  setPositionalJoint(CH_SHOULDER, BASE_ANGLE_CH1);
  delay(200);

  // Step 6: Channel 0 - Base pans smoothly to center (90°)
  moveBaseToAngle(BASE_ANGLE_CH0);
  delay(250);

  cardInClaw = false;
  currentArmState = STATE_DOCKED;
  persistState();
}

// BLOCK (v1.3): Sequenced placement of cardboard in front of the screen.
// 1. Pickup the cardboard from the left dock (pan 75° left -> bend Ch1/Ch2 ->
//    clamp -> lift to transit -> pan back to center 90°).
// 2. From the centered home base, adjust Ch4 (wrist pitch) -> Ch3 (wrist
//    roll) -> Ch2 (elbow) -> Ch1 (shoulder reach) to deploy in front of the
//    screen and hold until the posture is corrected.
void executeBlock() {
  if (currentArmState == STATE_BLOCKED) {
    Serial.println(F("BLOCK_OK"));
    return;
  }
  currentArmState = STATE_BUSY;
  persistState();

  // Layer 1: Pick up cardboard from left dock if enabled and not already held
  if (enablePickupSequence && !cardInClaw) {
    executePickup();
  } else {
    // Affirm firm grip on the cardboard sheet
    gripperClose();
    delay(150);
  }

  // Layer 2: Cardboard placement in front of screen
  // Stage 1: Base centered at 90° (already returned by the pickup sweep)
  moveBaseToAngle(BLOCK_ANGLE_CH0);
  delay(150);

  // Stage 2: Channel 4 - Wrist pitch tilts card for screen view (90° -> 120°)
  setPositionalJoint(CH_WRIST_4, BLOCK_ANGLE_CH4);
  delay(200);

  // Stage 3: Channel 3 - Wrist roll kept level (90°)
  moveWrist3ToAngle(BLOCK_ANGLE_CH3);
  delay(150);

  // Stage 4: Channel 2 - Forearm unfolds outward toward the display (175° -> 140°)
  setPositionalJoint(CH_ELBOW, BLOCK_ANGLE_CH2);
  delay(200);

  // Stage 5: Channel 1 - Shoulder reaches forward smoothly (120° -> 75°)
  setPositionalJoint(CH_SHOULDER, BLOCK_ANGLE_CH1);
  delay(200);

  persistState();
  currentArmState = STATE_BLOCKED;
  Serial.println(F("BLOCK_OK"));
}

// RETRIEVE (v1.3): Posture corrected.
// 1. Retract fully to the resting home dock (base centered at 90°) in strict
//    reverse joint order (Ch5 -> Ch4 -> Ch3 -> Ch2 -> Ch1 -> Ch0).
// 2. If holding the cardboard: pan 75° left to the dock, lower Ch1/Ch2,
//    release the cardboard, and retract back to the resting home dock.
void executeRetrieve() {
  // Already resting at home (and not holding the card): acknowledge instantly
  // so startup/baseline homing never re-moves a docked arm.
  if (currentArmState == STATE_DOCKED && !cardInClaw) {
    Serial.println(F("RETRIEVE_OK"));
    return;
  }
  currentArmState = STATE_BUSY;
  persistState();

  // Stage 1: Retract to the resting home dock (strict reverse joint order)
  // Ch5: Gripper affirms firm clamp on cardboard
  gripperClose();
  delay(100);

  // Ch4: Wrist pitch lifts card up from screen view (120° -> 90°)
  setPositionalJoint(CH_WRIST_4, BASE_ANGLE_CH4);
  delay(100);

  // Ch3: Wrist roll kept level (90°)
  moveWrist3ToAngle(BASE_ANGLE_CH3);
  delay(100);

  // Ch2: Forearm folds fully back toward the body (140° -> 180°)
  setPositionalJoint(CH_ELBOW, BASE_ANGLE_CH2);
  delay(150);

  // Ch1: Shoulder reclines to resting angle (75° -> 135°)
  setPositionalJoint(CH_SHOULDER, BASE_ANGLE_CH1);
  delay(150);

  // Ch0: Base is already centered in front of the screen (90°)
  moveBaseToAngle(BASE_ANGLE_CH0);
  delay(200);

  // Stage 2: Return the cardboard to the left dock (pan 75° left, drop, home)
  if (enablePickupSequence && cardInClaw) {
    executePutback();
  }

  persistState();
  currentArmState = STATE_DOCKED;
  Serial.println(F("RETRIEVE_OK"));
}

void printStatus() {
  switch (currentArmState) {
    case STATE_DOCKED:  Serial.println(F("STATE_DOCKED")); break;
    case STATE_BLOCKED: Serial.println(F("STATE_BLOCKED")); break;
    case STATE_BUSY:    Serial.println(F("STATE_BUSY")); break;
  }
}

void setup() {
  Serial.begin(115200);
  while (!Serial && millis() < 2000) { ; }

  Wire.begin();
  delay(100);

  pwm.begin();
  pwm.setOscillatorFrequency(27000000);
  pwm.setPWMFreq(SERVO_FREQ);

  stopAllMotors();
  currentArmState = STATE_DOCKED;

  // BOOT RECOVERY (v1.3): the Uno resets whenever the backend opens the
  // serial port and on power cycles. Restore the last persisted arm state so
  // "no matter where the arm is" it first comes back to the resting home
  // dock. If it was left blocked/busy or still holds the cardboard, retract
  // and put the cardboard back BEFORE accepting commands. If it was already
  // docked, the arm does not move at all.
  if (restoreState()) {
    if (cardInClaw || currentArmState != STATE_DOCKED) {
      executeRetrieve();
    }
  }
  currentArmState = STATE_DOCKED;
  persistState();

  Serial.println(F("PostureGuard Firmware v1.5 Ready (Full-Torque Gripper Active-Hold, Zero-Rebound Base)."));
}

void loop() {
  if (Serial.available() > 0) {
    String input = Serial.readStringUntil('\n');
    input.trim();
    input.toUpperCase();

    if (input.length() == 0) return;

    // --- Official Protocol Commands ---
    if (input == "BLOCK") {
      executeBlock();
    }
    else if (input == "RETRIEVE") {
      executeRetrieve();
    }
    else if (input == "STATUS") {
      printStatus();
    }
    // --- Diagnostics / Direct Controls ---
    else if (input == "HOME" || input == "BASE") {
      homeArm();
      Serial.println(F("HOME_OK"));
    }
    else if (input == "OPEN" || input == "O") {
      gripperOpen();
      Serial.println(F("OPEN_OK"));
    }
    else if (input == "CLOSE" || input == "C") {
      gripperClose();
      Serial.println(F("CLOSE_OK"));
    }
    else if (input.startsWith("SETOPEN ")) {
      gripperOpenAngle = constrain(input.substring(8).toInt(), 10, 170);
      Serial.println(F("SETOPEN_OK"));
    }
    else if (input.startsWith("SETCLOSE ")) {
      gripperCloseAngle = constrain(input.substring(9).toInt(), 10, 170);
      Serial.println(F("SETCLOSE_OK"));
    }
    else if (input.startsWith("HOLD 5 ") || input.startsWith("SETHOLD 5 ")) {
      int h = input.substring(input.lastIndexOf(' ') + 1).toInt();
      gripperHoldPower = (h != 0);
      Serial.println(F("HOLD5_OK"));
    }
    else if (input == "STOP" || input == "OFF") {
      stopAllMotors();
      Serial.println(F("STOP_OK"));
    }
    // Cardboard Pickup & Dock Commands
    else if (input == "PICKUP") {
      executePickup();
      Serial.println(F("PICKUP_OK"));
    }
    else if (input == "PUTBACK" || input == "DROPOFF") {
      executePutback();
      Serial.println(F("PUTBACK_OK"));
    }
    else if (input.startsWith("SETPICKUP ")) {
      int p0, p1, p2, p4;
      if (sscanf(input.c_str(), "SETPICKUP %d %d %d %d", &p0, &p1, &p2, &p4) == 4) {
        pickupAngleCh0 = constrain(p0, 0, 180);
        pickupAngleCh1 = constrain(p1, 0, 180);
        pickupAngleCh2 = constrain(p2, 0, 180);
        pickupAngleCh4 = constrain(p4, 0, 180);
        Serial.println(F("SETPICKUP_OK"));
      } else {
        Serial.println(F("ERROR_BAD_ARGS"));
      }
    }
    else if (input == "GETPICKUP") {
      Serial.print(F("PICKUP_ANGLES "));
      Serial.print(pickupAngleCh0); Serial.print(' ');
      Serial.print(pickupAngleCh1); Serial.print(' ');
      Serial.print(pickupAngleCh2); Serial.print(' ');
      Serial.println(pickupAngleCh4);
    }
    else if (input.startsWith("PICKUPMODE ")) {
      int mode = input.substring(11).toInt();
      enablePickupSequence = (mode != 0);
      Serial.println(F("PICKUPMODE_OK"));
    }
    else if (input.startsWith("CARD ")) {
      int c = input.substring(5).toInt();
      cardInClaw = (c != 0);
      Serial.println(F("CARD_OK"));
    }
    // Base 360 Continuous Commands (Channel 0)
    else if (input.startsWith("BASE CW ") || input.startsWith("0 CW ")) {
      int ms = input.substring(input.lastIndexOf(' ') + 1).toInt();
      rotateBaseContinuous(1, ms);
      Serial.println(F("BASE_CW_OK"));
    }
    else if (input.startsWith("BASE CCW ") || input.startsWith("0 CCW ")) {
      int ms = input.substring(input.lastIndexOf(' ') + 1).toInt();
      rotateBaseContinuous(-1, ms);
      Serial.println(F("BASE_CCW_OK"));
    }
    else if (input.startsWith("BASE LEFT ") || input.startsWith("0 LEFT ")) {
      int ms = input.substring(input.lastIndexOf(' ') + 1).toInt();
      rotateBaseContinuous(-1, ms);
      Serial.println(F("BASE_LEFT_OK"));
    }
    else if (input.startsWith("BASE RIGHT ") || input.startsWith("0 RIGHT ")) {
      int ms = input.substring(input.lastIndexOf(' ') + 1).toInt();
      rotateBaseContinuous(1, ms);
      Serial.println(F("BASE_RIGHT_OK"));
    }
    else if (input.startsWith("BASE SPIN ") || input.startsWith("0 SPIN ")) {
      int deg = input.substring(input.lastIndexOf(' ') + 1).toInt();
      rotateBaseContinuous(deg >= 0 ? 1 : -1, abs(deg) * MS_PER_DEG_BASE);
      Serial.println(F("BASE_SPIN_OK"));
    }
    else if (input.startsWith("BASE ")) {
      int ang = input.substring(5).toInt();
      moveBaseToAngle(ang);
      Serial.println(F("BASE_OK"));
    }
    // Wrist Roll Commands (Channel 3)
    else if (input.startsWith("WRIST3 CW ") || input.startsWith("3 CW ")) {
      int ms = input.substring(input.lastIndexOf(' ') + 1).toInt();
      moveWrist3Continuous(1, ms);
      Serial.println(F("WRIST3_CW_OK"));
    }
    else if (input.startsWith("WRIST3 CCW ") || input.startsWith("3 CCW ")) {
      int ms = input.substring(input.lastIndexOf(' ') + 1).toInt();
      moveWrist3Continuous(-1, ms);
      Serial.println(F("WRIST3_CCW_OK"));
    }
    else if (input.startsWith("WRIST3 LEFT ") || input.startsWith("3 LEFT ")) {
      int ms = input.substring(input.lastIndexOf(' ') + 1).toInt();
      moveWrist3Continuous(-1, ms);
      Serial.println(F("WRIST3_LEFT_OK"));
    }
    else if (input.startsWith("WRIST3 RIGHT ") || input.startsWith("3 RIGHT ")) {
      int ms = input.substring(input.lastIndexOf(' ') + 1).toInt();
      moveWrist3Continuous(1, ms);
      Serial.println(F("WRIST3_RIGHT_OK"));
    }
    else if (input == "MODE 3 180" || input == "3 MODE 180") {
      wrist3IsPositional = true;
      Serial.println(F("WRIST3_MODE_180_OK"));
    }
    else if (input == "MODE 3 360" || input == "3 MODE 360") {
      wrist3IsPositional = false;
      Serial.println(F("WRIST3_MODE_360_OK"));
    }
    else if (input == "RESET 3" || input == "3 RESET") {
      wrist3Angle = 90;
      Serial.println(F("WRIST3_RESET_OK"));
    }
    else if (input.startsWith("WRIST3 ")) {
      int ang = input.substring(7).toInt();
      moveWrist3ToAngle(ang);
      Serial.println(F("WRIST3_OK"));
    }
    // Gripper & Pitch Commands
    else if (input.startsWith("SERVO 5 ")) {
      int ang = input.substring(8).toInt();
      moveGripperPositional(ang);
      Serial.println(F("SERVO5_OK"));
    }
    else if (input.startsWith("PITCH ")) {
      int ang = input.substring(6).toInt();
      setWristPitch(ang);
      Serial.println(F("PITCH_OK"));
    }
    // General Format: "<channel> <value>"
    else {
      int spaceIdx = input.indexOf(' ');
      if (spaceIdx > 0) {
        int ch = input.substring(0, spaceIdx).toInt();
        int val = input.substring(spaceIdx + 1).toInt();
        if (ch == 0) {
          moveBaseToAngle(val);
        } else if (ch == 5) {
          moveGripperPositional(val);
        } else if (ch == 3) {
          moveWrist3ToAngle(val);
        } else if (ch == 4) {
          setWristPitch(val);
        } else if (ch >= 1 && ch <= 2) {
          setPositionalJoint(ch, val);
        }
        Serial.println(F("MOVE_OK"));
      } else {
        Serial.println(F("ERROR_UNKNOWN_COMMAND"));
      }
    }

    // Persist tracked state after every processed command so the boot
    // recovery always knows where the arm physically is.
    persistState();
  }
}
