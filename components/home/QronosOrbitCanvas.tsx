'use client';

import React, { useEffect, useRef } from 'react';

interface Particle {
  y: number; // -1 to 1 along height
  theta: number; // 0 to 2*PI angle
  speedY: number;
  speedTheta: number;
  size: number;
  alpha: number;
  twinklePhase: number;
  isDiamond: boolean;
}

export default function QronosOrbitCanvas() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) return;

    let animationFrameId: number;
    let width = (canvas.width = canvas.parentElement?.clientWidth || window.innerWidth);
    let height = (canvas.height = canvas.parentElement?.clientHeight || window.innerHeight);

    // DPR handling
    const updateSize = () => {
      if (!canvas) return;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      width = canvas.parentElement?.clientWidth || window.innerWidth;
      height = canvas.parentElement?.clientHeight || window.innerHeight;
      canvas.width = width * dpr;
      canvas.height = height * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    updateSize();
    window.addEventListener('resize', updateSize);

    // Interactive mouse parallax
    let mouseX = 0;
    let mouseY = 0;
    let targetRotY = 0;
    let targetRotX = 0.22; // subtle forward tilt to look down into the vortex
    let currentRotY = 0;
    let currentRotX = 0.22;

    const handleMouseMove = (e: MouseEvent) => {
      const rect = canvas.getBoundingClientRect();
      const x = (e.clientX - rect.left) / width - 0.5;
      const y = (e.clientY - rect.top) / height - 0.5;
      mouseX = x;
      mouseY = y;
    };
    window.addEventListener('mousemove', handleMouseMove, { passive: true });

    // Hyperboloid parameters
    // x^2 + z^2 = R_waist^2 * (1 + (y / y0)^2)
    const H = 520; // expanded half-height
    const R_WAIST = 135; // widened waist radius
    const Y0 = 260; // curvature falloff

    const getRadius = (y: number) => {
      return R_WAIST * Math.sqrt(1 + (y / Y0) * (y / Y0));
    };

    // Build ruled generator lines (clockwise & counterclockwise helices)
    const NUM_LINES = 130;
    const TWIST_ANGLE = 2.45; // in radians (~140 deg twist)

    // Build particles along hyperboloid
    const NUM_PARTICLES = 650;
    const particles: Particle[] = [];
    for (let i = 0; i < NUM_PARTICLES; i++) {
      particles.push({
        y: (Math.random() * 2 - 1) * H,
        theta: Math.random() * Math.PI * 2,
        speedY: (Math.random() * 0.4 + 0.15) * (Math.random() > 0.5 ? 1 : -1),
        speedTheta: (Math.random() * 0.002 + 0.001) * (Math.random() > 0.5 ? 1 : -1),
        size: Math.random() * 1.5 + 0.6,
        alpha: Math.random() * 0.6 + 0.3,
        twinklePhase: Math.random() * Math.PI * 2,
        isDiamond: Math.random() < 0.12, // 12% diamonds
      });
    }

    // Helper to draw 4-pointed micro diamond/star
    const drawDiamond = (
      context: CanvasRenderingContext2D,
      x: number,
      y: number,
      size: number,
      alpha: number
    ) => {
      context.save();
      context.fillStyle = `rgba(255, 255, 255, ${alpha})`;
      context.beginPath();
      context.moveTo(x, y - size * 2.2);
      context.lineTo(x + size * 0.7, y);
      context.lineTo(x, y + size * 2.2);
      context.lineTo(x - size * 0.7, y);
      context.closePath();
      context.fill();

      // Cross sparkle horizontal
      context.beginPath();
      context.moveTo(x - size * 2.2, y);
      context.lineTo(x, y + size * 0.7);
      context.lineTo(x + size * 2.2, y);
      context.lineTo(x, y - size * 0.7);
      context.closePath();
      context.fill();
      context.restore();
    };

    let lastTime = performance.now();
    let globalAngle = 0;

    const render = (now: number) => {
      const dt = Math.min((now - lastTime) / 1000, 0.1);
      lastTime = now;

      // Base auto rotation + mouse interaction
      globalAngle += dt * 0.09; // slow cosmic drift
      targetRotY = globalAngle + mouseX * 0.4;
      targetRotX = 0.22 + mouseY * 0.25;

      // Smooth interpolation
      currentRotY += (targetRotY - currentRotY) * 0.06;
      currentRotX += (targetRotX - currentRotX) * 0.06;

      const cosRotY = Math.cos(currentRotY);
      const sinRotY = Math.sin(currentRotY);
      const cosRotX = Math.cos(currentRotX);
      const sinRotX = Math.sin(currentRotX);

      // Clear with pitch black
      ctx.fillStyle = '#000000';
      ctx.fillRect(0, 0, width, height);

      const cx = width / 2;
      // Position center of hourglass slightly below middle
      const cy = height * 0.48;
      const fov = 750;

      // 3D project helper
      const project = (x3: number, y3: number, z3: number) => {
        // Rotate around Y
        const xRotY = x3 * cosRotY - z3 * sinRotY;
        const zRotY = x3 * sinRotY + z3 * cosRotY;

        // Rotate around X (tilt)
        const yRotX = y3 * cosRotX - zRotY * sinRotX;
        const zRotX = y3 * sinRotX + zRotY * cosRotX;

        // Perspective
        const depth = zRotX + fov;
        const scale = fov / Math.max(depth, 10);
        return {
          x: cx + xRotY * scale,
          y: cy + yRotX * scale,
          z: zRotX,
          scale,
        };
      };

      // 1. Draw Ruled Surface Curves
      // Sample lines from -H to +H with twist
      const SAMPLES = 28;
      const lineStep = (Math.PI * 2) / NUM_LINES;

      ctx.lineWidth = 0.85;

      // Draw clockwise ruled curves
      for (let i = 0; i < NUM_LINES; i++) {
        const baseTheta = i * lineStep;
        let prevPt: { x: number; y: number; z: number; scale: number } | null = null;
        let avgZ = 0;

        // Determine average Z for depth fading
        const midR = getRadius(0);
        const midX = midR * Math.cos(baseTheta);
        const midZ = midR * Math.sin(baseTheta);
        const midRotZ = midX * sinRotY + midZ * cosRotY;
        avgZ = midRotZ;

        // Depth alpha: front is brighter, back is softer
        const depthAlpha = Math.max(0.04, Math.min(0.32, (avgZ + 350) / 700 * 0.32));
        ctx.strokeStyle = `rgba(235, 235, 245, ${depthAlpha})`;

        ctx.beginPath();
        for (let s = 0; s <= SAMPLES; s++) {
          const t = s / SAMPLES; // 0 to 1
          const y = (t * 2 - 1) * H;
          const r = getRadius(y);
          const theta = baseTheta + (t - 0.5) * TWIST_ANGLE;
          const x3 = r * Math.cos(theta);
          const z3 = r * Math.sin(theta);

          const pt = project(x3, y, z3);
          if (s === 0) {
            ctx.moveTo(pt.x, pt.y);
          } else {
            ctx.lineTo(pt.x, pt.y);
          }
        }
        ctx.stroke();
      }

      // Draw counter-clockwise ruled curves for crossing diamond weave
      for (let i = 0; i < NUM_LINES; i += 2) {
        const baseTheta = i * lineStep;
        const midR = getRadius(0);
        const midX = midR * Math.cos(baseTheta);
        const midZ = midR * Math.sin(baseTheta);
        const midRotZ = midX * sinRotY + midZ * cosRotY;

        const depthAlpha = Math.max(0.02, Math.min(0.2, (midRotZ + 350) / 700 * 0.2));
        ctx.strokeStyle = `rgba(226, 193, 124, ${depthAlpha * 0.85})`; // subtle champagne gold accent

        ctx.beginPath();
        for (let s = 0; s <= SAMPLES; s++) {
          const t = s / SAMPLES;
          const y = (t * 2 - 1) * H;
          const r = getRadius(y);
          const theta = baseTheta - (t - 0.5) * TWIST_ANGLE;
          const x3 = r * Math.cos(theta);
          const z3 = r * Math.sin(theta);

          const pt = project(x3, y, z3);
          if (s === 0) {
            ctx.moveTo(pt.x, pt.y);
          } else {
            ctx.lineTo(pt.x, pt.y);
          }
        }
        ctx.stroke();
      }

      // 2. Draw Particles & Diamond Sparkles
      for (let i = 0; i < particles.length; i++) {
        const p = particles[i];

        // Update physics
        p.y += p.speedY;
        p.theta += p.speedTheta;
        p.twinklePhase += dt * 3;

        // Wrap around height
        if (p.y > H) p.y = -H;
        if (p.y < -H) p.y = H;

        // Position on hyperboloid
        const r = getRadius(p.y);
        const x3 = r * Math.cos(p.theta);
        const z3 = r * Math.sin(p.theta);

        const pt = project(x3, p.y, z3);

        // Alpha calculation with distance & twinkle
        const depthNorm = Math.max(0, Math.min(1, (pt.z + 400) / 800));
        const twinkle = 0.7 + 0.3 * Math.sin(p.twinklePhase);
        const finalAlpha = Math.max(0.05, Math.min(1, p.alpha * depthNorm * twinkle));

        const radius = Math.max(0.5, p.size * pt.scale);

        if (p.isDiamond && depthNorm > 0.4) {
          drawDiamond(ctx, pt.x, pt.y, radius * 1.5, finalAlpha);
        } else {
          ctx.beginPath();
          ctx.arc(pt.x, pt.y, radius, 0, Math.PI * 2);
          // Pure white or soft gold center
          if (i % 5 === 0) {
            ctx.fillStyle = `rgba(226, 193, 124, ${finalAlpha})`;
          } else {
            ctx.fillStyle = `rgba(255, 255, 255, ${finalAlpha})`;
          }
          ctx.fill();
        }
      }

      animationFrameId = requestAnimationFrame(render);
    };

    animationFrameId = requestAnimationFrame(render);

    return () => {
      cancelAnimationFrame(animationFrameId);
      window.removeEventListener('resize', updateSize);
      window.removeEventListener('mousemove', handleMouseMove);
    };
  }, []);

  return (
    <div className="absolute inset-0 z-0 h-full w-full overflow-hidden bg-black pointer-events-none select-none">
      <canvas
        ref={canvasRef}
        className="block h-full w-full will-change-transform"
        style={{ width: '100%', height: '100%' }}
      />
      {/* Side edge fades for cinematic depth */}
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-r from-black/85 via-transparent to-black/85" />
      {/* Top and bottom vignettes */}
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-black/50 via-transparent to-black" />
    </div>
  );
}
