export function Icon({ children, className = 'size-[18px]' }) {
  return <svg viewBox="0 0 24 24" aria-hidden="true" className={`fill-none stroke-current stroke-[1.8] stroke-linecap-round stroke-linejoin-round ${className}`}>{children}</svg>
}
