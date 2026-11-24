module.exports = {
  presets: [require('@skpods/ui/preset')],
  content: ['./index.html', './src/**/*.{ts,tsx}', '../../packages/ui/src/**/*.{ts,tsx}'],
  theme: { extend: { keyframes: { 'dissolve': { '0%': { opacity: '1', filter: 'blur(0)' }, '45%': { opacity: '.35', filter: 'blur(4px)' }, '100%': { opacity: '.85', filter: 'blur(0)' } }, 'rise': { '0%': { opacity: '0', transform: 'translateY(6px) scale(.98)' }, '100%': { opacity: '1', transform: 'none' } } }, animation: { dissolve: 'dissolve .9s ease-out both', rise: 'rise .22s ease-out both' } } },
}
