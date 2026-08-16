import type { Characteristic } from '../types'
import { HexByteInput } from './HexByteInput'
import { UuidInput } from './UuidInput'
import { X, GripVertical } from 'lucide-react'
import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'

interface CharacteristicRowProps {
  characteristic: Characteristic
  onChange: (c: Characteristic) => void
  onRemove: () => void
  dupUuids: Set<string>
}

export function CharacteristicRow({ characteristic, onChange, onRemove, dupUuids }: CharacteristicRowProps) {
  const { properties } = characteristic
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: characteristic.id })

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
    position: 'relative' as const,
  }

  function toggleProp(prop: keyof typeof properties) {
    onChange({ ...characteristic, properties: { ...properties, [prop]: !properties[prop] } })
  }

  return (
    <div ref={setNodeRef} style={style} className="char-row">
      <div className="char-row-top">
        <span className="card-drag-handle" {...attributes} {...listeners}>
          <GripVertical size={14} />
        </span>
        <span className="card-title">Char</span>
        <UuidInput
          value={characteristic.uuid}
          isDuplicate={dupUuids.has(characteristic.uuid)}
          onChange={uuid => onChange({ ...characteristic, uuid })}
        />
        <span className="char-field-label">Tag</span>
        <input
          className="name-input"
          type="text"
          placeholder="Optional"
          value={characteristic.tag}
          onChange={e => onChange({ ...characteristic, tag: e.target.value })}
        />
        <div className="char-props">
          <label>
            <input type="checkbox" checked={properties.read} onChange={() => toggleProp('read')} />
            <span>R</span>
          </label>
          <label>
            <input type="checkbox" checked={properties.write} onChange={() => toggleProp('write')} />
            <span>W</span>
          </label>
          <label>
            <input type="checkbox" checked={properties.notify} onChange={() => toggleProp('notify')} />
            <span>N</span>
          </label>
        </div>
        <button className="remove-btn" onClick={onRemove}>
          <X size={14} />
        </button>
      </div>
      <div className="char-row-bottom">
        <span className="card-title">Default</span>
        <HexByteInput
          value={characteristic.defaultValue}
          onChange={v => onChange({ ...characteristic, defaultValue: v })}
        />
      </div>
    </div>
  )
}
