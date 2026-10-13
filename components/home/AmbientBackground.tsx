'use client';

import React, { useEffect, useState, useCallback } from 'react';
import Image from 'next/image';

export default function AmbientBackground() {
  const [isReducedMotion, setIsReducedMotion] = useState(false);
  const [mouseOffset, setMouseOffset] = useState({ x: 0, y: 0 });

  // Handle accessibility
  useEffect(() => {
    const mediaQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
    setIsReducedMotion(mediaQuery.matches);

    const handleMotionChange = (e: MediaQueryListEvent) => setIsReducedMotion(e.matches);
    mediaQuery.addEventListener('change', handleMotionChange);

    return () => {
      mediaQuery.removeEventListener('change', handleMotionChange);
    };
  }, []);

  // Subtle interactive 3D parallax on mouse movement for desktop
  const handleMouseMove = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (window.innerWidth < 768) return;
    const { clientX, clientY } = e;
    const { innerWidth, innerHeight } = window;
    const offsetX = (clientX / innerWidth - 0.5) * 2;
    const offsetY = (clientY / innerHeight - 0.5) * 2;
    setMouseOffset({ x: offsetX, y: offsetY });
  }, []);

  const mouseTranslateX = isReducedMotion ? 0 : mouseOffset.x * 12;
  const mouseTranslateY = isReducedMotion ? 0 : mouseOffset.y * 8;

  return (
    <div
      aria-hidden="true"
      onMouseMove={handleMouseMove}
      className="pointer-events-none absolute inset-0 -z-10 overflow-hidden bg-[#0A0A09]"
    >
      {/* Dynamic Keyframe Animations */}
      <style>{`
        @keyframes heroCameraDrift {
          0% { transform: scale(1.02) translate(0, 0); }
          50% { transform: scale(1.045) translate(-0.6%, -0.4%); }
          100% { transform: scale(1.02) translate(0, 0); }
        }
        @keyframes scanlineSweepHero {
          0% { transform: translateY(-100%); opacity: 0; }
          20% { opacity: 0.5; }
          80% { opacity: 0.5; }
          100% { transform: translateY(600%); opacity: 0; }
        }
        @keyframes hologramPulseCyanHero {
          0%, 100% { opacity: 0.35; transform: scale(1); }
          50% { opacity: 0.7; transform: scale(1.08); }
        }
        @keyframes hologramPulseGoldHero {
          0%, 100% { opacity: 0.3; transform: scale(1); }
          50% { opacity: 0.65; transform: scale(1.06); }
        }
      `}</style>

      {/* 1. HD VEILIO Exchange Auction Floor Container strictly inside the Hero */}
      <div
        className="absolute inset-0 h-full w-full will-change-transform transition-transform duration-300 ease-out"
        style={{
          transform: `translate3d(${mouseTranslateX}px, ${mouseTranslateY}px, 0)`,
        }}
      >
        <div
          className="relative h-full w-full"
          style={{
            animation: isReducedMotion ? 'none' : 'heroCameraDrift 24s ease-in-out infinite alternate',
          }}
        >
          {/* Ambient Video Background */}
          <video
            autoPlay
            loop
            muted
            playsInline
            preload="auto"
            poster="/veilio-city-exchange.jpg"
            className="absolute inset-0 h-full w-full object-cover object-[center_60%] opacity-95 md:opacity-100 brightness-[1.14] contrast-[1.05]"
          >
            <source src="/vid/gemini_generated_video_e2ba3af4.mp4" type="video/mp4" />
          </video>

          {/* 2. Cyberpunk Scanline Grid */}
          <div
            className="absolute inset-0 opacity-[0.08] pointer-events-none"
            style={{
              backgroundImage: 'repeating-linear-gradient(to bottom, transparent 0px, transparent 3px, rgba(0, 229, 255, 0.25) 4px, transparent 5px)',
            }}
          />

          {/* 3. Holographic Beam Sweep across the auction hall */}
          <div
            className="absolute inset-x-0 h-32 bg-gradient-to-b from-transparent via-cyan-400/[0.08] to-transparent pointer-events-none"
            style={{
              animation: isReducedMotion ? 'none' : 'scanlineSweepHero 8s cubic-bezier(0.4, 0, 0.2, 1) infinite',
            }}
          />

          {/* 4. Ambient Neon Glow Flares */}
          <div
            className="absolute left-1/2 top-[32%] h-[340px] w-[560px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[#C9A45C]/[0.18] blur-[130px]"
            style={{
              animation: isReducedMotion ? 'none' : 'hologramPulseGoldHero 6s ease-in-out infinite',
            }}
          />
          <div
            className="absolute left-[12%] top-[45%] h-[260px] w-[300px] rounded-full bg-cyan-400/[0.16] blur-[110px]"
            style={{
              animation: isReducedMotion ? 'none' : 'hologramPulseCyanHero 7s ease-in-out infinite 1s',
            }}
          />
          <div
            className="absolute right-[12%] top-[45%] h-[260px] w-[300px] rounded-full bg-cyan-500/[0.16] blur-[110px]"
            style={{
              animation: isReducedMotion ? 'none' : 'hologramPulseCyanHero 7.5s ease-in-out infinite 2.5s',
            }}
          />

          {/* Top header fade - Softened so video shines through transparent navbar */}
          <div className="absolute inset-x-0 top-0 h-[80px] bg-gradient-to-b from-black/40 to-transparent" />

          {/* Center text backdrop vignette */}
          <div className="absolute inset-0 bg-[radial-gradient(ellipse_75%_55%_at_50%_32%,rgba(10,10,9,0.48)_0%,rgba(10,10,9,0.18)_55%,transparent_100%)]" />

          {/* Bottom fade cleanly blending into the next section */}
          <div className="absolute inset-x-0 bottom-0 h-[180px] bg-gradient-to-t from-[#0A0A09] via-[#0A0A09]/65 to-transparent" />
        </div>
      </div>
    </div>
  );
}
