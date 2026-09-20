import React from 'react';

export default function OverviewPage({
  onEnterSession,
  sessionActive,
  savedBaseline,
  onOpenSettings,
}) {
  return (
    <div className="overview-page">
      {/* Hero Section */}
      <section className="overview-hero" aria-label="PostureGuard introduction">
        <div className="hero-eyebrow">
          <span className="eyebrow-pill">Hardware-Enforced Ergonomics</span>
          <span className="eyebrow-version">v1.0 Production</span>
        </div>

        <h1 className="hero-title">PostureGuard Dashboard</h1>

        <p className="hero-description">
          PostureGuard combines continuous webcam-based computer vision posture tracking with a physical robotic screen-blocking arm to help maintain healthy ergonomic habits during work sessions.
        </p>

        <div className="hero-actions">
          <button
            type="button"
            className="btn btn-primary btn-hero-cta"
            onClick={onEnterSession}
          >
            {sessionActive ? 'Resume Active Session →' : 'Enter Session Workspace →'}
          </button>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={onOpenSettings}
          >
            Configure Settings
          </button>
        </div>

        {sessionActive && (
          <div className="hero-active-alert">
            <span className="alert-pulse-dot"></span>
            A monitoring session is currently active. Click &ldquo;Resume Active Session&rdquo; to monitor or end it.
          </div>
        )}
      </section>

      {/* 3-Pillar Operational Flow */}
      <section className="architecture-section" aria-label="System architecture">
        <h2 className="section-title">How PostureGuard Works</h2>
        <p className="section-subtitle">
          Unlike gentle software notifications that get ignored, PostureGuard enforces spinal alignment through physical feedback.
        </p>

        <div className="architecture-grid">
          <div className="flow-card">
            <div className="card-number">01</div>
            <h3 className="flow-title">Computer Vision Engine</h3>
            <p className="flow-description">
              A background daemon runs OpenCV and MediaPipe Pose at 30 frames per second. It computes head forward translation, vertical head drop, and shoulder roll in 3D relative to your calibrated upright baseline.
            </p>
          </div>

          <div className="flow-card">
            <div className="card-number">02</div>
            <h3 className="flow-title">2-Second Debounce Window</h3>
            <p className="flow-description">
              Transient movements (drinking coffee, adjusting glasses, nodding) are filtered out by a configurable 2.0-second hysteresis filter. Intervention triggers only when a slouch is sustained.
            </p>
          </div>

          <div className="flow-card">
            <div className="card-number">03</div>
            <h3 className="flow-title">Physical Screen Intervention</h3>
            <p className="flow-description">
              When slouching persists, an Arduino-driven 4-DOF robotic arm swings a physical card directly in front of your display. Correcting your posture immediately retracts the arm back to its docked state.
            </p>
          </div>
        </div>
      </section>

      {/* System Specifications & Telemetry */}
      <section className="telemetry-section" aria-label="System status">
        <h2 className="section-title">Hardware &amp; System Integration</h2>
        <div className="telemetry-grid">
          <div className="telemetry-card">
            <span className="telemetry-label">Robotic Arm Actuator</span>
            <span className="telemetry-value text-success">Arduino Uno (COM13)</span>
            <p className="telemetry-meta">
              4x SG90/MG90S servos with soft PWM cutoff to prevent overheating and zero holding-torque wear.
            </p>
          </div>

          <div className="telemetry-card">
            <span className="telemetry-label">Vision Sensor</span>
            <span className="telemetry-value text-success">Integrated Webcam</span>
            <p className="telemetry-meta">
              Windows Media Foundation backend with low-latency frame extraction and landmark tracking.
            </p>
          </div>

          <div className="telemetry-card">
            <span className="telemetry-label">Saved Baseline Angle</span>
            <span className="telemetry-value">
              {savedBaseline ? 'Configured in Storage' : 'Needs Calibration'}
            </span>
            <p className="telemetry-meta">
              {savedBaseline
                ? `HF: ${(savedBaseline.head_forward ?? savedBaseline.headForward ?? 0).toFixed(2)} | HD: ${(savedBaseline.head_drop ?? savedBaseline.headDrop ?? 0).toFixed(2)} | SR: ${(savedBaseline.shoulder_roll ?? savedBaseline.shoulderRoll ?? 0).toFixed(2)}`
                : 'Calibrate once in the session workspace to save your reference posture.'}
            </p>
          </div>
        </div>
      </section>

      {/* Action Footer */}
      <div className="overview-cta-strip">
        <div>
          <h3 className="cta-strip-title">Ready to begin your session?</h3>
          <p className="cta-strip-subtitle">Launch posture monitoring with physical robotic enforcement.</p>
        </div>
        <button
          type="button"
          className="btn btn-primary"
          onClick={onEnterSession}
        >
          Open Session Workspace →
        </button>
      </div>
    </div>
  );
}
