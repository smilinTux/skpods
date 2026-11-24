/** SKPods showcase Tailwind preset. Colors are CSS variables (see src/styles.css) so light and dark share class names. */
const v = (name) => `rgb(var(--skp-${name}) / <alpha-value>)`

module.exports = {
  // Variant classes are built dynamically (skp-btn-${variant}), so the scanner cannot see them.
  safelist: ['skp-btn-primary', 'skp-btn-secondary', 'skp-btn-danger', 'skp-btn-ghost'],
  darkMode: ['class', '[data-theme="dark"]'],
  theme: {
    extend: {
      colors: {
        bg: v('bg'),
        surface: v('surface'),
        'surface-2': v('surface-2'),
        line: v('line'),
        ink: v('ink'),
        muted: v('muted'),
        navy: { 950: '#070d1f', 900: '#0b1530', 800: '#12204a', 700: '#1b2d63' },
        brand: { DEFAULT: v('brand'), soft: v('brand-soft'), ink: v('brand-ink') },
        warm: { DEFAULT: v('warm'), soft: v('warm-soft') },
        ok: v('ok'),
        warn: v('warn'),
        danger: v('danger'),
      },
      fontFamily: {
        sans: ['Inter', 'ui-sans-serif', 'system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'sans-serif'],
        mono: ['JetBrains Mono', 'ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
      },
      borderRadius: { xl: '0.9rem', '2xl': '1.25rem' },
      boxShadow: {
        card: '0 1px 2px rgb(var(--skp-shadow) / 0.06), 0 8px 24px -12px rgb(var(--skp-shadow) / 0.18)',
        glow: '0 0 0 1px rgb(var(--skp-brand) / 0.35), 0 8px 40px -8px rgb(var(--skp-brand) / 0.45)',
      },
      keyframes: {
        'fade-up': { '0%': { opacity: '0', transform: 'translateY(8px)' }, '100%': { opacity: '1', transform: 'none' } },
        'pop': { '0%': { transform: 'scale(.96)', opacity: '0' }, '100%': { transform: 'scale(1)', opacity: '1' } },
        'pulse-ring': { '0%': { boxShadow: '0 0 0 0 rgb(var(--skp-brand) / .5)' }, '100%': { boxShadow: '0 0 0 10px rgb(var(--skp-brand) / 0)' } },
        'shimmer': { '100%': { transform: 'translateX(100%)' } },
        'toast-in': { '0%': { opacity: '0', transform: 'translateY(12px) scale(.98)' }, '100%': { opacity: '1', transform: 'none' } },
      },
      animation: {
        'fade-up': 'fade-up .35s ease-out both',
        pop: 'pop .18s ease-out both',
        'pulse-ring': 'pulse-ring 1.6s ease-out infinite',
        shimmer: 'shimmer 1.4s infinite',
        'toast-in': 'toast-in .22s ease-out both',
      },
    },
  },
  plugins: [],
}
