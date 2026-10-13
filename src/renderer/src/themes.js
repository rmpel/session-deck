/**
 * Every theme, light and dark, in one place. A theme sets its neutrals and its
 * accent; the semantic colours (working / needs you / done / idle) come from a
 * shared set unless a theme *must* differ — which happens whenever a semantic
 * colour would collide with that theme's accent. "Needs you" has to read at a
 * glance in all of them, so it may never be mistaken for the accent.
 *
 * Applied as CSS variables at runtime rather than written out as 14 CSS blocks:
 * one source of truth, and the swatches in Settings read from it too.
 */

const LIGHT = {
  work: '#2563a8', workBg: '#e7eef7',
  need: '#8a5000', needBg: '#fbf0de', needEdge: '#e0a03a', needCard: '#fdf7ee',
  done: '#2f7a4d', doneBg: '#e5f2ea',
  idle: '#5f5760', idleBg: '#eceaeb'
}

const DARK = {
  work: '#7fb2e6', workBg: '#1a2432',
  need: '#f0a838', needBg: '#33260f', needEdge: '#c98c2c', needCard: '#2a2118',
  done: '#6ecb95', doneBg: '#152a1e',
  idle: '#a79ba1', idleBg: '#262224'
}

export const THEMES = [
  {
    key: 'default',
    label: 'Plum',
    light: {
      app: '#f5f3f4', chrome: '#e6e1e4', card: '#fffdfd', term: '#100e0f', termInk: '#cdc4c9',
      ink: '#1c181b', ink2: '#453d42', muted: '#6e6469', line: '#ded8db', line2: '#c9c0c5',
      accent: '#9d2b52', accentSoft: '#f6e8ed'
    },
    dark: {
      app: '#171416', chrome: '#2a2528', card: '#201c1f', term: '#100e0f', termInk: '#cdc4c9',
      ink: '#f1ecee', ink2: '#cfc6cb', muted: '#9e9298', line: '#332d31', line2: '#453d42',
      accent: '#e8628d', accentSoft: '#2c1a22'
    }
  },
  {
    key: 'cyberpunk',
    label: 'Cyberpunk',
    light: {
      app: '#eef2fb', chrome: '#dfe7f7', card: '#ffffff', term: '#05080f', termInk: '#cfe3ff',
      ink: '#10192e', ink2: '#33406a', muted: '#64719b', line: '#d3dcf0', line2: '#b6c2e0',
      accent: '#d81e4a', accentSoft: '#fde7ec',
      semantic: { work: '#1565c0', workBg: '#e3eefb' }
    },
    dark: {
      app: '#070b18', chrome: '#0d1428', card: '#0f1730', term: '#05080f', termInk: '#cfe3ff',
      ink: '#e6f0ff', ink2: '#a8c0e8', muted: '#6f86b8', line: '#1d2b50', line2: '#2c4074',
      accent: '#ff2e63', accentSoft: '#2a0d20',
      // Amber, not red: red is the accent here.
      semantic: {
        work: '#38bdf8', workBg: '#0a2438',
        need: '#ffb020', needBg: '#2e2208', needEdge: '#ffb020', needCard: '#1b1608',
        done: '#3ddc97', doneBg: '#06291f', idle: '#93a6cf', idleBg: '#131c36'
      }
    }
  },
  {
    key: 'spaceship',
    label: 'Spaceship',
    light: {
      app: '#eef3f5', chrome: '#dfe8ec', card: '#ffffff', term: '#060c10', termInk: '#cfe0e6',
      ink: '#10222b', ink2: '#35505c', muted: '#566a76', line: '#d2dfe4', line2: '#b5c7ce',
      accent: '#0f766e', accentSoft: '#dcefed'
    },
    dark: {
      app: '#0a1014', chrome: '#111b21', card: '#13202a', term: '#060c10', termInk: '#cfe0e6',
      ink: '#e4eef3', ink2: '#b2c7d1', muted: '#7793a1', line: '#1e2f3a', line2: '#2c4453',
      accent: '#4fd1c5', accentSoft: '#0c2b2c',
      semantic: {
        work: '#63b3ed', workBg: '#0d2438',
        need: '#f6ad55', needBg: '#2e2110', needEdge: '#d98b3a', needCard: '#1d1710',
        done: '#68d391', doneBg: '#0b2a1c', idle: '#9db3c0', idleBg: '#16232b'
      }
    }
  },
  {
    key: 'nature',
    label: 'Nature',
    light: {
      app: '#eef2e9', chrome: '#e0e7d8', card: '#fbfdf8', term: '#10160f', termInk: '#cfdcc9',
      ink: '#1b2a1d', ink2: '#3c4f3f', muted: '#56675a', line: '#d5decd', line2: '#bcc9b3',
      accent: '#2f7a4d', accentSoft: '#e2efe4',
      // Teal, not green: green is the accent here.
      semantic: { done: '#0f766e', doneBg: '#ddefec', idle: '#5c6a5d', idleBg: '#e7ebe2' }
    },
    dark: {
      app: '#0e1511', chrome: '#16211a', card: '#17241b', term: '#080e0a', termInk: '#cfdcc9',
      ink: '#e6f0e6', ink2: '#bacfbd', muted: '#86a08d', line: '#24352a', line2: '#354a3b',
      accent: '#7bc47f', accentSoft: '#14261a',
      semantic: {
        work: '#6aa9d8', workBg: '#102434',
        need: '#e2a33c', needBg: '#2f2410', needEdge: '#c48c2e', needCard: '#1e1a0f',
        done: '#34c6a8', doneBg: '#092a26', idle: '#9db2a4', idleBg: '#1a2620'
      }
    }
  },
  {
    key: 'electric',
    label: 'Electric',
    light: {
      app: '#faf8ec', chrome: '#f1edd6', card: '#ffffff', term: '#060604', termInk: '#e8e4cd',
      ink: '#20200f', ink2: '#4a472c', muted: '#7c775c', line: '#e6e1c6', line2: '#cdc7a5',
      // Dark gold: bright yellow cannot carry white text or read as a link.
      accent: '#8a6d00', accentSoft: '#fdf3c8',
      semantic: { need: '#b23c0b', needBg: '#fceee4', needEdge: '#d97706', needCard: '#fdf6ef' }
    },
    dark: {
      app: '#0c0c0a', chrome: '#16160f', card: '#15150f', term: '#060604', termInk: '#e8e4cd',
      ink: '#f7f4e4', ink2: '#ccc7ab', muted: '#8d8870', line: '#2a2a1d', line2: '#3d3c29',
      accent: '#ffd400', accentSoft: '#2b2708',
      // Orange, not amber: amber beside a yellow accent is one colour.
      semantic: {
        work: '#4cc9f0', workBg: '#07283a',
        need: '#ff7a45', needBg: '#331505', needEdge: '#e0612c', needCard: '#1f1208',
        done: '#7ee081', doneBg: '#0d2a12', idle: '#a9a48a', idleBg: '#1d1d15'
      }
    }
  },
  {
    key: 'candy',
    label: 'Candy',
    light: {
      app: '#fdf2f6', chrome: '#f8e3ec', card: '#ffffff', term: '#1b0f16', termInk: '#f0d9e4',
      ink: '#3b1f2c', ink2: '#6b4356', muted: '#7a5265', line: '#f2dae5', line2: '#e3bfd0',
      accent: '#b92a68', accentSoft: '#fce4ef'
    },
    dark: {
      app: '#1a1018', chrome: '#271a24', card: '#23161f', term: '#140b11', termInk: '#f0d9e4',
      ink: '#fbe9f1', ink2: '#e0bcd0', muted: '#ab8497', line: '#3a2531', line2: '#4e3342',
      accent: '#ff8fc0', accentSoft: '#331a26'
    }
  },
  {
    key: 'lcars',
    label: 'LCARS',
    light: {
      app: '#f2ece0', chrome: '#e6dccb', card: '#fffaf0', term: '#0b0a10', termInk: '#f5d6a8',
      ink: '#1d1610', ink2: '#4a3b2c', muted: '#76685a', line: '#e0d5c2', line2: '#c9b99f',
      // Burnt orange: the screen orange cannot carry light text.
      accent: '#b35c00', accentSoft: '#fbe6cc',
      semantic: {
        work: '#4646c0', workBg: '#e6e6fb',
        need: '#c42b2b', needBg: '#fbe3e3', needEdge: '#e05252', needCard: '#fdf2f2',
        idle: '#8a4f8a', idleBg: '#f1e4f1'
      }
    },
    dark: {
      // Panels are the screen itself: black, defined only by their frames.
      app: '#000000', chrome: '#000000', card: '#000000', term: '#0b0a12', termInk: '#f5d6a8',
      ink: '#ffd9a8', ink2: '#e0bf94', muted: '#a596b4', line: '#1d1a26', line2: '#3a3448',
      accent: '#ff9900', accentSoft: '#2b1a00',
      // Red alert, not amber: amber beside an orange accent is one colour.
      // Blue and lavender are the other two LCARS panel colours.
      semantic: {
        work: '#9999ff', workBg: '#16163a',
        need: '#ff5555', needBg: '#3a0d0d', needEdge: '#ff5555', needCard: '#140404',
        done: '#99cc66', doneBg: '#14240c', idle: '#cc99cc', idleBg: '#2a1a2a'
      }
    }
  },
  {
    key: 'gothic',
    label: 'Gothic',
    light: {
      app: '#f4f1fa', chrome: '#e9e3f6', card: '#ffffff', term: '#0b0913', termInk: '#ded7f0',
      ink: '#241b38', ink2: '#483c66', muted: '#776a96', line: '#e2dbf2', line2: '#c9bfe4',
      accent: '#6d28d9', accentSoft: '#ece5fb',
      // Deep blue would sit too close to the purple accent.
      semantic: { work: '#0369a1', workBg: '#e0f0f9' }
    },
    dark: {
      app: '#12101c', chrome: '#1c1830', card: '#1a1729', term: '#0b0913', termInk: '#ded7f0',
      ink: '#ece7fb', ink2: '#c3bada', muted: '#8e85ad', line: '#2a2444', line2: '#3b3360',
      accent: '#a78bfa', accentSoft: '#241c3d',
      // Cyan, not blue: blue is too near this purple accent at a glance.
      semantic: { work: '#4dd0e1', workBg: '#0b2a30', idle: '#a79ec6', idleBg: '#221d33' }
    }
  }
]

const VARS = {
  app: '--app', chrome: '--chrome', card: '--card', term: '--term', termInk: '--term-ink',
  ink: '--ink', ink2: '--ink-2', muted: '--muted', line: '--line', line2: '--line-2',
  accent: '--accent', accentSoft: '--accent-soft',
  work: '--work', workBg: '--work-bg',
  need: '--need', needBg: '--need-bg', needEdge: '--need-edge', needCard: '--need-card',
  done: '--done', doneBg: '--done-bg', idle: '--idle', idleBg: '--idle-bg'
}

export function paletteFor(themeKey, mode) {
  const theme = THEMES.find((t) => t.key === themeKey) ?? THEMES[0]
  const side = theme[mode === 'dark' ? 'dark' : 'light']
  const { semantic, ...neutrals } = side
  return { ...(mode === 'dark' ? DARK : LIGHT), ...neutrals, ...(semantic ?? {}) }
}

/** Swatch: page, accent, and the colour that means "needs you". */
export function swatchFor(themeKey, mode) {
  const p = paletteFor(themeKey, mode)
  return [p.app, p.accent, p.need]
}

export function applyTheme(themeKey, mode) {
  const palette = paletteFor(themeKey, mode)
  const root = document.documentElement
  for (const [name, value] of Object.entries(palette)) {
    if (VARS[name]) root.style.setProperty(VARS[name], value)
  }
  root.style.setProperty('color-scheme', mode === 'dark' ? 'dark' : 'light')
  root.dataset.theme = themeKey
  root.dataset.mode = mode
}
