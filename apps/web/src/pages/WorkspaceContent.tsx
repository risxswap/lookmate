import { PageHeading } from '../components/PageHeading';
import { PlannerDashboard } from '../features/planner/PlannerDashboard';
import { OutfitDetail } from '../features/outfits/OutfitDetail';
import { OutfitEditorPage } from '../features/outfits/OutfitEditor';
import { Button, Result } from 'antd';
import type { Account } from '../api/client';
import { WardrobePage } from '../features/wardrobe/WardrobePage';
import { DesignsPage } from '../features/designs/DesignsPage';
import { ProfilePage } from '../features/profile/ProfilePage';
import { NewDesignPage } from '../features/generation/NewDesignPage';
import { DesignDetailPage } from '../features/workspace/DesignDetailPage';

export function Dashboard({ account }: { account: Account }) {
  return <PlannerDashboard key={account.id} accountId={account.id} />;
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
