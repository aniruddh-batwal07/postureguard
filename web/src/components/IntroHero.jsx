import React from 'react';

export default function IntroHero() {
  return (
    <section className="intro-hero" aria-label="PostureGuard introduction">
      <div className="hero-content">
        <div className="hero-badge">Smart Posture Monitoring System</div>
        <h1 className="hero-title">PostureGuard Dashboard</h1>
        <p className="hero-description">
          PostureGuard combines continuous webcam-based computer vision posture tracking with a physical robotic screen-blocking arm to help maintain healthy ergonomic habits during work sessions.
        </p>
      </div>
    </section>
  );
}
