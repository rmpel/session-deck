import { useEffect, useState } from 'react'

import { THEMES, swatchFor } from '../themes.js'
import { SKINS } from '../skins.js'
import SkinFrame from './SkinFrame.jsx'

export const bgUrl = (path) => `deckbg://img/${encodeURIComponent(path)}`

const DIMS = [
  { key: 'subtle', label: 'Subtle' },
  { key: 'medium', label: 'Medium' },
  { key: 'strong', label: 'Strong' }
]

const ON_OFF = [
  { key: 'on', label: 'Show' },
  { key: 'off', label: 'Hide' }
]

const MODES = [
  { key: 'system', label: 'Auto' },
  { key: 'light', label: 'Light' },
  { key: 'dark', label: 'Dark' }
]

export const SIZES = [
  { key: 'small', label: 'S' },
  { key: 'medium', label: 'M' },
  { key: 'large', label: 'L' }
]

function Row({ label, hint, children }) {
  return (
    <div className="approw">
      <div className="applabel">
        {label}
        {hint && <span>{hint}</span>}
      </div>
      {children}
    </div>
  )
}

function Segmented({ value, onChange, options, name }) {
  return (
    <div className="density" role="group" aria-label={name}>
      {options.map((o) => (
        <button
          key={o.key}
          type="button"
          aria-pressed={value === o.key}
          onClick={() => onChange(o.key)}
          title={o.title ?? o.label}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

/** Settings: theme and skin, sizes, Worked on times, where ticket links point, and updates. */
export default function Settings({ settings, onChange, onClose, version, onCheckUpdates }) {
  const [ticketBase, setTicketBase] = useState('')
  const [saved, setSaved] = useState(false)
  const [backgrounds, setBackgrounds] = useState({ dir: null, images: [] })

  useEffect(() => {
    window.deck.ticketBase().then((v) => setTicketBase(v ?? ''))
    window.deck.backgrounds().then(setBackgrounds)
  }, [])

  const chosen = settings.background?.path ?? null
  // A picked file lives outside the folder, so it gets its own tile.
  const custom = chosen && !backgrounds.images.some((i) => i.path === chosen) ? chosen : null

  const pickFile = async () => {
    const picked = await window.deck.chooseBackground()
    if (picked) onChange({ background: { ...settings.background, path: picked.path } })
  }
  const setBackground = (path) => onChange({ background: { ...settings.background, path } })

  const saveTicketBase = async (e) => {
    e.preventDefault()
    await window.deck.setTicketBase(ticketBase)
    setSaved(true)
    setTimeout(() => setSaved(false), 1600)
  }

  return (
    <div className="overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="picker settings" role="dialog" aria-modal="true" aria-labelledby="settings-title">
        <SkinFrame kind="dialog" />
        <div className="fhead">
          <div className="sname" id="settings-title">
            Settings
          </div>
          <button className="closeb" type="button" onClick={onClose}>
            Esc · close
          </button>
        </div>

        <div className="appbody">
          <Row label="Theme">
            <div className="themes" role="group" aria-label="Theme">
              {THEMES.map((t) => {
                const [bg, accent, need] = swatchFor(t.key, settings.mode === 'system' ? 'dark' : settings.mode)
                return (
                  <button
                    key={t.key}
                    type="button"
                    className={settings.theme === t.key ? 'current' : ''}
                    aria-pressed={settings.theme === t.key}
                    onClick={() => onChange({ theme: t.key })}
                  >
                    <span className="swatch" aria-hidden="true">
                      {[bg, accent, need].map((c, i) => (
                        <i key={i} style={{ background: c }} />
                      ))}
                    </span>
                    {t.label}
                  </button>
                )
              })}
            </div>
          </Row>

          <Row label="Light or dark" hint="every theme has both; Auto follows the system">
            <Segmented name="Light or dark" value={settings.mode} options={MODES} onChange={(v) => onChange({ mode: v })} />
          </Row>

          <Row label="Skin" hint="shapes and frames; works with every theme">
            <Segmented name="Skin" value={settings.skin ?? 'plain'} options={SKINS} onChange={(v) => onChange({ skin: v })} />
          </Row>

          <Row label="Background" hint="included with Session Deck, or choose your own image">
            <div className="bgs" role="group" aria-label="Background">
              <button
                type="button"
                className={`bgtile bgtile--none ${chosen ? '' : 'current'}`}
                aria-pressed={!chosen}
                onClick={() => setBackground(null)}
                title="No background"
              >
                None
              </button>
              {backgrounds.images.map((img) => (
                <button
                  key={img.path}
                  type="button"
                  className={`bgtile ${chosen === img.path ? 'current' : ''}`}
                  aria-pressed={chosen === img.path}
                  onClick={() => setBackground(img.path)}
                  title={img.file}
                >
                  {img.thumb && <img src={img.thumb} alt="" />}
                  <span className="bgname">{img.label}</span>
                </button>
              ))}
              {custom && (
                <button type="button" className="bgtile current" aria-pressed title={custom}>
                  <img src={bgUrl(custom)} alt="" />
                  <span className="bgname">Custom</span>
                </button>
              )}
              <button type="button" className="bgtile bgtile--pick" onClick={pickFile}>
                Choose…
              </button>
            </div>
          </Row>

          <Row label="Background dim" hint="how much the background is toned down behind the tiles">
            <Segmented
              name="Background dim"
              value={settings.background?.dim ?? 'medium'}
              options={DIMS}
              onChange={(v) => onChange({ background: { ...settings.background, dim: v } })}
            />
          </Row>

          <Row label="Tile opacity" hint="how much of the background shows through the tiles">
            <div className="slider">
              <input
                id="tile-opacity"
                type="range"
                min="35"
                max="100"
                step="5"
                aria-label="Tile opacity"
                value={Math.round((settings.tileOpacity ?? 1) * 100)}
                onChange={(e) => onChange({ tileOpacity: Number(e.target.value) / 100 })}
              />
              <span className="slidervalue">{Math.round((settings.tileOpacity ?? 1) * 100)}%</span>
            </div>
          </Row>

          <Row label="Tile height" hint="how many activity lines a tile shows">
            <Segmented name="Tile height" value={settings.density} options={SIZES} onChange={(v) => onChange({ density: v })} />
          </Row>

          <Row label="Tile text" hint="size of the activity lines">
            <Segmented name="Tile text size" value={settings.tileFont} options={SIZES} onChange={(v) => onChange({ tileFont: v })} />
          </Row>

          <Row label="Terminal text" hint="size in the focused session">
            <Segmented name="Terminal text size" value={settings.termFont} options={SIZES} onChange={(v) => onChange({ termFont: v })} />
          </Row>

          <Row label="Terminal font" hint="leave empty to use an installed Nerd Font, for prompt icons">
            <input
              className="filter appfont"
              aria-label="Terminal font"
              placeholder="Automatic"
              defaultValue={settings.termFontFamily ?? ''}
              onBlur={(e) => onChange({ termFontFamily: e.target.value.trim() })}
              onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
            />
          </Row>

          <Row label="Worked on times" hint="only the time a session was active — not testing or other work outside Claude">
            <Segmented
              name="Worked on times"
              value={settings.worklogTimes ? 'on' : 'off'}
              options={ON_OFF}
              onChange={(v) => onChange({ worklogTimes: v === 'on' })}
            />
          </Row>

          <form className="approw appticket" onSubmit={saveTicketBase}>
            <div className="applabel">
              Ticket links
              <span>learned from ticket URLs you paste; tickets are only linked, never changed</span>
            </div>
            <div className="appticketfield">
              <input
                id="ticket-base"
                className="filter"
                placeholder="https://your-org.atlassian.net/browse"
                aria-label="Ticket link base URL"
                value={ticketBase}
                onChange={(e) => setTicketBase(e.target.value)}
              />
              <button className="newbtn" type="submit">
                {saved ? 'Saved' : 'Save'}
              </button>
            </div>
          </form>

          <Row label="Updates" hint={version ? `this is Session Deck ${version}` : 'Session Deck'}>
            <button className="closeb appupdate" type="button" onClick={onCheckUpdates}>
              Check for updates
            </button>
          </Row>
        </div>
      </div>
    </div>
  )
}
