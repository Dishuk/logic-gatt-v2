import { useMemo } from 'react'
import type { Service, DeviceSettings } from '../types'
import { ServiceCard } from './ServiceCard'
import { DeviceSettingsCard } from './DeviceSettingsCard'
import { MAX_SERVICES } from '../lib/constants'
import type { DragEndEvent } from '@dnd-kit/core'
import { DndContext, closestCenter, KeyboardSensor, PointerSensor, useSensor, useSensors } from '@dnd-kit/core'
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'

function findDuplicateUuids(services: Service[]): Set<string> {
  const seen = new Map<string, number>()
  for (const s of services) {
    if (s.uuid) seen.set(s.uuid, (seen.get(s.uuid) ?? 0) + 1)
    for (const c of s.characteristics) {
      if (c.uuid) seen.set(c.uuid, (seen.get(c.uuid) ?? 0) + 1)
    }
  }
  const dupes = new Set<string>()
  for (const [uuid, count] of seen) {
    if (count > 1) dupes.add(uuid)
  }
  return dupes
}

interface ServicesPanelProps {
  project: {
    deviceSettings: DeviceSettings
    setDeviceSettings: (settings: DeviceSettings) => void
    services: Service[]
    setServices: (services: Service[]) => void
    addService: () => void
    updateService: (id: string, updated: Service) => void
    removeService: (id: string) => void
  }
}

export function ServicesPanel({ project }: ServicesPanelProps) {
  const { deviceSettings, setDeviceSettings, services, setServices, addService, updateService, removeService } =
    project
  const dupUuids = useMemo(() => findDuplicateUuids(services), [services])

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  )

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event
    if (over && active.id !== over.id) {
      const oldIndex = services.findIndex(s => s.id === active.id)
      const newIndex = services.findIndex(s => s.id === over.id)
      if (oldIndex === -1 || newIndex === -1) return
      setServices(arrayMove(services, oldIndex, newIndex))
    }
  }

  return (
    <div className="panel-left">
      <div className="panel-header">
        <span>
          Services ({services.length}/{MAX_SERVICES})
        </span>
      </div>
      <div className="panel-content panel-content--scroll">
        <DeviceSettingsCard settings={deviceSettings} onChange={setDeviceSettings} />
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          <SortableContext items={services.map(s => s.id)} strategy={verticalListSortingStrategy}>
            {services.map(service => (
              <ServiceCard
                key={service.id}
                service={service}
                onChange={updated => updateService(service.id, updated)}
                onRemove={() => removeService(service.id)}
                dupUuids={dupUuids}
              />
            ))}
          </SortableContext>
        </DndContext>
        {services.length < MAX_SERVICES && (
          <button className="add-btn" onClick={addService}>
            + Add Service
          </button>
        )}
      </div>
    </div>
  )
}
