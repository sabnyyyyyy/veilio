'use client';

import React, { useEffect, useRef, useState } from 'react';

// Configuration
const CONFIG = {
  desktopNodeCount: 80,
  tabletNodeCount: 40,
  mobileNodeCount: 25,
  connectionDistance: 180,
  baseLineOpacity: 0.22, // 0.14 - 0.22
  importantLineOpacity: 0.30, // 0.22 - 0.30
  goldLineOpacity: 0.40, // 0.25 - 0.40
  blipSpeed: 0.003,
  parallaxFactor: -0.02, // max 10-20px movement
};

interface Node {
  x: number;
  y: number;
  vx: number;
  vy: number;
  width: number;
  height: number;
  type: 'normal' | 'highlighted' | 'gold' | 'data-block';
  label?: string;
  opacity: number;
}

interface Blip {
  fromIdx: number;
  toIdx: number;
  progress: number;
}

const LABELS = ['01', '02', '03', 'DATA', 'IDX', 'AI', 'NET'];

export default function AmbientBackground() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [isReducedMotion, setIsReducedMotion] = useState(false);

  useEffect(() => {
    const mediaQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
    setIsReducedMotion(mediaQuery.matches);
    
    const listener = (e: MediaQueryListEvent) => setIsReducedMotion(e.matches);
    mediaQuery.addEventListener('change', listener);
    return () => mediaQuery.removeEventListener('change', listener);
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let animationFrameId: number;
    let nodes: Node[] = [];
    let blips: Blip[] = [];
    let width = 0;
    let height = 0;
    let scrollY = 0;

    const init = () => {
      width = window.innerWidth;
      height = window.innerHeight;
      canvas.width = width;
      canvas.height = height;
      scrollY = window.scrollY;

      let count = CONFIG.mobileNodeCount;
      if (width > 768) count = CONFIG.tabletNodeCount;
      if (width > 1024) count = CONFIG.desktopNodeCount;

      nodes = Array.from({ length: count }).map(() => {
        const rand = Math.random();
        let type: Node['type'] = 'normal';
        // Some nodes are secondary (fainter), some are normal
        let opacity = rand > 0.5 ? 0.22 + Math.random() * 0.10 : 0.15 + Math.random() * 0.07; 

        if (rand > 0.92) {
          type = 'gold';
          opacity = 0.50 + Math.random() * 0.20; // 0.50 - 0.70
        } else if (rand > 0.8) {
          type = 'highlighted';
          opacity = 0.35 + Math.random() * 0.15; // 0.35 - 0.50
        } else if (rand > 0.7) {
          type = 'data-block';
          opacity = 0.30 + Math.random() * 0.15;
        }

        const isLarge = type === 'data-block' || Math.random() > 0.85;
        const w = isLarge ? 8 + Math.random() * 6 : 4 + Math.random() * 3; // 8-14px or 4-7px
        const h = isLarge ? 8 + Math.random() * 6 : 4 + Math.random() * 3;

        let label;
        if (type === 'data-block' && w > 10) {
          label = LABELS[Math.floor(Math.random() * LABELS.length)];
        }

        return {
          x: Math.random() * width,
          y: Math.random() * height,
          vx: (Math.random() - 0.5) * 0.05, // Extremely slow drift
          vy: (Math.random() - 0.5) * 0.05,
          width: w,
          height: h,
          type,
          label,
          opacity
        };
      });
    };

    const draw = () => {
      ctx.clearRect(0, 0, width, height);
      
      // Draw subtle radial glows around clusters
      ctx.save();
      // Add a very subtle warm charcoal background light
      const grad = ctx.createRadialGradient(width * 0.7, height * 0.4, 0, width * 0.7, height * 0.4, 600);
      grad.addColorStop(0, 'rgba(201, 164, 92, 0.045)');
      grad.addColorStop(1, 'rgba(10, 10, 9, 0)');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, width, height);

      const grad2 = ctx.createRadialGradient(width * 0.2, height * 0.8, 0, width * 0.2, height * 0.8, 500);
      grad2.addColorStop(0, 'rgba(201, 164, 92, 0.035)');
      grad2.addColorStop(1, 'rgba(10, 10, 9, 0)');
      ctx.fillStyle = grad2;
      ctx.fillRect(0, 0, width, height);
      ctx.restore();

      ctx.save();
      const scrollOffset = scrollY * CONFIG.parallaxFactor;
      
      // Move nodes
      if (!isReducedMotion) {
        nodes.forEach((node) => {
          node.x += node.vx;
          node.y += node.vy;

          if (node.x < 0) node.x = width;
          if (node.x > width) node.x = 0;
          if (node.y < 0) node.y = height;
          if (node.y > height) node.y = 0;
        });

        // Maintain 1-3 active blips
        if (blips.length < 3 && Math.random() < 0.01) {
          const fromIdx = Math.floor(Math.random() * nodes.length);
          let toIdx = -1;
          let minDist = CONFIG.connectionDistance;
          
          nodes.forEach((other, idx) => {
            if (idx === fromIdx) return;
            const dx = other.x - nodes[fromIdx].x;
            const dy = other.y - nodes[fromIdx].y;
            const dist = Math.sqrt(dx * dx + dy * dy);
            if (dist < minDist) {
              minDist = dist;
              toIdx = idx;
            }
          });

          if (toIdx !== -1) {
            blips.push({ fromIdx, toIdx, progress: 0 });
          }
        }
      }

      // Draw connections
      nodes.forEach((node, i) => {
        const effectiveY1 = (node.y + scrollOffset) % height;
        const finalY1 = effectiveY1 < 0 ? effectiveY1 + height : effectiveY1;

        // Connect ~30% of nearby nodes to keep it sparse
        let connectionCount = 0;

        nodes.slice(i + 1).forEach((other) => {
          if (connectionCount > 2) return; // limit connections per node

          const effectiveY2 = (other.y + scrollOffset) % height;
          const finalY2 = effectiveY2 < 0 ? effectiveY2 + height : effectiveY2;

          const dx = other.x - node.x;
          const dy = finalY2 - finalY1; 
          const dist = Math.sqrt(dx * dx + dy * dy);

          if (dist < CONFIG.connectionDistance) {
            // Pseudo-random connection stability
            if ((node.x + other.x) % 100 > 35) return; 

            connectionCount++;
            
            const isGoldLine = node.type === 'gold' && other.type === 'gold';
            const isImportant = node.type === 'gold' || other.type === 'gold' || node.type === 'data-block';
            
            let baseOp = CONFIG.baseLineOpacity;
            if (isGoldLine) baseOp = CONFIG.goldLineOpacity;
            else if (isImportant) baseOp = CONFIG.importantLineOpacity;
            
            const opacity = (1 - dist / CONFIG.connectionDistance) * baseOp;
            
            ctx.beginPath();
            ctx.moveTo(node.x, finalY1);
            ctx.lineTo(other.x, finalY2);
            
            if (isGoldLine) {
              ctx.strokeStyle = `rgba(201, 164, 92, ${opacity})`;
            } else if (isImportant) {
              ctx.strokeStyle = `rgba(180, 165, 130, ${opacity})`;
            } else {
              ctx.strokeStyle = `rgba(168, 163, 151, ${opacity})`;
            }
            ctx.lineWidth = 1;
            ctx.stroke();
          }
        });
      });

      // Draw blips
      if (!isReducedMotion) {
        blips.forEach((blip, idx) => {
          blip.progress += CONFIG.blipSpeed;
          if (blip.progress > 1) {
            blips.splice(idx, 1);
            return;
          }

          const from = nodes[blip.fromIdx];
          const to = nodes[blip.toIdx];
          
          const fromEffectiveY = (from.y + scrollOffset) % height;
          const fromFinalY = fromEffectiveY < 0 ? fromEffectiveY + height : fromEffectiveY;
          
          const toEffectiveY = (to.y + scrollOffset) % height;
          const toFinalY = toEffectiveY < 0 ? toEffectiveY + height : toEffectiveY;

          if (Math.abs(toFinalY - fromFinalY) < CONFIG.connectionDistance) {
            const currentX = from.x + (to.x - from.x) * blip.progress;
            const currentY = fromFinalY + (toFinalY - fromFinalY) * blip.progress;

            ctx.beginPath();
            ctx.arc(currentX, currentY, 2, 0, Math.PI * 2);
            ctx.fillStyle = `rgba(201, 164, 92, ${0.8 - blip.progress * 0.3})`;
            ctx.fill();
            // Glow
            ctx.shadowBlur = 8;
            ctx.shadowColor = 'rgba(201, 164, 92, 0.5)';
            ctx.fill();
            ctx.shadowBlur = 0;
          }
        });
      }

      // Draw nodes
      nodes.forEach((node) => {
        const effectiveY = (node.y + scrollOffset) % height;
        const finalY = effectiveY < 0 ? effectiveY + height : effectiveY;
        
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.rect(node.x - node.width / 2, finalY - node.height / 2, node.width, node.height);
        
        if (node.type === 'gold') {
          ctx.fillStyle = `rgba(201, 164, 92, ${node.opacity})`;
          ctx.strokeStyle = `rgba(201, 164, 92, ${node.opacity + 0.2})`;
        } else if (node.type === 'highlighted') {
          ctx.fillStyle = `rgba(245, 242, 232, ${node.opacity})`;
          ctx.strokeStyle = `rgba(245, 242, 232, ${node.opacity + 0.1})`;
        } else if (node.type === 'data-block') {
          ctx.fillStyle = `rgba(168, 163, 151, ${node.opacity - 0.1})`;
          ctx.strokeStyle = Math.random() > 0.7 ? `rgba(201, 164, 92, 0.4)` : `rgba(168, 163, 151, 0.5)`;
        } else {
          ctx.fillStyle = `rgba(168, 163, 151, ${node.opacity})`;
          ctx.strokeStyle = `rgba(168, 163, 151, ${node.opacity + 0.1})`;
        }
        
        ctx.fill();
        ctx.stroke();

        // Draw labels for data blocks
        if (node.label) {
          ctx.font = '6px monospace';
          ctx.fillStyle = `rgba(168, 163, 151, ${node.opacity + 0.3})`;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(node.label, node.x, finalY);
        }
      });

      ctx.restore();

      if (!isReducedMotion) {
        animationFrameId = requestAnimationFrame(draw);
      }
    };

    init();
    draw();

    const handleResize = () => {
      init();
      if (isReducedMotion) draw();
    };
    
    const handleScroll = () => {
      scrollY = window.scrollY;
      if (isReducedMotion) draw();
    };

    window.addEventListener('resize', handleResize);
    window.addEventListener('scroll', handleScroll, { passive: true });
    
    return () => {
      window.removeEventListener('resize', handleResize);
      window.removeEventListener('scroll', handleScroll);
      if (animationFrameId) cancelAnimationFrame(animationFrameId);
    };
  }, [isReducedMotion]);

  return (
    <div 
      className="fixed inset-0 z-0 pointer-events-none"
      style={{
        maskImage: 'radial-gradient(circle at center top 300px, rgba(0,0,0,0.15) 0%, black 60%)',
        WebkitMaskImage: 'radial-gradient(circle at center top 300px, rgba(0,0,0,0.15) 0%, black 60%)',
      }}
    >
      <canvas
        ref={canvasRef}
        className="w-full h-full"
      />
    </div>
  );
}
