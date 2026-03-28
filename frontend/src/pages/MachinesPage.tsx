import { useEffect, useState, useCallback, useRef } from 'react'
import { Button, Spin, Empty, Typography, message, Space } from 'antd'
import { PlusOutlined, ReloadOutlined } from '@ant-design/icons'
import {
  DndContext, DragEndEvent, PointerSensor, KeyboardSensor, useSensor, useSensors, closestCenter,
} from '@dnd-kit/core'
import {
  SortableContext, sortableKeyboardCoordinates, useSortable,
  horizontalListSortingStrategy, arrayMove,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import type { Machine, MachineCreate } from '../api/machines'
import { machinesApi } from '../api/machines'
import MachineCard from '../components/MachineCard'
import MachineFormModal from '../components/MachineFormModal'
import { useTheme } from '../theme/useTheme'

const { Title } = Typography

const SCROLLBAR_H = 14

/**
 * Horizontal scroll area with a thick custom scrollbar **above** the content.
 * Uses a proxy div that mirrors the content width so the native scrollbar
 * sits on top, then syncs scroll positions between proxy and content.
 */
function HorizontalScrollArea({ children }: { children: React.ReactNode }) {
  const proxyRef = useRef<HTMLDivElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const [contentWidth, setContentWidth] = useState(0)
  const syncing = useRef(false)

  // Observe content width changes
  useEffect(() => {
    const el = contentRef.current
    if (!el) return
    const ro = new ResizeObserver(() => setContentWidth(el.scrollWidth))
    ro.observe(el)
    // Also measure children
    for (const child of Array.from(el.children)) ro.observe(child)
    return () => ro.disconnect()
  }, [children])

  const syncScroll = (source: 'proxy' | 'content') => {
    if (syncing.current) return
    syncing.current = true
    const p = proxyRef.current
    const c = contentRef.current
    if (p && c) {
      if (source === 'proxy') c.scrollLeft = p.scrollLeft
      else p.scrollLeft = c.scrollLeft
    }
    requestAnimationFrame(() => { syncing.current = false })
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      {/* Top scrollbar proxy */}
      <div
        ref={proxyRef}
        onScroll={() => syncScroll('proxy')}
        className="ph-top-scrollbar"
        style={{
          overflowX: 'auto',
          overflowY: 'hidden',
          height: SCROLLBAR_H + 4,
          minHeight: SCROLLBAR_H + 4,
          flexShrink: 0,
        }}
      >
        <div style={{ width: contentWidth, height: 1 }} />
      </div>

      {/* Actual content — hidden native scrollbar */}
      <div
        ref={contentRef}
        onScroll={() => syncScroll('content')}
        className="ph-hide-scrollbar"
        style={{
          overflowX: 'auto',
          overflowY: 'auto',
          flex: 1,
          minHeight: 0,
        }}
      >
        <div
          style={{
            display: 'flex',
            gap: 16,
            padding: '8px 2px 16px',
            alignItems: 'flex-start',
          }}
        >
          {children}
        </div>
      </div>
    </div>
  )
}

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
        width: 460,
        minWidth: 460,
        flexShrink: 0,
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
  const { t } = useTheme()
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
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <Title level={4} style={{ margin: 0, color: t.text }}>机器管理</Title>
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
        <Empty description={<span style={{ color: t.textSec }}>暂无机器</span>} style={{ padding: 80 }}>
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
            strategy={horizontalListSortingStrategy}
          >
            <HorizontalScrollArea>
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
            </HorizontalScrollArea>
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
