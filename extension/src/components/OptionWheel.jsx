import { useRef, useState } from 'react'
import './OptionWheel.css'

export default function OptionWheel({ items = [], defaultSelected = 0, onChange, className = '' }) {
  const [selected, setSelected] = useState(defaultSelected)
  const refs = useRef([])
  const choose = (index) => { setSelected(index); onChange?.(index, items[index]) }
  const onKeyDown = (event) => {
    if (!['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End', 'Enter', ' '].includes(event.key)) return
    event.preventDefault()
    if (event.key === 'Enter' || event.key === ' ') return choose(selected)
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : Math.max(0, Math.min(items.length - 1, selected + (['ArrowDown', 'ArrowRight'].includes(event.key) ? 1 : -1)))
    setSelected(next); refs.current[next]?.focus()
  }
  return <div className={`option-wheel ${className}`} role="listbox" aria-label="TETHER mode" onKeyDown={onKeyDown}>{items.map((item, index) => <button key={item} ref={(node) => { refs.current[index] = node }} type="button" role="option" aria-selected={index === selected} className="option-wheel__item" onClick={() => choose(index)} style={{ '--distance': Math.abs(index - selected) }}>{item}<span>{index === selected ? 'Active transport' : 'Switch mode'}</span></button>)}</div>
}
