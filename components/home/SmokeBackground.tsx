'use client';

import React, { useEffect, useRef } from 'react';

interface Puff {
  x: number;
  y: number;
  radius: number;
  vx: number;
  vy: number;
  rotation: number;
  spin: number;
  alpha: number;
  sprite: HTMLCanvasElement;
}

// Dark + gold palette: mostly warm grey haze with a few gold-tinted wisps.
const SMOKE_TINTS: Array<[number, number, number]> = [
  [226, 193, 124], // #E2C17C gold
  [201, 164, 92], // #C9A45C deep gold
  [168, 163, 151], // #A8A397 warm grey
  [120, 116, 108], // muted grey
];

// Render at reduced resolution: smoke is soft, so the upscale blur is free anti-aliasing.
const RENDER_SCALE = 0.35;
const SPRITE_SIZE = 256;

function createSmokeSprite([r, g, b]: [number, number, number]): HTMLCanvasElement {
  const sprite = document.createElement('canvas');
  sprite.width = SPRITE_SIZE;
  sprite.height = SPRITE_SIZE;
  const ctx = sprite.getContext('2d');
  if (!ctx) return sprite;

  // Several offset soft blobs give each puff an irregular, billowy edge instead of a perfect circle.
  for (let i = 0; i < 6; i++) {
    const cx = SPRITE_SIZE / 2 + (Math.random() - 0.5) * SPRITE_SIZE * 0.3;
    const cy = SPRITE_SIZE / 2 + (Math.random() - 0.5) * SPRITE_SIZE * 0.3;
    const radius = SPRITE_SIZE * (0.22 + Math.random() * 0.18);
    const gradient = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius);
    gradient.addColorStop(0, `rgba(${r}, ${g}, ${b}, 0.35)`);
    gradient.addColorStop(0.5, `rgba(${r}, ${g}, ${b}, 0.12)`);
    gradient.addColorStop(1, `rgba(${r}, ${g}, ${b}, 0)`);
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, SPRITE_SIZE, SPRITE_SIZE);
  }
  return sprite;
}

/**
 * Full-viewport, fixed smoke/mist backdrop. Stays in place while the page scrolls.
 * Canvas 2D only (no deps); pauses when the tab is hidden and renders a single
 * static frame when the user prefers reduced motion.
 */
export default function SmokeBackground() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
    const sprites = SMOKE_TINTS.map(createSmokeSprite);
    let width = 0;
    let height = 0;
    let puffs: Puff[] = [];
    let animationFrameId = 0;
    let lastTime = 0;

    const spawnPuff = (initial: boolean): Puff => {
      const radius = (Math.random() * 0.25 + 0.18) * Math.max(width, height);
      // Gold tints are rarer so the haze reads as smoke first, gold accent second.
      const sprite = Math.random() < 0.3 ? sprites[Math.floor(Math.random() * 2)] : sprites[2 + Math.floor(Math.random() * 2)];
      return {
        x: Math.random() * width,
        y: initial ? Math.random() * height : height + radius * 0.6,
        radius,
        vx: (Math.random() - 0.5) * 6,
        vy: -(Math.random() * 6 + 3),
        rotation: Math.random() * Math.PI * 2,
        spin: (Math.random() - 0.5) * 0.04,
        alpha: Math.random() * 0.1 + 0.07,
        sprite,
      };
    };

    const resize = () => {
      width = Math.max(1, Math.floor(window.innerWidth * RENDER_SCALE));
      height = Math.max(1, Math.floor(window.innerHeight * RENDER_SCALE));
      canvas.width = width;
      canvas.height = height;
      // Fewer puffs on small screens keeps mobile GPUs cool.
      const count = window.innerWidth < 768 ? 14 : 24;
      puffs = Array.from({ length: count }, () => spawnPuff(true));
    };

    const draw = () => {
      ctx.globalCompositeOperation = 'source-over';
      ctx.fillStyle = '#000000';
      ctx.fillRect(0, 0, width, height);

      ctx.globalCompositeOperation = 'lighter';
      for (const puff of puffs) {
        // Fade puffs in from the bottom edge and out toward the top.
        const verticalFade = Math.min(1, Math.max(0, (puff.y + puff.radius * 0.5) / (height * 0.6)));
        ctx.globalAlpha = puff.alpha * verticalFade;
        ctx.save();
        ctx.translate(puff.x, puff.y);
        ctx.rotate(puff.rotation);
        ctx.drawImage(puff.sprite, -puff.radius, -puff.radius, puff.radius * 2, puff.radius * 2);
        ctx.restore();
      }
      ctx.globalAlpha = 1;
    };

    const step = (time: number) => {
      const dt = lastTime ? Math.min((time - lastTime) / 1000, 0.1) : 0;
      lastTime = time;
      for (let i = 0; i < puffs.length; i++) {
        const puff = puffs[i];
        puff.x += puff.vx * dt;
        puff.y += puff.vy * dt;
        puff.rotation += puff.spin * dt;
        if (puff.y + puff.radius < 0 || puff.x + puff.radius < 0 || puff.x - puff.radius > width) {
          puffs[i] = spawnPuff(false);
        }
      }
      draw();
      animationFrameId = requestAnimationFrame(step);
    };

    const start = () => {
      cancelAnimationFrame(animationFrameId);
      lastTime = 0;
      if (reducedMotion.matches) {
        draw();
        return;
      }
      animationFrameId = requestAnimationFrame(step);
    };

    const handleVisibility = () => {
      if (document.hidden) cancelAnimationFrame(animationFrameId);
      else start();
    };

    const handleResize = () => {
      resize();
      start();
    };

    resize();
    start();
    window.addEventListener('resize', handleResize);
    document.addEventListener('visibilitychange', handleVisibility);
    reducedMotion.addEventListener('change', start);

    return () => {
      cancelAnimationFrame(animationFrameId);
      window.removeEventListener('resize', handleResize);
      document.removeEventListener('visibilitychange', handleVisibility);
      reducedMotion.removeEventListener('change', start);
    };
  }, []);

  return (
    <div aria-hidden="true" className="pointer-events-none fixed inset-0 z-0">
      <canvas ref={canvasRef} className="h-full w-full" />
      {/* Vignette keeps text contrast high at the edges and over the hero copy. */}
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,transparent_0%,rgba(0,0,0,0.35)_60%,rgba(0,0,0,0.85)_100%)]" />
    </div>
  );
}
