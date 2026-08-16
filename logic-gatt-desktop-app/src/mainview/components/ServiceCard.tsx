import { useState } from 'react'
import type { Service, Characteristic } from '../types'
import { Card, CardHeader, CardBody } from './Card'
import { CharacteristicRow } from './CharacteristicRow'
import { UuidInput } from './UuidInput'
import { MAX_CHARS_PER_SERVICE } from '../lib/constants'
import { GripVertical } from 'lucide-react'
import type { DragEndEvent } from '@dnd-kit/core'
import { DndContext, closestCenter, KeyboardSensor, PointerSensor, useSensor, useSensors } from '@dnd-kit/core'
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'

interface ServiceCardProps {
  service: Service
  onChange: (service: Service) => void
  onRemove: () => void
  dupUuids: Set<string>
}

function createCharacteristic(): Characteristic {
  return {
    id: crypto.randomUUID(),
    uuid: '',
    tag: '',
    properties: { read: false, write: false, notify: false },
    defaultValue: '',
  }
}

export function ServiceCard({ service, onChange, onRemove, dupUuids }: ServiceCardProps) {
  const [collapsed, setCollapsed] = useState(false)

  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: service.id })
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
    zIndex: isDragging ? 1 : 0,
    position: 'relative' as const,
  }

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  )

  function addCharacteristic() {
    if (service.characteristics.length >= MAX_CHARS_PER_SERVICE) return
    onChange({ ...service, characteristics: [...service.characteristics, createCharacteristic()] })
  }

  function updateCharacteristic(id: string, updated: Characteristic) {
    onChange({
      ...service,
      characteristics: service.characteristics.map(c => (c.id === id ? updated : c)),
    })
  }

  function removeCharacteristic(id: string) {
    onChange({
      ...service,
      characteristics: service.characteristics.filter(c => c.id !== id),
    })
  }

  function handleCharDragEnd(event: DragEndEvent) {
    const { active, over } = event
    if (over && active.id !== over.id) {
      const oldIndex = service.characteristics.findIndex(c => c.id === active.id)
      const newIndex = service.characteristics.findIndex(c => c.id === over.id)
      if (oldIndex === -1 || newIndex === -1) return
      onChange({ ...service, characteristics: arrayMove(service.characteristics, oldIndex, newIndex) })
    }
  }

  return (
    <div ref={setNodeRef} style={style}>
      <Card>
        <CardHeader
          title="Service"
          collapsed={collapsed}
          onToggleCollapse={() => setCollapsed(!collapsed)}
          onRemove={onRemove}
          dragHandle={
            <span className="card-drag-handle" {...attributes} {...listeners}>
              <GripVertical size={14} />
            </span>
          }
        >
          <UuidInput
            value={service.uuid}
            isDuplicate={dupUuids.has(service.uuid)}
            onChange={uuid => onChange({ ...service, uuid })}
          />
          <span className="char-field-label">Tag</span>
          <input
            className="name-input"
            type="text"
            placeholder="Optional"
            value={service.tag}
            onChange={e => onChange({ ...service, tag: e.target.value })}
          />
        </CardHeader>
        {!collapsed && (
          <CardBody>
            <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleCharDragEnd}>
              <SortableContext
                items={service.characteristics.map(c => c.id)}
                strategy={verticalListSortingStrategy}
              >
                {service.characteristics.map(char => (
                  <CharacteristicRow
                    key={char.id}
                    characteristic={char}
                    onChange={updated => updateCharacteristic(char.id, updated)}
                    onRemove={() => removeCharacteristic(char.id)}
                    dupUuids={dupUuids}
                  />
                ))}
              </SortableContext>
            </DndContext>
            {service.characteristics.length < MAX_CHARS_PER_SERVICE && (
              <button className="add-btn" onClick={addCharacteristic}>
                + Add Characteristic
              </button>
            )}
          </CardBody>
        )}
      </Card>
    </div>
  )
}
