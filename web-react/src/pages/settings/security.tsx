import { useEffect, useState } from 'react';
import {
  Tabs, TabPane, Table, Button, Modal, Form, Input, Select, Space, Tag, Toast, Popconfirm, Card, Descriptions, Switch,
  Checkbox, Banner, Typography,
} from '@douyinfe/semi-ui';
import { IconPlus, IconRefresh, IconEdit, IconDelete, IconCheck } from '@douyinfe/semi-icons';
import { get as httpGet, postForm, post, del } from '@/api/http';
import md5 from '@/utils/md5';
import { useAuthStore } from '@/store/auth';

/** 设置 → 账号与安全：用户管理 | 角色与权限 | 操作审计 | API Key */
export default function SecurityPage() {
  return (
    <div className="page-root">
      <div className="page-body">
        <Tabs type="line">
          <TabPane tab="用户管理" itemKey="users"><UsersTab /></TabPane>
          <TabPane tab="角色与权限" itemKey="roles"><RolesTab /></TabPane>
          <TabPane tab="操作审计" itemKey="audit"><AuditTab /></TabPane>
          <TabPane tab="API Key" itemKey="apikeys"><ApiKeysTab /></TabPane>
        </Tabs>
      </div>
    </div>
  );
}

function UsersTab() {
  const [rows, setRows] = useState<any[]>([]);
  const [roles, setRoles] = useState<any[]>([]);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<any>({ username: '', password: '', roleId: 1 });
  const hasPerm = useAuthStore((s) => s.hasPerm);

  const load = async () => {
    const [u, r] = await Promise.all([
      httpGet<any>('/api/user/users', { page: 1, count: 100 }).then((d) => (Array.isArray(d) ? d : d?.list ?? [])).catch(() => []),
      httpGet<any[]>('/api/role/all').catch(() => []),
    ]);
    setRows(u || []);
    setRoles(r || []);
  };
  useEffect(() => { load(); }, []);

  const add = async () => {
    try {
      await postForm('/api/user/add', { username: form.username, password: form.password, roleId: form.roleId });
      Toast.success('用户已创建');
      setOpen(false);
      load();
    } catch { /* 请求层已提示 */ }
  };

  const resetPwd = async (row: any) => {
    Modal.confirm({
      title: `管理员重置 ${row.username} 的密码`,
      content: (
        <Input id="reset-pwd-input" placeholder="新密码（明文输入，后端MD5存储）" />
      ),
      onOk: async () => {
        const v = (document.getElementById('reset-pwd-input') as HTMLInputElement)?.value;
        if (!v) { Toast.warning('请输入新密码'); return Promise.reject(); }
        await postForm('/api/user/changePasswordForAdmin', { userId: row.id, password: v });
        Toast.success('密码已重置');
      },
    });
  };

  return (
    <>
      <Space style={{ marginBottom: 12 }}>
        <Button icon={<IconPlus />} theme="solid" disabled={!hasPerm('settings.security', 'create')} onClick={() => setOpen(true)}>添加用户</Button>
        <Button icon={<IconRefresh />} onClick={load} />
      </Space>
      <Table size="small" dataSource={rows} pagination={false}
        columns={[
          { title: 'ID', dataIndex: 'id', width: 60 },
          { title: '用户名', dataIndex: 'username' },
          { title: '角色', dataIndex: 'role', render: (r: any) => <Tag>{r?.name ?? '-'}</Tag> },
          { title: '创建时间', dataIndex: 'createTime', width: 170 },
          {
            title: '操作', width: 200,
            render: (_: any, r: any) => (
              <Space>
                <Button size="small" disabled={r.role?.id === 1} onClick={() => resetPwd(r)}>重置密码</Button>
                <Popconfirm title="确认删除该用户？" onConfirm={async () => { await del('/api/user/delete', { id: r.id }); Toast.success('已删除'); load(); }}>
                  <Button size="small" type="danger" theme="light" disabled={r.role?.id === 1}>删除</Button>
                </Popconfirm>
              </Space>
            ),
          },
        ]} />
      <Modal title="添加用户" visible={open} onCancel={() => setOpen(false)} onOk={add}>
        <Form onSubmit={add}>
          <Form.Input field="username" label="用户名" onChange={(v) => setForm({ ...form, username: v })} />
          <Form.Input field="password" label="密码（需复杂度）" mode="password" onChange={(v) => setForm({ ...form, password: v })} />
          <Form.Select field="roleId" label="角色" style={{ width: '100%' }} optionList={roles.map((r: any) => ({ value: r.id, label: r.name }))} onChange={(v) => setForm({ ...form, roleId: v })} />
        </Form>
      </Modal>
    </>
  );
}

const ACTION_LABEL_MAP: Record<string, { label: string; color: string; desc: string }> = {
  view: { label: '浏览查看', color: 'blue', desc: '允许查看页面与基本信息' },
  create: { label: '新增创建', color: 'green', desc: '允许添加新设备/任务/资源' },
  edit: { label: '编辑修改', color: 'amber', desc: '允许修改配置与参数' },
  delete: { label: '删除移除', color: 'red', desc: '允许删除资源' },
  execute: { label: '执行控制', color: 'purple', desc: '允许下发执行与控制指令' },
  export: { label: '数据导出', color: 'cyan', desc: '允许导出清单与统计报表' },
  ptz: { label: '云台控制', color: 'teal', desc: '允许方向旋转与变焦调焦' },
  preset: { label: '预置位设置', color: 'indigo', desc: '允许增删改与调用预置位' },
  snapshot: { label: '抓拍取证', color: 'lime', desc: '允许手动抓拍并存证' },
  download: { label: '录像下载', color: 'orange', desc: '允许下载历史录像片段' },
  review: { label: '审核确认', color: 'violet', desc: '允许审核巡检与研判结果' },
  confirm: { label: '消警处理', color: 'pink', desc: '允许确认并消除告警' },
};

function RolesTab() {
  const [roles, setRoles] = useState<any[]>([]);
  const [modules, setModules] = useState<any[]>([]);
  const [current, setCurrent] = useState<number | null>(null);
  const [perm, setPerm] = useState<Record<string, string[]>>({});
  const [addModalOpen, setAddModalOpen] = useState(false);
  const [editModalOpen, setEditModalOpen] = useState(false);
  const [roleForm, setRoleForm] = useState<{ id?: number; name: string; authority?: string }>({ name: '', authority: 'user' });
  const [saving, setSaving] = useState(false);
  const hasPerm = useAuthStore((s) => s.hasPerm);

  const loadRoles = async (selectId?: number) => {
    const r = await httpGet<any[]>('/api/role/all').catch(() => []);
    setRoles(r || []);
    if (selectId) {
      openPerm(selectId);
    } else if (r && r.length > 0 && current == null) {
      openPerm(r[0].id);
    }
  };

  useEffect(() => {
    loadRoles();
    httpGet<any[]>('/api/patrol/role-permission/modules').then(setModules).catch(() => {});
  }, []);

  const openPerm = async (roleId: number) => {
    setCurrent(roleId);
    try {
      const p = await httpGet<any>(`/api/patrol/role-permission/${roleId}`);
      const map: Record<string, string[]> = {};
      (p.modules || []).forEach((m: any) => {
        try { map[m.module] = JSON.parse(m.actionsJson || '["view"]'); } catch { map[m.module] = ['view']; }
      });
      setPerm(map);
    } catch {
      setPerm({});
    }
  };

  const savePerm = async () => {
    if (current == null) return;
    setSaving(true);
    try {
      await post('/api/patrol/role-permission/save', {
        roleId: current,
        modules: Object.entries(perm).map(([module, actions]) => ({ module, actions })),
        scopeType: 'ALL',
      });
      Toast.success('角色权限已保存');
    } catch { /* 请求层已提示 */ }
    finally { setSaving(false); }
  };

  // 快捷模板操作
  const selectAll = () => {
    const map: Record<string, string[]> = {};
    (modules || []).forEach((m) => {
      map[m.code] = [...(m.actions || [])];
    });
    setPerm(map);
    Toast.info('已勾选本角色全部模块权限');
  };

  const selectReadOnly = () => {
    const map: Record<string, string[]> = {};
    (modules || []).forEach((m) => {
      if ((m.actions || []).includes('view')) {
        map[m.code] = ['view'];
      }
    });
    setPerm(map);
    Toast.info('已设为只读模式（仅保留浏览查看）');
  };

  const clearAll = () => {
    setPerm({});
    Toast.info('已清空全部权限勾选');
  };

  // 添加角色
  const handleAddRole = async () => {
    if (!roleForm.name?.trim()) {
      Toast.warning('请输入角色名称');
      return;
    }
    try {
      await postForm('/api/role/add', {
        name: roleForm.name.trim(),
        authority: roleForm.authority || 'user',
      });
      Toast.success(`角色 [${roleForm.name}] 已添加`);
      setAddModalOpen(false);
      setRoleForm({ name: '', authority: 'user' });
      loadRoles();
    } catch (e: any) {
      Toast.error('添加失败：' + (e?.message || ''));
    }
  };

  // 编辑角色名称
  const handleEditRole = async () => {
    if (!roleForm.id || !roleForm.name?.trim()) {
      Toast.warning('请输入角色名称');
      return;
    }
    try {
      await postForm('/api/role/update', {
        id: roleForm.id,
        name: roleForm.name.trim(),
        authority: roleForm.authority || 'user',
      });
      Toast.success(`角色已重命名为 [${roleForm.name}]`);
      setEditModalOpen(false);
      loadRoles(roleForm.id);
    } catch (e: any) {
      Toast.error('修改失败：' + (e?.message || ''));
    }
  };

  // 删除角色
  const handleDeleteRole = async (id: number, name: string) => {
    try {
      await del(`/api/role/delete?id=${id}`);
      Toast.success(`角色 [${name}] 已删除`);
      loadRoles(1);
    } catch (e: any) {
      Toast.error('删除失败：' + (e?.message || ''));
    }
  };

  const currentRole = roles.find((r) => r.id === current);
  const isAdmin = current === 1;

  // 权限矩阵表格列
  const permColumns = [
    {
      title: '功能模块',
      dataIndex: 'name',
      width: 170,
      render: (text: string, m: any) => (
        <div>
          <div style={{ fontWeight: 600 }}>{text}</div>
          <div className="mono text-muted" style={{ fontSize: 11 }}>{m.code}</div>
        </div>
      ),
    },
    {
      title: '模块权限配置',
      render: (_: any, m: any) => {
        const rowActions: string[] = m.actions || [];
        const checkedList = perm[m.code] || [];
        const isAll = rowActions.length > 0 && rowActions.every((a) => checkedList.includes(a));
        const isIndeterminate = !isAll && rowActions.some((a) => checkedList.includes(a));

        const toggleRowAll = (e: any) => {
          const checked = e.target.checked;
          const next = { ...perm };
          if (checked) {
            next[m.code] = [...rowActions];
          } else {
            next[m.code] = [];
          }
          setPerm(next);
        };

        return (
          <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
            <Checkbox
              checked={isAll}
              indeterminate={isIndeterminate}
              onChange={toggleRowAll}
              style={{ fontWeight: 600, marginRight: 6, minWidth: 60 }}
            >
              全选
            </Checkbox>
            <Space spacing={12} wrap>
              {rowActions.map((a) => {
                const info = ACTION_LABEL_MAP[a] || { label: a, color: 'blue', desc: '' };
                const isChecked = checkedList.includes(a);
                return (
                  <Checkbox
                    key={a}
                    checked={isChecked}
                    onChange={(e) => {
                      const cur = new Set(perm[m.code] || []);
                      if (e.target.checked) cur.add(a);
                      else cur.delete(a);
                      setPerm({ ...perm, [m.code]: [...cur] });
                    }}
                  >
                    <Tag size="small" color={isChecked ? (info.color as any) : 'grey'} style={{ marginRight: 2 }}>
                      {info.label}
                    </Tag>
                  </Checkbox>
                );
              })}
            </Space>
          </div>
        );
      },
    },
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {/* 角色切换与增删改工具栏 */}
      <Card size="small">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
          <Space spacing={8} wrap>
            <Typography.Text strong style={{ marginRight: 6 }}>系统角色：</Typography.Text>
            {roles.map((r) => {
              const active = current === r.id;
              return (
                <Button
                  key={r.id}
                  size="small"
                  theme={active ? 'solid' : 'light'}
                  type={active ? 'primary' : 'tertiary'}
                  onClick={() => openPerm(r.id)}
                >
                  {r.name}{r.id === 1 && '（管理员·全权限）'}
                </Button>
              );
            })}
          </Space>

          <Space spacing={8}>
            <Button
              icon={<IconPlus />}
              theme="solid"
              type="primary"
              size="small"
              onClick={() => { setRoleForm({ name: '', authority: 'user' }); setAddModalOpen(true); }}
            >
              新建角色
            </Button>
            {current && !isAdmin && (
              <>
                <Button
                  icon={<IconEdit />}
                  size="small"
                  onClick={() => {
                    setRoleForm({ id: currentRole.id, name: currentRole.name, authority: currentRole.authority });
                    setEditModalOpen(true);
                  }}
                >
                  重命名
                </Button>
                <Popconfirm
                  title={`确认删除角色 [${currentRole?.name}]？删除后已绑定该角色的用户将受影响。`}
                  onConfirm={() => handleDeleteRole(currentRole.id, currentRole.name)}
                >
                  <Button icon={<IconDelete />} size="small" type="danger" theme="light">
                    删除
                  </Button>
                </Popconfirm>
              </>
            )}
          </Space>
        </div>
      </Card>

      {/* 权限配置区 */}
      {isAdmin ? (
        <Banner
          type="info"
          description="系统管理员角色（admin）拥有全部模块与功能的最高操作权限，不可更改。"
          style={{ borderRadius: 6 }}
        />
      ) : currentRole ? (
        <Card
          size="small"
          title={
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span>配置角色「{currentRole.name}」的模块操作权限</span>
              <Space spacing={8}>
                <Button size="small" onClick={selectAll}>一键全选</Button>
                <Button size="small" onClick={selectReadOnly}>设为只读</Button>
                <Button size="small" onClick={clearAll}>清空勾选</Button>
                <Button
                  theme="solid"
                  type="primary"
                  size="small"
                  loading={saving}
                  disabled={!hasPerm('settings.security', 'edit')}
                  onClick={savePerm}
                >
                  保存权限
                </Button>
              </Space>
            </div>
          }
        >
          <Table
            size="small"
            dataSource={modules}
            columns={permColumns}
            pagination={false}
            rowKey="code"
          />
        </Card>
      ) : null}

      {/* 新建角色 Modal */}
      <Modal
        title="新建系统角色"
        visible={addModalOpen}
        onCancel={() => setAddModalOpen(false)}
        onOk={handleAddRole}
        width={420}
      >
        <Space vertical align="start" style={{ width: '100%', gap: 12 }}>
          <div style={{ width: '100%' }}>
            <div style={{ fontSize: 12, marginBottom: 4, color: 'var(--semi-color-text-2)' }}>角色名称</div>
            <Input
              placeholder="如：巡视值班员、运维审计员"
              value={roleForm.name}
              onChange={(v) => setRoleForm({ ...roleForm, name: v })}
            />
          </div>
          <div style={{ width: '100%' }}>
            <div style={{ fontSize: 12, marginBottom: 4, color: 'var(--semi-color-text-2)' }}>角色标识 (Authority)</div>
            <Input
              placeholder="如：viewer, operator"
              value={roleForm.authority}
              onChange={(v) => setRoleForm({ ...roleForm, authority: v })}
            />
          </div>
        </Space>
      </Modal>

      {/* 编辑/重命名角色 Modal */}
      <Modal
        title="编辑角色名称"
        visible={editModalOpen}
        onCancel={() => setEditModalOpen(false)}
        onOk={handleEditRole}
        width={420}
      >
        <Space vertical align="start" style={{ width: '100%', gap: 12 }}>
          <div style={{ width: '100%' }}>
            <div style={{ fontSize: 12, marginBottom: 4, color: 'var(--semi-color-text-2)' }}>角色名称</div>
            <Input
              placeholder="输入新的角色名称"
              value={roleForm.name}
              onChange={(v) => setRoleForm({ ...roleForm, name: v })}
            />
          </div>
        </Space>
      </Modal>
    </div>
  );
}

function AuditTab() {
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [q, setQ] = useState<any>({ username: '', module: '', result: '' });

  const load = async () => {
    setLoading(true);
    try {
      const d = await httpGet<any>('/api/patrol/audit/list', { page: 1, count: 100, ...q }).then((x) => (Array.isArray(x) ? x : x?.list ?? [])).catch(() => []);
      setRows(d || []);
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { load(); }, []);

  return (
    <>
      <Space style={{ marginBottom: 12 }}>
        <Input placeholder="用户名" value={q.username} onChange={(v) => setQ({ ...q, username: v })} style={{ width: 140 }} />
        <Select placeholder="结果" value={q.result} onChange={(v) => setQ({ ...q, result: v })} showClear style={{ width: 120 }}
          optionList={[{ value: 'SUCCESS', label: '成功' }, { value: 'FAIL', label: '失败' }, { value: 'DENIED', label: '越权(403)' }]} />
        <Button theme="solid" onClick={load}>查询</Button>
        <Button onClick={load}>刷新</Button>
      </Space>
      <Table size="small" loading={loading} dataSource={rows} pagination={{ pageSize: 20 }}
        empty="暂无审计记录"
        columns={[
          { title: '时间', dataIndex: 'createdAt', width: 165 },
          { title: '用户', dataIndex: 'username', width: 100 },
          { title: '模块', dataIndex: 'module', width: 140 },
          { title: '动作', dataIndex: 'action', width: 90 },
          { title: '方法', dataIndex: 'httpMethod', width: 70 },
          { title: 'URI', dataIndex: 'uri', ellipsis: true },
          { title: 'IP', dataIndex: 'ip', width: 120 },
          { title: '结果', dataIndex: 'result', width: 90, render: (v: string) => <Tag color={v === 'SUCCESS' ? 'green' : v === 'DENIED' ? 'red' : 'orange'}>{v === 'SUCCESS' ? '成功' : v === 'DENIED' ? '越权' : '失败'}</Tag> },
          { title: '耗时', dataIndex: 'durationMs', width: 80, render: (v: number) => `${v ?? 0}ms` },
          { title: '错误', dataIndex: 'errorMsg', ellipsis: true, render: (v: string) => v || '-' },
        ]} />
    </>
  );
}

function ApiKeysTab() {
  const [rows, setRows] = useState<any[]>([]);
  const [open, setOpen] = useState(false);
  const [userId, setUserId] = useState<number | null>(null);
  const [form, setForm] = useState<any>({ app: '', expiresAt: '' });

  const load = async () => {
    const d = await httpGet<any>('/api/userApiKey/userApiKeys', { page: 1, count: 100 }).then((x) => (Array.isArray(x) ? x : x?.list ?? [])).catch(() => []);
    setRows(d || []);
  };
  useEffect(() => {
    load();
    // add 接口必填 userId：取当前登录用户
    post('/api/user/userInfo').then((u: any) => setUserId(u?.id ?? null)).catch(() => {});
  }, []);

  return (
    <>
      <div className="text-muted" style={{ fontSize: 12, marginBottom: 10 }}>
        API Key = 供第三方程序调用本平台开放接口/推流的鉴权凭据（免登录）。日常人工操作用不到，集成对接时才需要创建。
      </div>
      <Space style={{ marginBottom: 12 }}>
        <Button icon={<IconPlus />} theme="solid" disabled={!userId} onClick={() => setOpen(true)}>添加 API Key</Button>
        <Button icon={<IconRefresh />} onClick={load} />
      </Space>
      <Table size="small" rowKey="id" dataSource={rows} pagination={false}
        columns={[
          { title: '应用(app)', dataIndex: 'app', render: (v: string) => v || '-' },
          { title: '归属用户', dataIndex: 'username' },
          { title: 'Key（脱敏）', dataIndex: 'apiKey', render: (v: string) => <span className="mono">{v ? `${v.slice(0, 6)}****${v.slice(-4)}` : '-'}</span> },
          { title: '状态', dataIndex: 'enable', render: (v: boolean) => <Tag color={v ? 'green' : 'grey'}>{v ? '启用' : '禁用'}</Tag> },
          { title: '过期时间', dataIndex: 'expiredAt', render: (v: any) => (v && Number(v) > 0 ? new Date(Number(v)).toLocaleString('zh-CN', { hour12: false }) : '永久') },
          {
            title: '操作', width: 170,
            render: (_: any, r: any) => (
              <Space>
                <Popconfirm title="确认删除该 API Key？" onConfirm={async () => { await del(`/api/userApiKey/delete?id=${r.id}`); Toast.success('已删除'); load(); }}>
                  <Button size="small" type="danger" theme="light">删除</Button>
                </Popconfirm>
              </Space>
            ),
          },
        ]} />
      <Modal title="添加 API Key" visible={open} onCancel={() => setOpen(false)}
        onOk={async () => {
          const exp = (form.expiresAt || '').trim();
          await postForm('/api/userApiKey/add', {
            userId,
            app: form.app || undefined,
            expiresAt: exp ? (exp.length === 10 ? exp + ' 00:00:00' : exp) : undefined,
            enable: true,
          });
          Toast.success('API Key 已创建');
          setOpen(false);
          setForm({ app: '', expiresAt: '' });
          load();
        }}>
        <Space vertical>
          <Input placeholder="应用名称（可选，标识用途）" value={form.app} onChange={(v) => setForm({ ...form, app: v })} style={{ width: 300 }} />
          <Input placeholder="过期时间（2030-01-01 00:00:00，留空永久）" value={form.expiresAt} onChange={(v) => setForm({ ...form, expiresAt: v })} style={{ width: 300 }} />
        </Space>
      </Modal>
    </>
  );
}
