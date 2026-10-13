import React from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.jsx'
import '@xterm/xterm/css/xterm.css'
// The LCARS skin's lettering; bundled, since the CSP allows no web fonts.
import '@fontsource-variable/antonio'
import './styles.css'
import './skins.css'

// Lets CSS adapt the title bar: macOS draws traffic lights over it, Windows
// gives the window a normal frame.
document.documentElement.dataset.platform = window.deck?.platform ?? 'unknown'

createRoot(document.getElementById('root')).render(<App />)
