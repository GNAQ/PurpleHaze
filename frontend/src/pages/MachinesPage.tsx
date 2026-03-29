import { useEffect, useState, useCallback, useRef } from 'react'
import { Button, Spin, Empty, message, Space } from 'antd'
import { PlusOutlined, ReloadOutlined, DesktopOutlined } from '@ant-design/icons'
import {
  DndContext, DragEndEvent, DragOverlay, DragStartEvent,
  PointerSensor, KeyboardSensor, useSensor, useSensors, closestCenter,
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

const CUSTOM_SCROLLBAR_H = 26
const HIDDEN_SCROLLBAR_GUTTER = 22
const MIN_SCROLLBAR_THUMB_W = 78
const MAX_SCROLLBAR_THUMB_W = 220
const THUMB_COMPACT_RATIO = 0.62

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))

function GripDots() {
  return (
    <div className="ph-grip">
      <span /><span /><span /><span /><span /><span />
    </div>
  )
}

function getMachineIdFromDragId(id: string | number) {
  const raw = String(id)
  if (!raw.startsWith('mc-')) return null
  const machineId = Number(raw.slice(3))
  return Number.isNaN(machineId) ? null : machineId
}

function MachineDragPreview({ machine }: { machine: Machine }) {
  const { t } = useTheme()
  const connected = machine.is_local || machine.connected
  const endpoint = machine.is_local
    ? 'localhost'
    : `${machine.ssh_username}@${machine.ssh_host}:${machine.ssh_port}`

  return (
    <div
      className="ph-drag-overlay-card"
      style={{
        width: 460,
        minWidth: 460,
        pointerEvents: 'none',
      }}
    >
      <div
        className="ph-glass"
        style={{
          borderRadius: 14,
          overflow: 'hidden',
          border: connected ? '1px solid rgba(117,193,129,0.22)' : `1px solid ${t.glassBorder}`,
          borderLeft: connected ? '3px solid rgba(117,193,129,0.92)' : `1px solid ${t.glassBorder}`,
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '6px 0',
            background: 'rgba(188,115,173,0.08)',
            borderBottom: '1px solid rgba(188,115,173,0.12)',
          }}
        >
          <GripDots />
        </div>

        <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, minWidth: 0, flex: 1 }}>
              <div style={{
                width: 34,
                height: 34,
                borderRadius: 10,
                background: 'linear-gradient(135deg, rgba(188,115,173,0.22) 0%, rgba(117,193,129,0.12) 100%)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0,
              }}>
                <DesktopOutlined style={{ fontSize: 17, color: 'rgba(206,149,194,0.92)' }} />
              </div>

              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ fontSize: 18, fontWeight: 600, lineHeight: 1.25, color: t.text, wordBreak: 'break-word' }}>
                  {machine.name}
                </div>
                <div className="ph-mono" style={{ fontSize: 11, marginTop: 4, color: t.textSec, wordBreak: 'break-all' }}>
                  {endpoint}
                </div>
              </div>
            </div>

            <div
              className="ph-mono"
              style={{
                padding: '5px 10px',
                borderRadius: 999,
                fontSize: 11,
                fontWeight: 700,
                letterSpacing: 0.5,
                background: connected ? 'rgba(117,193,129,0.12)' : 'rgba(188,115,173,0.08)',
                color: connected ? 'rgba(117,193,129,0.98)' : t.textTer,
                border: connected ? '1px solid rgba(117,193,129,0.24)' : '1px solid rgba(188,115,173,0.12)',
              }}
            >
              {connected ? 'ONLINE' : 'OFFLINE'}
            </div>
          </div>

          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            <div className="ph-mono" style={{
              padding: '5px 10px',
              borderRadius: 999,
              fontSize: 11,
              color: t.textSec,
              background: 'rgba(188,115,173,0.08)',
              border: '1px solid rgba(188,115,173,0.12)',
            }}>
              {machine.is_local ? '本机' : '远程机器'}
            </div>
            <div className="ph-mono" style={{
              padding: '5px 10px',
              borderRadius: 999,
              fontSize: 11,
              color: t.textSec,
              background: 'rgba(188,115,173,0.08)',
              border: '1px solid rgba(188,115,173,0.12)',
            }}>
              POLL {machine.monitor_config?.interval ?? 10}s
            </div>
            <div className="ph-mono" style={{
              padding: '5px 10px',
              borderRadius: 999,
              fontSize: 11,
              color: machine.auto_reconnect ? 'rgba(117,193,129,0.98)' : t.textTer,
              background: machine.auto_reconnect ? 'rgba(117,193,129,0.10)' : 'rgba(188,115,173,0.08)',
              border: machine.auto_reconnect ? '1px solid rgba(117,193,129,0.20)' : '1px solid rgba(188,115,173,0.12)',
            }}>
              {machine.auto_reconnect ? '自动重连' : '手动重连'}
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 8 }}>
            <div style={{
              borderRadius: 10,
              padding: '10px 12px',
              background: 'rgba(188,115,173,0.05)',
              border: '1px solid rgba(188,115,173,0.10)',
            }}>
              <div className="ph-mono" style={{ fontSize: 10, color: t.textTer, letterSpacing: 0.5, marginBottom: 4 }}>
                DRAG MODE
              </div>
              <div style={{ fontSize: 13, fontWeight: 600, color: t.text }}>卡片会跟随鼠标浮动</div>
            </div>

            <div style={{
              borderRadius: 10,
              padding: '10px 12px',
              background: connected ? 'rgba(117,193,129,0.08)' : 'rgba(188,115,173,0.05)',
              border: connected ? '1px solid rgba(117,193,129,0.14)' : '1px solid rgba(188,115,173,0.10)',
            }}>
              <div className="ph-mono" style={{ fontSize: 10, color: t.textTer, letterSpacing: 0.5, marginBottom: 4 }}>
                MACHINE STATE
              </div>
              <div style={{ fontSize: 13, fontWeight: 600, color: t.text }}>
                {connected ? '监控在线，可直接排序' : '离线机器，等待连接'}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

/**
 * Horizontal scroll area with a fully custom scrollbar above the content.
 * The content still scrolls natively for wheel/touchpad support, but its
 * bottom horizontal scrollbar is clipped away so only the custom top bar shows.
 */
function HorizontalScrollArea({ children }: { children: React.ReactNode }) {
  const trackRef = useRef<HTMLDivElement>(null)
  const viewportRef = useRef<HTMLDivElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const dragStateRef = useRef<{ pointerId: number; trackLeft: number; grabOffset: number } | null>(null)
  const metricsRef = useRef({ viewportWidth: 0, contentWidth: 0, trackWidth: 0, scrollLeft: 0 })
  const [metrics, setMetrics] = useState(metricsRef.current)
  const [draggingThumb, setDraggingThumb] = useState(false)

  const syncMetrics = useCallback(() => {
    const viewport = viewportRef.current
    const content = contentRef.current
    const track = trackRef.current
    if (!viewport || !content || !track) return

    const viewportWidth = viewport.clientWidth
    const contentWidth = content.scrollWidth
    const trackWidth = track.clientWidth
    const maxScroll = Math.max(contentWidth - viewportWidth, 0)
    const scrollLeft = clamp(viewport.scrollLeft, 0, maxScroll)

    if (viewport.scrollLeft !== scrollLeft) viewport.scrollLeft = scrollLeft

    const nextMetrics = { viewportWidth, contentWidth, trackWidth, scrollLeft }
    metricsRef.current = nextMetrics
    setMetrics((prev) => (
      prev.viewportWidth === nextMetrics.viewportWidth
      && prev.contentWidth === nextMetrics.contentWidth
      && prev.trackWidth === nextMetrics.trackWidth
      && prev.scrollLeft === nextMetrics.scrollLeft
    ) ? prev : nextMetrics)
  }, [])

  useEffect(() => {
    syncMetrics()

    const viewport = viewportRef.current
    const content = contentRef.current
    const track = trackRef.current
    if (!viewport || !content || !track) return

    const handleScroll = () => {
      const current = metricsRef.current
      const scrollLeft = clamp(viewport.scrollLeft, 0, Math.max(viewport.scrollWidth - viewport.clientWidth, 0))
      const nextMetrics = { ...current, scrollLeft }
      metricsRef.current = nextMetrics
      setMetrics((prev) => (prev.scrollLeft === scrollLeft ? prev : nextMetrics))
    }

    const resizeObserver = new ResizeObserver(syncMetrics)
    resizeObserver.observe(viewport)
    resizeObserver.observe(content)
    resizeObserver.observe(track)
    viewport.addEventListener('scroll', handleScroll, { passive: true })

    return () => {
      resizeObserver.disconnect()
      viewport.removeEventListener('scroll', handleScroll)
    }
  }, [syncMetrics])

  useEffect(() => {
    const frame = requestAnimationFrame(syncMetrics)
    return () => cancelAnimationFrame(frame)
  }, [children, syncMetrics])

  const getThumbMetrics = () => {
    const { viewportWidth, contentWidth, trackWidth, scrollLeft } = metricsRef.current
    const maxScroll = Math.max(contentWidth - viewportWidth, 0)
    const hasOverflow = maxScroll > 0 && trackWidth > 0
    const thumbWidth = !hasOverflow
      ? trackWidth
      : clamp(
        (viewportWidth / contentWidth) * trackWidth * THUMB_COMPACT_RATIO,
        MIN_SCROLLBAR_THUMB_W,
        Math.min(trackWidth, MAX_SCROLLBAR_THUMB_W),
      )
    const maxThumbLeft = Math.max(trackWidth - thumbWidth, 0)
    const thumbLeft = !hasOverflow || maxThumbLeft === 0 ? 0 : (scrollLeft / maxScroll) * maxThumbLeft

    return { hasOverflow, maxScroll, thumbWidth, maxThumbLeft, thumbLeft }
  }

  const { hasOverflow, maxScroll, thumbWidth, maxThumbLeft, thumbLeft } = getThumbMetrics()

  const scrollViewport = (nextScrollLeft: number) => {
    const viewport = viewportRef.current
    if (!viewport) return
    viewport.scrollLeft = clamp(nextScrollLeft, 0, Math.max(viewport.scrollWidth - viewport.clientWidth, 0))
  }

  const scrollViewportFromThumb = (nextThumbLeft: number) => {
    const current = getThumbMetrics()
    if (!current.hasOverflow || current.maxThumbLeft === 0) {
      scrollViewport(0)
      return
    }
    scrollViewport((clamp(nextThumbLeft, 0, current.maxThumbLeft) / current.maxThumbLeft) * current.maxScroll)
  }

  const stopThumbDrag = () => {
    if (!dragStateRef.current) return
    dragStateRef.current = null
    setDraggingThumb(false)
  }

  const handleTrackPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const dragState = dragStateRef.current
    if (!dragState || dragState.pointerId !== event.pointerId) return
    event.preventDefault()
    scrollViewportFromThumb(event.clientX - dragState.trackLeft - dragState.grabOffset)
  }

  const handleTrackPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    const track = trackRef.current
    if (!track || !hasOverflow) return

    const trackRect = track.getBoundingClientRect()
    const nextThumbLeft = clamp(event.clientX - trackRect.left - (thumbWidth / 2), 0, maxThumbLeft)
    dragStateRef.current = {
      pointerId: event.pointerId,
      trackLeft: trackRect.left,
      grabOffset: thumbWidth / 2,
    }
    track.setPointerCapture(event.pointerId)
    setDraggingThumb(true)
    scrollViewportFromThumb(nextThumbLeft)
  }

  const handleThumbPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    const track = trackRef.current
    if (!track || !hasOverflow) return

    event.preventDefault()
    event.stopPropagation()

    const trackRect = track.getBoundingClientRect()
    dragStateRef.current = {
      pointerId: event.pointerId,
      trackLeft: trackRect.left,
      grabOffset: event.clientX - (trackRect.left + thumbLeft),
    }
    track.setPointerCapture(event.pointerId)
    setDraggingThumb(true)
  }

  const handleTrackWheel = (event: React.WheelEvent<HTMLDivElement>) => {
    if (!hasOverflow) return
    const delta = Math.abs(event.deltaX) > 0 ? event.deltaX : event.deltaY
    if (delta === 0) return
    event.preventDefault()
    scrollViewport(metricsRef.current.scrollLeft + delta)
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0, gap: 8 }}>
      <div
        ref={trackRef}
        className={`ph-machine-scrollbar${hasOverflow ? '' : ' is-disabled'}${draggingThumb ? ' is-dragging' : ''}`}
        onPointerDown={handleTrackPointerDown}
        onPointerMove={handleTrackPointerMove}
        onPointerUp={stopThumbDrag}
        onPointerCancel={stopThumbDrag}
        onLostPointerCapture={stopThumbDrag}
        onWheel={handleTrackWheel}
        style={{
          height: CUSTOM_SCROLLBAR_H,
          minHeight: CUSTOM_SCROLLBAR_H,
          flexShrink: 0,
        }}
        role="scrollbar"
        aria-label="机器列表横向滚动条"
        aria-orientation="horizontal"
        aria-valuemin={0}
        aria-valuemax={Math.max(maxScroll, 0)}
        aria-valuenow={Math.round(metrics.scrollLeft)}
      >
        <div
          className="ph-machine-scrollbar__thumb"
          data-role="scrollbar-thumb"
          onPointerDown={handleThumbPointerDown}
          style={{
            width: Math.max(thumbWidth, 0),
            transform: `translateX(${thumbLeft}px)`,
          }}
        />
      </div>

      <div style={{ flex: 1, minHeight: 0, overflow: 'hidden' }}>
        <div
          ref={viewportRef}
          style={{
            overflowX: 'auto',
            overflowY: 'auto',
            height: `calc(100% + ${HIDDEN_SCROLLBAR_GUTTER}px)`,
            minHeight: 0,
            overscrollBehaviorX: 'contain',
          }}
        >
          <div
            ref={contentRef}
            style={{
              display: 'flex',
              width: 'max-content',
              minWidth: '100%',
              gap: 16,
              padding: '4px 2px 12px',
              alignItems: 'flex-start',
            }}
          >
            {children}
          </div>
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
        opacity: isDragging ? 0.18 : 1,
        zIndex: isDragging ? 0 : undefined,
        pointerEvents: isDragging ? 'none' : undefined,
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
  const [activeMachineId, setActiveMachineId] = useState<number | null>(null)

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  const activeMachine = activeMachineId == null
    ? null
    : machines.find((machine) => machine.id === activeMachineId) ?? null
  const connectedCount = machines.filter((machine) => machine.is_local || machine.connected).length

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

  const handleDragStart = (event: DragStartEvent) => {
    setActiveMachineId(getMachineIdFromDragId(event.active.id))
  }

  const handleDragEnd = async (event: DragEndEvent) => {
    setActiveMachineId(null)

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
    <div className="ph-page-shell ph-page-shell--machines">
      <div className="ph-page-toolbar">
        <div className="ph-page-toolbar-main">
          <div className="ph-page-rail">
            <span className="ph-page-chip ph-page-chip--accent">
              {loading ? '载入机器中' : `${machines.length} 台机器`}
            </span>
            <span className="ph-page-chip">{loading ? '状态统计中' : `${connectedCount} 台在线`}</span>
            <span className="ph-page-chip">拖拽排序</span>
          </div>
        </div>
        <div className="ph-page-toolbar-actions">
          <Space wrap>
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
      </div>

      <div className="ph-page-content">
        <div className="ph-page-content__body" style={{ display: 'flex', flexDirection: 'column', padding: '2px 0 0' }}>
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
            <div className="ph-board-stage ph-board-stage--fleet">
              <div className="ph-board-stage__inner">
                <DndContext
                  sensors={sensors}
                  collisionDetection={closestCenter}
                  onDragStart={handleDragStart}
                  onDragEnd={handleDragEnd}
                  onDragCancel={() => setActiveMachineId(null)}
                >
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

                  <DragOverlay zIndex={1200}>
                    {activeMachine ? <MachineDragPreview machine={activeMachine} /> : null}
                  </DragOverlay>
                </DndContext>
              </div>
            </div>
          )}
        </div>
      </div>

      <MachineFormModal
        open={modalOpen}
        machine={editingMachine}
        onOk={handleSave}
        onCancel={() => { setModalOpen(false); setEditingMachine(null) }}
      />
    </div>
  )
}
