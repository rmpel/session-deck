import { useState } from 'react'
import SkinFrame from './SkinFrame.jsx'

/** "https://mail.google.com/mail/u/0/" -> "Mail", a starting point to edit. */
function guessLabel(url) {
  try {
    const host = new URL(url).hostname.replace(/^www\./, '')
    const word = host.split('.').find((p) => !['app', 'my', 'web'].includes(p)) ?? host
    return word.charAt(0).toUpperCase() + word.slice(1)
  } catch {
    return ''
  }
}

const isWeb = (url) => {
  try {
    return ['http:', 'https:'].includes(new URL(url).protocol)
  } catch {
    return false
  }
}

/**
 * The saved views: pages that get a button of their own (mail, calendar,
 * hours). Paste an address, name it, and it is a button; remove what you no
 * longer need. Each opens as a session of its own, sharing the panes' logins.
 */
export default function ViewsDialog({ views, onChange, onClose }) {
  const [url, setUrl] = useState('')
  const [label, setLabel] = useState('')
  const [error, setError] = useState(null)

  const add = (e) => {
    e.preventDefault()
    const clean = url.trim()
    if (!isWeb(clean)) return setError('Paste a full address starting with https:// or http://.')
    const name = (label.trim() || guessLabel(clean)).slice(0, 24)
    onChange([...views, { id: crypto.randomUUID(), label: name, url: clean }])
    setUrl('')
    setLabel('')
    setError(null)
  }

  return (
    <div className="overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="picker viewsdialog" role="dialog" aria-modal="true" aria-labelledby="views-title">
        <SkinFrame kind="dialog" />
        <div className="fhead">
          <div className="sname" id="views-title">
            Views
          </div>
          <button className="closeb" type="button" onClick={onClose}>
            Esc · close
          </button>
        </div>

        <form className="viewform" onSubmit={add}>
          <input
            className="filter"
            autoFocus
            aria-label="Address of the page"
            placeholder="Paste an address, e.g. https://calendar.google.com"
            value={url}
            onChange={(e) => {
              setUrl(e.target.value)
              setError(null)
            }}
          />
          <div className="viewrow">
            <input
              className="filter"
              aria-label="Button label"
              placeholder={guessLabel(url.trim()) || 'Button label'}
              maxLength={24}
              value={label}
              onChange={(e) => setLabel(e.target.value)}
            />
            <button className="newbtn" type="submit" disabled={!url.trim()}>
              Add view
            </button>
          </div>
          {error && (
            <p className="formerror" role="alert">
              {error}
            </p>
          )}
        </form>

        <ul className="pagelist">
          {views.map((v) => (
            <li key={v.id}>
              <span className="pageopen viewitem" title={v.url}>
                <span className="pagetitle">{v.label}</span>
                <span className="pagemeta">{v.url.replace(/^https?:\/\//, '')}</span>
              </span>
              <button className="closeb" type="button" onClick={() => onChange(views.filter((x) => x.id !== v.id))}>
                Remove
              </button>
            </li>
          ))}
          {views.length === 0 && <li className="none">No views yet. Paste an address above to add a button for it.</li>}
        </ul>
        <p className="panelnote">Views share the browser panes’ logins: sign in once and every view stays signed in.</p>
      </div>
    </div>
  )
}
