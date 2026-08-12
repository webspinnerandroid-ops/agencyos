"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";

export interface Slide {
  src: string;
  title: string;
  description: string;
}

const AUTO_ADVANCE_MS = 5000;

export default function ScreenshotSlideshow({ slides }: { slides: Slide[] }) {
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const go = useCallback(
    (dir: 1 | -1) => setIndex((i) => (i + dir + slides.length) % slides.length),
    [slides.length]
  );

  useEffect(() => {
    if (paused || slides.length <= 1) return;
    timer.current = setInterval(() => setIndex((i) => (i + 1) % slides.length), AUTO_ADVANCE_MS);
    return () => {
      if (timer.current) clearInterval(timer.current);
    };
  }, [paused, slides.length]);

  const slide = slides[index];

  return (
    <div
      className="rounded-xl border bg-muted/30 p-6 sm:p-8"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
    >
      <div className="relative overflow-hidden rounded-lg border bg-background shadow-sm">
        <div
          className="flex transition-transform duration-500 ease-out"
          style={{ transform: `translateX(-${index * 100}%)` }}
        >
          {slides.map((s) => (
            <img
              key={s.src}
              src={s.src}
              alt={s.title}
              className="w-full shrink-0 object-cover"
              loading={index === 0 ? "eager" : "lazy"}
            />
          ))}
        </div>

        {/* Arrows */}
        <button
          type="button"
          aria-label="Previous screenshot"
          onClick={() => go(-1)}
          className="absolute left-3 top-1/2 -translate-y-1/2 rounded-full bg-background/80 p-2 text-foreground shadow hover:bg-background transition-colors"
        >
          <ChevronLeft className="size-5" />
        </button>
        <button
          type="button"
          aria-label="Next screenshot"
          onClick={() => go(1)}
          className="absolute right-3 top-1/2 -translate-y-1/2 rounded-full bg-background/80 p-2 text-foreground shadow hover:bg-background transition-colors"
        >
          <ChevronRight className="size-5" />
        </button>

        {/* Dots */}
        <div className="absolute bottom-3 left-1/2 -translate-x-1/2 flex gap-1.5">
          {slides.map((s, i) => (
            <button
              key={s.src}
              type="button"
              aria-label={`Go to slide ${i + 1}`}
              onClick={() => setIndex(i)}
              className={`h-2 rounded-full transition-all ${
                i === index ? "w-6 bg-primary" : "w-2 bg-background/70 hover:bg-background"
              }`}
            />
          ))}
        </div>
      </div>

      {/* Caption */}
      <div className="mt-5 text-center">
        <div className="text-sm font-semibold text-muted-foreground uppercase tracking-widest">
          {index + 1} / {slides.length}
        </div>
        <h3 className="text-xl font-bold mt-1">{slide.title}</h3>
        <p className="mt-1.5 text-sm text-muted-foreground max-w-2xl mx-auto">{slide.description}</p>
      </div>
    </div>
  );
}
