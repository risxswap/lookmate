import { PageHeading } from '../components/PageHeading';
import { OutfitsList } from '../features/outfits/OutfitsList';
import { OutfitDetail } from '../features/outfits/OutfitDetail';
import { OutfitEditorPage } from '../features/outfits/OutfitEditor';
import { Button, Card, Result, Skeleton, Typography } from 'antd';
import type { Account } from '../api/client';
import { useWorkspace } from '../features/workspace/queries';
import { NoTasks, QueryFailure, TaskCard } from '../features/workspace/TaskViews';
import { WardrobePage } from '../features/wardrobe/WardrobePage';
import { DesignsPage } from '../features/designs/DesignsPage';
import { ProfilePage } from '../features/profile/ProfilePage';
import { NewDesignPage } from '../features/generation/NewDesignPage';
import { DesignDetailPage } from '../features/workspace/DesignDetailPage';

const { Text } = Typography;


export function Dashboard({ account }: { account: Account }) {
  const query = useWorkspace(account.id);
  return <div className="dashboard">
    <OutfitsList accountId={account.id} dashboard />
    {query.isError ? <QueryFailure error={query.error} stale={!!query.data} loading={query.isFetching} retry={() => void query.refetch()} /> : null}
    <div className="dashboard-columns">
      <Card title="进行中的任务">{query.isPending ? <Skeleton active paragraph={{ rows: 3 }} /> : query.data ? query.data.activeTask ? <TaskCard accountId={account.id} task={query.data.activeTask} /> : <NoTasks /> : <Text type="secondary">任务数据读取失败，请重试。</Text>}</Card>
      <Card title="为下一次设计做准备" className="preparation-card">
        <a className="resource-link" href="/app/profile?tab=basic#profile-photos"><span className="resource-symbol" aria-hidden>01</span><div><strong>我的照片</strong><span>管理用于形象设计的本人照片</span></div><span aria-hidden>↗</span></a>
        <a className="resource-link" href="/app/profile?tab=measurements"><span className="resource-symbol" aria-hidden>02</span><div><strong>身体尺寸</strong><span>为穿搭提供更合适的参考</span></div><span aria-hidden>↗</span></a>
        <a className="resource-link" href="/app/wardrobe"><span className="resource-symbol" aria-hidden>03</span><div><strong>我的衣橱</strong><span>让已有单品参与新的搭配</span></div><span aria-hidden>↗</span></a>
      </Card>
    </div>
    <Card title="最近的设计记录" extra={<Text type="secondary">最近 6 条已结束或待确认的任务</Text>}>{query.isPending ? <Skeleton active paragraph={{ rows: 3 }} /> : query.data ? query.data.recentTasks.length ? <div className="recent-task-grid">{query.data.recentTasks.map(task => <TaskCard accountId={account.id} key={task.id} task={task} />)}</div> : <Text type="secondary">还没有设计记录，开始一次设计后会显示在这里。</Text> : <Text type="secondary">设计记录读取失败，请重试。</Text>}</Card>
  </div>;
}

export function WorkspaceContent({ path, account }: { path: string; account: Account }) {
  if (path === '/app/wardrobe/outfits/new') return <OutfitEditorPage key="new" accountId={account.id} />;
  const outfitMatch = /^\/app\/wardrobe\/outfits\/([^/]+)(\/edit)?$/.exec(path);
  if (outfitMatch) return outfitMatch[2] ? <OutfitEditorPage key={outfitMatch[1]} accountId={account.id} id={outfitMatch[1]} /> : <OutfitDetail key={outfitMatch[1]} accountId={account.id} id={outfitMatch[1]} />;
  const detailMatch = /^\/app\/designs\/([^/]+)$/.exec(path);
  if (detailMatch) return <DesignDetailPage key={detailMatch[1]} accountId={account.id} id={detailMatch[1]} />;
  switch (path) {
    case '/app': return <Dashboard account={account} />;
    case '/app/designs': return <DesignsPage accountId={account.id} />;
    case '/app/wardrobe': return <WardrobePage accountId={account.id} />;
    case '/app/profile': return <ProfilePage key={account.id} account={account} />;
    case '/app/design/new': return <NewDesignPage accountId={account.id} />;
    default: return <><PageHeading title="页面未找到" /><Result status="404" title="页面未找到" subTitle="这个页面不存在，或入口已经变更。" extra={<Button type="primary" href="/app">返回工作台</Button>} /></>;
  }
}
