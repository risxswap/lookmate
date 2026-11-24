import { lazy } from 'react';
import { Button, Result } from 'antd';
import type { Account } from '../api/client';
import { PageHeading } from '../components/PageHeading';

const PlannerDashboard = lazy(() => import('../features/planner/PlannerDashboard').then(m => ({ default: m.PlannerDashboard })));
const WardrobePage = lazy(() => import('../features/wardrobe/WardrobePage').then(m => ({ default: m.WardrobePage })));
const OutfitDetail = lazy(() => import('../features/outfits/OutfitDetail').then(m => ({ default: m.OutfitDetail })));
const OutfitEditorPage = lazy(() => import('../features/outfits/OutfitEditor').then(m => ({ default: m.OutfitEditorPage })));
const DesignsPage = lazy(() => import('../features/designs/DesignsPage').then(m => ({ default: m.DesignsPage })));
const DesignDetailPage = lazy(() => import('../features/workspace/DesignDetailPage').then(m => ({ default: m.DesignDetailPage })));
const NewDesignPage = lazy(() => import('../features/generation/NewDesignPage').then(m => ({ default: m.NewDesignPage })));
const ProfilePage = lazy(() => import('../features/profile/ProfilePage').then(m => ({ default: m.ProfilePage })));
const HairstyleGalleryPage = lazy(() => import('../features/hairstyles/HairstylePages').then(m => ({ default: m.HairstyleGalleryPage })));
const HairstyleRecordsPage = lazy(() => import('../features/hairstyles/HairstylePages').then(m => ({ default: m.HairstyleRecordsPage })));
const OutfitGalleryPage = lazy(() => import('../features/outfitInspirations/OutfitPages').then(m => ({ default: m.OutfitGalleryPage })));
const OutfitRecordsPage = lazy(() => import('../features/outfitInspirations/OutfitPages').then(m => ({ default: m.OutfitRecordsPage })));

export function WorkspaceContent({ path, account }: { path: string; account: Account }) {
  if (path === '/app/wardrobe/outfits/new') return <OutfitEditorPage key="new" accountId={account.id} />;
  const outfitMatch = /^\/app\/wardrobe\/outfits\/([^/]+)(\/edit)?$/.exec(path);
  if (outfitMatch) return outfitMatch[2] ? <OutfitEditorPage key={outfitMatch[1]} accountId={account.id} id={outfitMatch[1]} /> : <OutfitDetail key={outfitMatch[1]} accountId={account.id} id={outfitMatch[1]} />;
  const detailMatch = /^\/app\/designs\/([^/]+)$/.exec(path);
  if (detailMatch) return <DesignDetailPage key={detailMatch[1]} accountId={account.id} id={detailMatch[1]} />;
  switch (path) {
    case '/app': return <PlannerDashboard key={account.id} accountId={account.id} />;
    case '/app/designs': return <DesignsPage accountId={account.id} />;
    case '/app/wardrobe': return <WardrobePage accountId={account.id} />;
    case '/app/profile': return <ProfilePage key={account.id} account={account} />;
    case '/app/hairstyles': return <HairstyleGalleryPage accountId={account.id} />;
    case '/app/hairstyles/records': return <HairstyleRecordsPage accountId={account.id} />;
    case '/app/hairstyles/try': return <NewDesignPage accountId={account.id} hair />;
    case '/app/outfit-design': return <OutfitGalleryPage accountId={account.id} />;
    case '/app/outfit-design/records': return <OutfitRecordsPage accountId={account.id} />;
    case '/app/outfit-design/try': return <NewDesignPage accountId={account.id} outfitOnly />;
    case '/app/design/new': return <NewDesignPage accountId={account.id} />;
    default: return <><PageHeading title="页面未找到" /><Result status="404" title="页面未找到" subTitle="这个页面不存在，或入口已经变更。" extra={<Button type="primary" href="/app">返回工作台</Button>} /></>;
  }
}
