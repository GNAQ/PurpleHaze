/**
 * 路径选择器弹窗
 * 调用后端 /api/fs/browse 浏览目录，选择后回调路径
 */
import { useState, useEffect } from 'react'
import { Modal, List, Button, Input, Space, Typography, Spin, message } from 'antd'
import {
  FolderOutlined, FileOutlined, ArrowLeftOutlined, HomeOutlined,
} from '@ant-design/icons'
import { tasksApi, FsItem } from '../api/tasks'

const { Text } = Typography

interface Props {
  open: boolean
  onClose: () => void
  onSelect: (path: string) => void
  initialPath?: string
  machineId?: number
  title?: string
  /** 只显示目录 */
  dirsOnly?: boolean
}

export default function PathPickerModal({
  open, onClose, onSelect,
  initialPath = '/',
  machineId,
  title = '选择路径',
  dirsOnly = false,
}: Props) {
  const [currentPath, setCurrentPath] = useState(initialPath)
  const [parent, setParent] = useState<string | null>(null)
  const [items, setItems] = useState<FsItem[]>([])
  const [loading, setLoading] = useState(false)
  const [inputPath, setInputPath] = useState(initialPath)

  useEffect(() => {
    if (open) {
      browse(initialPath)
    }
  }, [open])

  async function browse(path: string) {
    setLoading(true)
    try {
      const res = await tasksApi.browse(path, machineId)
      const d = res.data
      setCurrentPath(d.path)
      setParent(d.parent)
      setInputPath(d.path)
      const displayItems = dirsOnly
        ? d.items.filter((i) => i.is_dir)
        : d.items
      setItems(displayItems)
    } catch (e: any) {
      message.error(e.response?.data?.detail || '目录访问失败')
    } finally {
      setLoading(false)
    }
  }

  function handleManualInput() {
    browse(inputPath)
  }

  return (
    <Modal
      title={title}
      open={open}
      onCancel={onClose}
      width={560}
      footer={
        <Space>
          <Button onClick={onClose}>取消</Button>
          <Button
            type="primary"
            onClick={() => { onSelect(currentPath); onClose() }}
            style={{ background: '#7c3aed' }}
          >
            选择当前目录: {currentPath}
          </Button>
        </Space>
      }
    >
      {/* 手动输入路径 */}
      <Space.Compact style={{ width: '100%', marginBottom: 8 }}>
        <Input
          value={inputPath}
          onChange={(e) => setInputPath(e.target.value)}
          onPressEnter={handleManualInput}
          placeholder="输入路径并回车"
        />
        <Button onClick={handleManualInput}>跳转</Button>
      </Space.Compact>

      {/* 导航按钮 */}
      <Space style={{ marginBottom: 8 }}>
        {parent && (
          <Button
            size="small"
            icon={<ArrowLeftOutlined />}
            onClick={() => browse(parent!)}
          >
            上级目录
          </Button>
        )}
        <Button
          size="small"
          icon={<HomeOutlined />}
          onClick={() => browse('/')}
        >
          根目录
        </Button>
        <Text type="secondary" style={{ fontSize: 12 }}>{currentPath}</Text>
      </Space>

      {/* 目录列表 */}
      <div style={{ height: 320, overflow: 'auto', border: '1px solid #f0f0f0', borderRadius: 6 }}>
        {loading ? (
          <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100%' }}>
            <Spin />
          </div>
        ) : (
          <List
            size="small"
            dataSource={items}
            locale={{ emptyText: '目录为空' }}
            renderItem={(item) => (
              <List.Item
                style={{ cursor: item.is_dir ? 'pointer' : 'default', padding: '6px 12px' }}
                onClick={() => {
                  if (item.is_dir) browse(item.path)
                  else if (!dirsOnly) { onSelect(item.path); onClose() }
                }}
                actions={
                  !dirsOnly && !item.is_dir
                    ? [<Button size="small" type="link" key="sel" onClick={() => { onSelect(item.path); onClose() }}>选择</Button>]
                    : undefined
                }
              >
                <Space>
                  {item.is_dir
                    ? <FolderOutlined style={{ color: '#faad14' }} />
                    : <FileOutlined style={{ color: '#8c8c8c' }} />
                  }
                  <Text style={{ fontSize: 13 }}>{item.name}</Text>
                </Space>
              </List.Item>
            )}
          />
        )}
      </div>
    </Modal>
  )
}
