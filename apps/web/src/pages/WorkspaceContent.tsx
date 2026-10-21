import { type ReactNode } from 'react';
import { Button, Card, Result, Skeleton, Typography } from 'antd';
import type { Account } from '../api/client';
import { useWorkspace } from '../features/workspace/queries';
import { NoTasks, QueryFailure, TaskCard } from '../features/workspace/TaskViews';
import { WardrobePage } from '../features/wardrobe/WardrobePage';
import { DesignsPage } from '../features/designs/DesignsPage';
import { ProfilePage } from '../features/profile/ProfilePage';
import { NewDesignPage } from '../features/generation/NewDesignPage';
import { DesignDetailPage } from '../features/workspace/DesignDetailPage';

const { Title, Paragraph, Text } = Typography;


export function SectionHeading({ title, description, action }: { title: string; description: string; action?: ReactNode }) {
  return <div className="section-heading"><div><Title level={2}>{title}</Title><Paragraph type="secondary">{description}</Paragraph></div>{action}</div>;
}
export function Dashboard({ account }: { account: Account }) {
  const query = useWorkspace(account.id);
  return <>
    <section className="design-hero"><div className="hero-copy"><p className="eyebrow">你的风格，由你开始</p><Title>你好，{account.displayName || account.username}</Title><Paragraph>从熟悉的自己出发，探索新的可能。<br />把发型与穿搭放在一起，找到适合你的整体形象。</Paragraph><Button type="primary" size="large" href="/app/design/new">开始形象设计 <span aria-hidden>↗</span></Button><Text className="hero-note">整体设计 · 只改发型 · 只改穿搭</Text></div><div className="hero-art" aria-hidden="true"><div className="art-orbit" /><div className="art-card art-card-back"><span>LOOK</span><i /></div><div className="art-card art-card-front"><span>YOUR NEXT</span><b>look.</b><div className="art-swatches"><i /><i /><i /></div><small>让风格，更像自己</small></div></div></section>
    {query.isError ? <QueryFailure error={query.error} stale={!!query.data} loading={query.isFetching} retry={() => void query.refetch()} /> : null}
    <div className="dashboard-columns"><Card title="进行中的任务" extra={<Button size="small" loading={query.isFetching} onClick={() => void query.refetch()}>刷新</Button>}>{query.isPending ? <Skeleton active paragraph={{ rows: 3 }} /> : query.data ? query.data.activeTask ? <TaskCard accountId={account.id} task={query.data.activeTask} /> : <NoTasks /> : <Text type="secondary">任务数据读取失败，请重试。</Text>}</Card><Card title="为下一次设计做准备" className="preparation-card"><a className="resource-link" href="/app/profile?tab=photos"><span className="resource-symbol" aria-hidden>01</span><div><strong>我的照片</strong><span>管理用于形象设计的本人照片</span></div><span aria-hidden>↗</span></a><a className="resource-link" href="/app/profile?tab=measurements"><span className="resource-symbol" aria-hidden>02</span><div><strong>身体尺寸</strong><span>为穿搭提供更合适的参考</span></div><span aria-hidden>↗</span></a><a className="resource-link" href="/app/wardrobe"><span className="resource-symbol" aria-hidden>03</span><div><strong>我的衣橱</strong><span>让已有单品参与新的搭配</span></div><span aria-hidden>↗</span></a></Card></div>
    <Card title="最近的设计记录" extra={<Text type="secondary">最近 6 条已结束或待确认的任务</Text>}>{query.isPending ? <Skeleton active paragraph={{ rows: 3 }} /> : query.data ? query.data.recentTasks.length ? <div className="recent-task-grid">{query.data.recentTasks.map(task => <TaskCard accountId={account.id} key={task.id} task={task} />)}</div> : <NoTasks recent /> : <Text type="secondary">设计记录读取失败，请重试。</Text>}</Card>
  </>;
}

export function WorkspaceContent({ path, account }: { path: string; account: Account }) {
  const detailMatch = /^\/app\/designs\/([^/]+)$/.exec(path);
  if (detailMatch) return <DesignDetailPage key={detailMatch[1]} accountId={account.id} id={detailMatch[1]} />;
  switch (path) {
    case '/app': return <Dashboard account={account} />;
    case '/app/designs': return <DesignsPage accountId={account.id} />;
    case '/app/wardrobe': return <WardrobePage accountId={account.id} />;
    case '/app/profile': return <ProfilePage key={account.id} account={account} />;
    case '/app/design/new': return <NewDesignPage accountId={account.id} />;
    default: return <Result status="404" title="页面未找到" subTitle="这个页面不存在，或入口已经变更。" extra={<Button type="primary" href="/app">返回工作台</Button>} />;
  }
}
