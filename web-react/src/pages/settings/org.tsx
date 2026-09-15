import { useEffect, useState } from 'react';
import { Tabs, TabPane, Table, Button, Modal, Input, InputNumber, Space, Tag, Toast, Tree, Card, Typography } from '@douyinfe/semi-ui';
import { IconPlus, IconRefresh } from '@douyinfe/semi-icons';
import { get as httpGet, postForm, post, del } from '@/api/http';

/** 设置 → 组织与地图：行政区划 | 业务分组 | 电子地图（WVP 直连 + 地图占位） */
export default function OrgPage() {
  return (
    <div className="page-root">
      <div className="page-body">
        <Tabs type="line">
          <TabPane tab="行政区划" itemKey="region"><RegionTab /></TabPane>
          <TabPane tab="业务分组" itemKey="group"><GroupTab /></TabPane>
          <TabPane tab="电子地图" itemKey="map"><MapTab /></TabPane>
        </Tabs>
      </div>
    </div>
  );
}

function RegionTab() {
  const [tree, setTree] = useState<any[]>([]);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<any>({});

  const load = async () => {
    const d = await httpGet<any[]>('/api/region/tree/list', { query: 1 }).catch(() => []);
    setTree(d || []);
  };
  useEffect(() => { load(); }, []);

  const toTreeData = (nodes: any[]): any[] =>
    (nodes || []).map((n) => ({
      key: `r-${n.id}`,
      label: `${n.name || n.deviceId || n.id}`,
      children: n.children ? toTreeData(n.children) : undefined,
      data: n,
    }));

  return (
    <>
      <Space style={{ marginBottom: 12 }}>
        <Button icon={<IconRefresh />} onClick={load}>刷新</Button>
        <Button icon={<IconPlus />} theme="solid" onClick={() => setOpen(true)}>添加区划</Button>
        <Button onClick={() => httpGet('/api/region/sync').then(() => { Toast.success('已同步civilCode'); load(); }).catch(() => {})}>同步行政区划</Button>
      </Space>
      <Card size="small" style={{ maxHeight: 560, overflow: 'auto' }}>
        <Tree treeData={toTreeData(tree)} expandAll />
      </Card>
      <Modal title="添加行政区划" visible={open} onCancel={() => setOpen(false)}
        onOk={async () => {
          await postForm('/api/region/add', form);
          Toast.success('区划已添加');
          setOpen(false);
          load();
        }}>
        <Space vertical style={{ width: '100%' }}>
          <Input placeholder="名称" value={form.name} onChange={(v) => setForm({ ...form, name: v })} />
          <Input placeholder="父区划ID (根留空)" value={form.parentId} onChange={(v) => setForm({ ...form, parentId: v })} />
        </Space>
      </Modal>
    </>
  );
}

function GroupTab() {
  const [tree, setTree] = useState<any[]>([]);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<any>({});

  const load = async () => {
    const d = await httpGet<any[]>('/api/group/tree/list', { query: 1 }).catch(() => []);
    setTree(d || []);
  };
  useEffect(() => { load(); }, []);

  const toTreeData = (nodes: any[]): any[] =>
    (nodes || []).map((n) => ({
      key: `g-${n.id}`,
      label: n.name || n.deviceId || `分组${n.id}`,
      children: n.children ? toTreeData(n.children) : undefined,
      data: n,
    }));

  return (
    <>
      <Space style={{ marginBottom: 12 }}>
        <Button icon={<IconRefresh />} onClick={load}>刷新</Button>
        <Button icon={<IconPlus />} theme="solid" onClick={() => setOpen(true)}>添加分组</Button>
      </Space>
      <Card size="small" style={{ maxHeight: 560, overflow: 'auto' }}>
        <Tree treeData={toTreeData(tree)} expandAll />
      </Card>
      <Modal title="添加业务分组" visible={open} onCancel={() => setOpen(false)}
        onOk={async () => {
          await postForm('/api/group/add', form);
          Toast.success('分组已添加');
          setOpen(false);
          load();
        }}>
        <Space vertical style={{ width: '100%' }}>
          <Input placeholder="分组名称" value={form.name} onChange={(v) => setForm({ ...form, name: v })} />
          <Input placeholder="父分组ID (根留空)" value={form.parentId} onChange={(v) => setForm({ ...form, parentId: v })} />
          <Input placeholder="业务分组类型 (可选)" value={form.businessGroup} onChange={(v) => setForm({ ...form, businessGroup: v })} />
        </Space>
      </Modal>
    </>
  );
}

function MapTab() {
  const [config, setConfig] = useState<any>(null);

  useEffect(() => {
    httpGet<any>('/api/server/map/config').then(setConfig).catch(() => setConfig(null));
  }, []);

  return (
    <Card size="small" title="电子地图配置">
      {config ? (
        <Table size="small" pagination={false} dataSource={[
          { key: 'center', label: '中心点', value: `${config.center?.lat ?? '-'}, ${config.center?.lng ?? '-'}` },
          { key: 'zoom', label: '默认层级', value: config.zoom ?? '-' },
          { key: 'tileUrl', label: '瓦片服务', value: config.tileUrl ?? '内置矢量瓦片' },
        ]}
          columns={[{ title: '配置项', dataIndex: 'label' }, { title: '值', dataIndex: 'value' }]} />
      ) : (
        <Typography.Text type="tertiary">
          地图使用 OpenLayers 矢量瓦片。旧平台的 2D 电气接线图属其自有数据源，若可导出可作为底图接入；点云底图依赖机器人回传（见方案文档第十二节差距说明）。
        </Typography.Text>
      )}
    </Card>
  );
}
