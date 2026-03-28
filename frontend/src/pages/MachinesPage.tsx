import { useEffect, useState, useCallback } from 'react'
import { Button, Spin, Empty, Typography, message, Space } from 'antd'
import { PlusOutlined, ReloadOutlined } from '@ant-design/icons'
import {
  DndContext, DragEndEvent, PointerSensor, KeyboardSensor, useSensor, useSensors, closestCenter,
} from '@dnd-kit/core'
import {
  SortableContext, sortableKeyboardCoordinates, useSortable,
  rectSortingStrategy, arrayMove,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import type { Machine, MachineCreate } from '../api/machines'
import { machinesApi } from '../api/machines'
import MachineCard from '../components/MachineCard'
import MachineFormModal from '../components/MachineFormModal'
import { ph } from '../theme/tokens'

const { Title } = Typography

function SortableMachineItem({
  machine, onEdit, onDeleted, onConnectionChange, index,
}: {
  machine: Machine
  onEdit: (m: Machine) => void
  onDeleted: (id: number) => void
  onConnectionChange: (id: number, connected: boolean) => void
  index: number
}) {
  const {
    attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging,
  } = useSortable({ id: `mc-${machine.id}` })

  return (
    <div
      ref={setNodeRef}
      className={isDragging ? 'ph-drag-active' : 'ph-hover-lift'}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.9 : 1,
        zIndex: isDragging ? 999 : undefined,
        animation: `ph-fade-in 0.35s ease-out both`,
        animationDelay: `${index * 60}ms`,
      }}
      {...attributes}
    >
      <MachineCard
        machine={machine}
        onEdit={onEdit}
        onDeleted={onDeleted}
        onConnectionChange={onConnectionChange}
        dragHandleRef={setActivatorNodeRef}
        dragListeners={listeners}
      />
    </div>
  )
}

export default function MachinesPage() {
  const [machines, setMachines] = useState<Machine[]>([])
  const [loading, setLoading] = useState(true)
  const [modalOpen, setModalOpen] = useState(false)
  const [editingMachine, setEditingMachine] = useState<Machine | null>(null)

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await machinesApi.list()
      setMachines(res.data.machines)
    } catch (_) {
      message.error('获取机器列表失败')
    }
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event
    if (!over || active.id === over.id) return
    const aIdx = machines.findIndex((m) => `mc-${m.id}` === String(active.id))
    const oIdx = machines.findIndex((m) => `mc-${m.id}` === String(over.id))
    if (aIdx === -1 || oIdx === -1) return
    const reordered = arrayMove(machines, aIdx, oIdx)
    setMachines(reordered)
    try {
      await Promise.all(reordered.map((m, i) => machinesApi.update(m.id, { sort_order: i })))
    } catch {
      message.error('调整顺序失败')
      load()
    }
  }

  const handleSave = async (data: MachineCreate) => {
    try {
      if (editingMachine) {
        const res = await machinesApi.update(editingMachine.id, data)
        setMachines((prev) => prev.map((m) => (m.id === editingMachine.id ? res.data : m)))
        message.success('已更新')
      } else {
        const res = await machinesApi.create(data)
        setMachines((prev) => [...prev, res.data])
        message.success('已添加')
      }
      setModalOpen(false)
      setEditingMachine(null)
    } catch (e: any) {
      message.error(e.response?.data?.detail ?? '操作失败')
    }
  }

  const handleConnectionChange = (id: number, connected: boolean) => {
    setMachines((prev) => prev.map((m) => (m.id === id ? { ...m, connected } : m)))
  }

  return (
    <div style={{ height: '100%', overflowY: 'auto', paddingRight: 4 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <Title level={4} style={{ margin: 0, color: ph.dark.text }}>机器管理</Title>
        <Space>
          <Button icon={<ReloadOutlined />} onClick={load}>刷新</Button>
          <Button
            type="primary"
            icon={<PlusOutlined />}
            onClick={() => { setEditingMachine(null); setModalOpen(true) }}
          >
            添加机器
          </Button>
        </Space>
      </div>

      {loading ? (
        <div style={{ textAlign: 'center', padding: 80 }}><Spin size="large" /></div>
      ) : machines.length === 0 ? (
        <Empty description={<span style={{ color: ph.dark.textSec }}>暂无机器</span>} style={{ padding: 80 }}>
          <Button
            type="primary" icon={<PlusOutlined />}
            onClick={() => { setEditingMachine(null); setModalOpen(true) }}
          >
            添加第一台机器
          </Button>
        </Empty>
      ) : (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          <SortableContext
            items={machines.map((m) => `mc-${m.id}`)}
            strategy={rectSortingStrategy}
          >
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(420px, 1fr))',
                gap: 16,
                alignItems: 'start',
              }}
            >
              {machines.map((m, i) => (
                <SortableMachineItem
                  key={m.id}
                  machine={m}
                  index={i}
                  onEdit={(machine) => { setEditingMachine(machine); setModalOpen(true) }}
                  onDeleted={(id) => setMachines((prev) => prev.filter((x) => x.id !== id))}
                  onConnectionChange={handleConnectionChange}
                />
              ))}
            </div>
          </SortableContext>
        </DndContext>
      )}

      <MachineFormModal
        open={modalOpen}
        machine={editingMachine}
        onOk={handleSave}
        onCancel={() => { setModalOpen(false); setEditingMachine(null) }}
      />
    </div>
  )
}
