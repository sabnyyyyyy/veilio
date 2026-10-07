'use client';

import React from 'react';
import Link from 'next/link';
import { ArrowDownRight, ArrowRight } from 'lucide-react';
import HeroVisual from './home/HeroVisual';

export default function Hero() {
  return (
    <>
      <section className="relative isolate overflow-hidden border-b border-white/[0.06] px-5 pb-12 pt-12 sm:px-8 sm:pb-16 sm:pt-14 lg:px-10 lg:pb-20 lg:pt-16">
        <div aria-hidden="true" className="pointer-events-none absolute left-1/2 top-[26%] h-[480px] w-[min(90vw,900px)] -translate-x-1/2 rounded-full bg-[#C9A45C]/[0.045] blur-[150px]" />
        <div aria-hidden="true" className="pointer-events-none absolute left-1/2 top-[58%] h-[400px] w-[min(80vw,720px)] -translate-x-1/2 rounded-full bg-[#C9A45C]/[0.035] blur-[140px]" />

        <div className="relative z-10 mx-auto flex w-full max-w-[1180px] flex-col items-center text-center">
          <h1 className="text-[clamp(2.25rem,4vw,3.75rem)] font-extrabold uppercase leading-[0.94] tracking-[-0.065em] text-[#F5F2E8]">
            Digital assets
            <span className="mt-1.5 block text-[#A8A397]">private auctions<span className="text-[#C9A45C]">.</span></span>
          </h1>

          <p className="mt-5 max-w-[620px] text-[14px] leading-6 text-[#C7C2B7] sm:mt-6 sm:text-[16px] sm:leading-7">
            The private marketplace where humans and AI agents discover, price, and trade datasets, AI models, and licenses through verifiable sealed auctions.
          </p>

          <div className="mt-6 flex w-full flex-col justify-center gap-2.5 sm:mt-7 sm:w-auto sm:flex-row sm:items-center sm:gap-5">
            <Link
              href="/auctions"
              className="group inline-flex h-[50px] items-center justify-center gap-3 rounded-md bg-[#C9A45C] px-6 text-[11px] font-extrabold uppercase tracking-[0.13em] text-[#10100D] shadow-[0_10px_35px_rgba(201,164,92,0.13)] transition duration-200 hover:-translate-y-0.5 hover:bg-[#E2C17C] hover:shadow-[0_14px_40px_rgba(201,164,92,0.22)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#E2C17C]"
            >
              Explore auctions
              <ArrowRight size={15} className="transition-transform group-hover:translate-x-1" />
            </Link>
            <Link
              href="/how-it-works"
              className="group inline-flex h-[48px] items-center justify-center gap-2 px-3 text-[10px] font-bold uppercase tracking-[0.15em] text-[#AAA69B] transition-colors hover:text-[#F5F2E8]"
            >
              See how VEILIO works
              <ArrowDownRight size={14} className="transition-transform group-hover:translate-x-0.5 group-hover:translate-y-0.5" />
            </Link>
          </div>

          <div className="relative mt-8 w-full max-w-[900px] sm:mt-9 lg:mt-10">
            <div aria-hidden="true" className="pointer-events-none absolute inset-12 rounded-full bg-[#C9A45C]/[0.05] blur-[80px]" />
            <div className="relative mx-auto w-full max-w-[900px]">
              <HeroVisual />
            </div>
          </div>

        </div>
      </section>
    </>
  );
}
