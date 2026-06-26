import { ParsedDesign } from '../types/index';

// Always needed — viewport scaling for pixel-accurate sections
export function needsJS(_desktop: ParsedDesign, _mobile: ParsedDesign): boolean {
  return true;
}

export function generateJS(desktop: ParsedDesign, _mobile: ParsedDesign): string {
  const names = desktop.sections.map((s) => s.name.toLowerCase());
  const hasSticky   = names.some((n) => /\b(header|nav|sticky)\b/.test(n));
  const hasReveal   = names.some((n) => /\b(animate|animation|scroll|reveal)\b/.test(n));

  const blocks: string[] = [
    `'use strict';`,
    buildScaleSections(),
    buildDOMReady([
      hasSticky ? buildStickyNav()    : null,
      hasReveal ? buildScrollReveal() : null,
      buildSmoothScroll(),
    ].filter(Boolean) as string[]),
  ];

  return blocks.join('\n\n');
}

// ─────────────────────────────────────────────────────────────
// Viewport scaling — scales __inner canvases to fit the viewport
// ─────────────────────────────────────────────────────────────

function buildScaleSections(): string {
  return `function scaleSections() {
  var vw = window.innerWidth;
  document.querySelectorAll('[data-figma-width]').forEach(function (inner) {
    var fw = parseInt(inner.getAttribute('data-figma-width'), 10);
    var fh = parseInt(inner.getAttribute('data-figma-height'), 10);
    if (vw < fw) {
      var scale = vw / fw;
      inner.style.transform = 'scale(' + scale + ')';
      inner.style.transformOrigin = 'top left';
      inner.parentElement.style.minHeight = Math.ceil(fh * scale) + 'px';
      inner.parentElement.style.overflow  = 'hidden';
    } else {
      inner.style.transform    = '';
      inner.style.transformOrigin = '';
      inner.parentElement.style.minHeight = '';
      inner.parentElement.style.overflow  = '';
    }
  });
}

scaleSections();
window.addEventListener('resize', scaleSections, { passive: true });`;
}

// ─────────────────────────────────────────────────────────────
// DOMContentLoaded wrapper
// ─────────────────────────────────────────────────────────────

function buildDOMReady(blocks: string[]): string {
  if (blocks.length === 0) return '';
  const inner = blocks.map((b) => indent(b, 2)).join('\n\n');
  return `document.addEventListener('DOMContentLoaded', function () {\n${inner}\n});`;
}

// ─────────────────────────────────────────────────────────────
// Optional feature blocks
// ─────────────────────────────────────────────────────────────

function buildStickyNav(): string {
  return `// Sticky nav shadow on scroll
  var header = document.querySelector('header, [class$="-section"]:first-child');
  if (header) {
    window.addEventListener('scroll', function () {
      if (window.scrollY > 10) {
        header.style.boxShadow = '0 2px 16px rgba(0,0,0,0.12)';
      } else {
        header.style.boxShadow = '';
      }
    }, { passive: true });
  }`;
}

function buildScrollReveal(): string {
  return `// Scroll-reveal fade-in
  var revealObs = new IntersectionObserver(function (entries) {
    entries.forEach(function (entry) {
      if (entry.isIntersecting) {
        entry.target.style.opacity  = '1';
        entry.target.style.transform = 'translateY(0)';
        revealObs.unobserve(entry.target);
      }
    });
  }, { threshold: 0.12 });

  document.querySelectorAll('[class$="__inner"] > *').forEach(function (el) {
    el.style.opacity   = '0';
    el.style.transform = 'translateY(24px)';
    el.style.transition = 'opacity 0.5s ease, transform 0.5s ease';
    revealObs.observe(el);
  });`;
}

function buildSmoothScroll(): string {
  return `// Smooth scroll for anchor links
  document.querySelectorAll('a[href^="#"]').forEach(function (anchor) {
    anchor.addEventListener('click', function (e) {
      var target = document.querySelector(anchor.getAttribute('href'));
      if (target) {
        e.preventDefault();
        target.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    });
  });`;
}

function indent(str: string, spaces: number): string {
  const pad = ' '.repeat(spaces);
  return str.split('\n').map((l) => (l.trim() ? pad + l : l)).join('\n');
}
