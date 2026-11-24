module.exports = {
  presets: [require('@skpods/ui/preset')],
  content: ['./index.html', './src/**/*.{ts,tsx}', '../../packages/ui/src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      keyframes: {
        'slide-in': { '0%': { opacity: '0', transform: 'translateY(-14px) scale(.97)' }, '100%': { opacity: '1', transform: 'none' } },
        'card-in': { '0%': { opacity: '0', transform: 'translateY(26px) scale(.96)' }, '60%': { opacity: '1' }, '100%': { opacity: '1', transform: 'none' } },
        buzz: { '0%,100%': { transform: 'translateX(0)' }, '15%': { transform: 'translateX(-3px) rotate(-.4deg)' }, '30%': { transform: 'translateX(3px) rotate(.4deg)' }, '45%': { transform: 'translateX(-2px)' }, '60%': { transform: 'translateX(2px)' }, '75%': { transform: 'translateX(-1px)' } },
        ripple: { '0%': { transform: 'scale(.2)', opacity: '.7' }, '100%': { transform: 'scale(2.6)', opacity: '0' } },
        sweep: { '0%': { transform: 'translateX(-100%)' }, '100%': { transform: 'translateX(100%)' } },
        'glow-pulse': { '0%,100%': { opacity: '.55' }, '50%': { opacity: '1' } },
        'caption-in': { '0%': { opacity: '0', transform: 'translateY(10px)' }, '100%': { opacity: '1', transform: 'none' } },
      },
      animation: {
        'slide-in': 'slide-in .4s cubic-bezier(.2,.9,.3,1) both',
        'card-in': 'card-in .6s cubic-bezier(.2,.9,.3,1) both',
        buzz: 'buzz .5s ease-in-out 2',
        ripple: 'ripple .7s ease-out both',
        sweep: 'sweep 1.6s ease-in-out infinite',
        'glow-pulse': 'glow-pulse 2.4s ease-in-out infinite',
        'caption-in': 'caption-in .5s ease-out both',
      },
    },
  },
}
