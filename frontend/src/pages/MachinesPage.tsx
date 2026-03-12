import { useEffect, useState, useCallback } from 'react'
import { Button, Row, Col, Spin, Empty, Typography, message, Space } from 'antd'
import { PlusOutlined, ReloadOutlined } from '@ant-design/icons'
import type { Machine, MachineCreate } from '../api/machines'
import { machinesApi } from '../api/machines'
import MachineCard from '../components/MachineCard'
import MachineFormModal from '../components/MachineFormModal'

const { Title } = Typography

export default function MachinesPage() {
  const [machines, setMachines] = useState<Machine[]>([])
  const [loading, setLoading] = useState(true)
  const [modalOpen, setModalOpen] = useState(false)
  const [editingMachine, setEditingMachine] = useState<Machine | null>(null)

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
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <Title level={4} style={{ margin: 0 }}>机器管理</Title>
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
        <div style={{ textAlign: 'center', padding: 80 }}>
          <Spin size="large" />
        </div>
      ) : machines.length === 0 ? (
        <Empty
          description="暂无机器"
          style={{ padding: 80 }}
        >
          <Button
            type="primary"
            icon={<PlusOutlined />}
            onClick={() => { setEditingMachine(null); setModalOpen(true) }}
          >
            添加第一台机器
          </Button>
        </Empty>
      ) : (
        <Row gutter={[16, 16]} align="stretch">
          {machines.map((m) => (
            <Col key={m.id} xs={24} sm={24} md={12} lg={12} xl={8} xxl={6}
              style={{ display: 'flex', flexDirection: 'column' }}>
              <MachineCard
                machine={m}
                onEdit={(machine) => { setEditingMachine(machine); setModalOpen(true) }}
                onDeleted={(id) => setMachines((prev) => prev.filter((x) => x.id !== id))}
                onConnectionChange={handleConnectionChange}
              />
            </Col>
          ))}
        </Row>
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
