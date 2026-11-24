export function Gift({ open = false }) {
  return <div className={'gift ' + (open ? 'gift-open' : '')} aria-hidden="true">
    <i className="gift-glow" /><i className="bow bow-left" /><i className="bow bow-right" />
    <i className="gift-box" /><i className="gift-lid" />
  </div>
}

export function Notice({ children }) {
  return children ? <p className="notice" role="alert">{children}</p> : null
}
