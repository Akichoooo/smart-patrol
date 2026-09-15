import { SideSheet, List, Button, Tag, Empty } from '@douyinfe/semi-ui';
import { useNotifyStore } from '@/store/notify';

/** 通知抽屉（顶部栏铃铛触发） */
export default function NotificationPanel() {
  const { panelOpen, setPanelOpen, notices, markRead, markAllRead, refresh } = useNotifyStore();

  return (
    <SideSheet
      title="通知中心"
      visible={panelOpen}
      onCancel={() => setPanelOpen(false)}
      placement="right"
      width={380}
      footer={
        <div style={{ display: 'flex', gap: 8 }}>
          <Button theme="solid" type="primary" size="small" onClick={markAllRead}>
            全部已读
          </Button>
          <Button size="small" onClick={refresh}>
            刷新
          </Button>
        </div>
      }
    >
      {notices.length === 0 ? (
        <Empty description="暂无通知" style={{ marginTop: 60 }} />
      ) : (
        <List>
          {notices.map((n) => (
            <List.Item
              key={n.id}
              style={{ cursor: 'pointer', background: n.isRead ? 'transparent' : 'var(--semi-color-primary-light-default)' }}
              onClick={() => !n.isRead && markRead(n.id)}
              header={
                <Tag size="small" color={n.type === 'ALARM' ? 'red' : n.type === 'TASK' ? 'blue' : 'grey'}>
                  {n.type === 'ALARM' ? '告警' : n.type === 'TASK' ? '任务' : '系统'}
                </Tag>
              }
              main={
                <div>
                  <div style={{ fontWeight: 600, fontSize: 13 }}>{n.title}</div>
                  <div className="text-muted" style={{ fontSize: 12, marginTop: 2 }}>{n.content}</div>
                  <div className="text-muted" style={{ fontSize: 11, marginTop: 4 }}>{n.createTime}</div>
                </div>
              }
            />
          ))}
        </List>
      )}
    </SideSheet>
  );
}
