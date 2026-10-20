import { useState, type ReactNode } from 'react';
import { Alert, Button, Card, Descriptions, Empty, Form, Input, Radio, Result, Skeleton, Tabs, Tag, Typography } from 'antd';
import type { Account } from '../api/client';
import { useWorkspace } from '../features/workspace/queries';
import { NoTasks, QueryFailure, TaskCard } from '../features/workspace/TaskViews';
import { WardrobePage } from '../features/wardrobe/WardrobePage';
import { DesignsPage } from '../features/designs/DesignsPage';
import { DesignDetailPage } from '../features/workspace/DesignDetailPage';

const { Title, Paragraph, Text } = Typography;
const modeOptions = ['整体设计', '只改发型', '只改穿搭'];

export function SectionHeading({ title, description, action }: { title: string; description: string; action?: ReactNode }) {
  return <div className="section-heading"><div><Title level={2}>{title}</Title><Paragraph type="secondary">{description}</Paragraph></div>{action}</div>;
}
function Unavailable({ children }: { children: ReactNode }) {
  return <Alert className="feature-notice" type="info" showIcon title={children} />;
}
function Blank({ title, description, children }: { title: string; description: string; children?: ReactNode }) {
  return <div className="blank-state"><Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={<><strong>{title}</strong><p>{description}</p></>}>{children}</Empty></div>;
}
function usePageTab(allowed: string[], fallback: string) {
  const value = new URLSearchParams(window.location.search).get('tab');
  const [tab, setTab] = useState(value && allowed.includes(value) ? value : fallback);
  const change = (next: string) => {
    setTab(next);
    const url = new URL(window.location.href);
    url.searchParams.set('tab', next);
    window.history.replaceState(null, '', url);
  };
  return [tab, change] as const;
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

export function ProfilePage({ account }: { account: Account }) {
  const [tab, setTab] = usePageTab(['basic', 'photos', 'measurements'], 'basic');
  return <><SectionHeading title="从了解自己开始" description="你的资料、照片与尺寸，为个人形象设计提供参考。" /><Card><Tabs activeKey={tab} onChange={setTab} items={[{ key: 'basic', label: '基础资料' }, { key: 'photos', label: '我的照片' }, { key: 'measurements', label: '身体尺寸' }]} />{tab === 'basic' ? <div className="profile-basic"><div className="profile-identity"><span className="profile-avatar">{(account.displayName || account.username).slice(0, 1)}</span><div><Title level={4}>{account.displayName || account.username}</Title><Text type="secondary">你的个人形象档案</Text></div></div><Descriptions column={1} items={[{ key: 'username', label: '用户名', children: account.username }, { key: 'name', label: '显示名称', children: account.displayName || '尚未设置' }]} /><Unavailable>当前展示已登录账号信息，资料修改功能暂未开放。</Unavailable><Button disabled>编辑资料</Button></div> : tab === 'photos' ? <><Unavailable>照片服务尚未接入，当前无法上传或选择本人照片。</Unavailable><Blank title="准备一张清晰的本人照片" description="照片功能开放后，可在这里管理设计使用的照片。"><Button disabled type="primary">上传照片</Button></Blank></> : <><Unavailable>身体尺寸尚未接入，当前无法读取或保存尺寸数据。</Unavailable><div className="measurement-preview"><Title level={4}>为合适的穿搭提供参考</Title><Paragraph type="secondary">尺寸功能开放后，可补充身高、体重及身体围度，用于穿搭设计参考。</Paragraph><div className="measurement-fields">{['身高', '体重', '胸围', '腰围', '臀围'].map(label => <div key={label}><Text type="secondary">{label}</Text><p>尚未接入</p></div>)}</div><Button disabled>编辑身体尺寸</Button></div></>}</Card></>;
}

export function NewDesignPage() {
  const [mode, setMode] = useState('整体设计');
  const [requirements, setRequirements] = useState('');
  const includesOutfit = mode !== '只改发型';
  return <><SectionHeading title="这一次，想尝试什么风格？" description="选择设计方式，告诉我们你的想法。" action={<Button href="/app/designs">返回设计记录</Button>} /><div className="design-layout"><div className="design-form-column"><Card title={<><span className="step-number">01</span> 选择设计模式</>}><Radio.Group className="mode-options" value={mode} onChange={event => setMode(event.target.value)} optionType="button" buttonStyle="solid" options={modeOptions} /><Paragraph className="mode-description" type="secondary">{mode === '整体设计' ? '结合发型与穿搭，探索协调的整体形象。' : mode === '只改发型' ? '专注发型的变化，表达你对长度、轮廓与风格的期待。' : '专注服装与配饰，为日常或特定场合寻找搭配。'}</Paragraph></Card><Card title={<><span className="step-number">02</span> 选择本人照片</>}><div className="photo-placeholder"><span className="photo-outline" aria-hidden>＋</span><div><Text strong>照片选择暂未开放</Text><Paragraph type="secondary">照片服务接入后，可从个人照片中选择。</Paragraph><Button href="/app/profile?tab=photos">前往我的照片</Button></div></div></Card><Card title={<><span className="step-number">03</span> 告诉我们你的想法</>}><Form layout="vertical"><Form.Item label="设计要求" htmlFor="design-requirements" extra="切换设计模式会保留这里的输入；离开页面后不保存。"><Input.TextArea id="design-requirements" value={requirements} onChange={event => setRequirements(event.target.value)} rows={5} maxLength={2000} showCount placeholder="例如：适合日常通勤，希望整体自然简洁，也想尝试一些新的变化……" /></Form.Item></Form>{includesOutfit ? <div className="outfit-options"><div><Text strong>身体尺寸 <Tag>可选</Tag></Text><Paragraph type="secondary">尺寸服务尚未接入，可先查看资料页面。</Paragraph><Button href="/app/profile?tab=measurements">查看身体尺寸</Button></div><div><Text strong>必穿单品 <Tag>可选</Tag></Text><Paragraph type="secondary">可在衣橱整理单品，设计提交时的单品选择尚未开放。</Paragraph><Button href="/app/wardrobe">前往我的衣橱</Button></div></div> : null}</Card></div><aside><Card className="design-summary" title="本次设计"><Tag color="green">{mode}</Tag><Title level={4}>{mode === '整体设计' ? '从发型到穿搭，完整呈现' : mode === '只改发型' ? '发现适合你的新发型' : '发现单品之间的新组合'}</Title><Paragraph type="secondary">{mode === '整体设计' ? '整体效果图、发型说明、穿搭清单与搭配理由将在结果中呈现。' : mode === '只改发型' ? '结果将呈现发型效果与对应设计说明。' : '结果将呈现穿搭效果、单品清单与搭配理由。'}</Paragraph><div className="summary-check"><span>本人照片</span><Text type="secondary">暂不可选</Text></div><div className="summary-check"><span>设计要求</span><Text type="secondary">{requirements.trim() ? '已填写' : '未填写'}</Text></div><Alert type="info" showIcon title="生成功能尚未开放" description="照片与设计服务接入后才能提交。当前输入仅用于本页预览，不会创建任务。" /><Button className="generate-button" type="primary" size="large" block disabled>生成形象设计</Button></Card></aside></div></>;
}

export function WorkspaceContent({ path, account }: { path: string; account: Account }) {
  const detailMatch = /^\/app\/designs\/([^/]+)$/.exec(path);
  if (detailMatch) return <DesignDetailPage key={detailMatch[1]} accountId={account.id} id={detailMatch[1]} />;
  switch (path) {
    case '/app': return <Dashboard account={account} />;
    case '/app/designs': return <DesignsPage accountId={account.id} />;
    case '/app/wardrobe': return <WardrobePage accountId={account.id} />;
    case '/app/profile': return <ProfilePage account={account} />;
    case '/app/design/new': return <NewDesignPage />;
    default: return <Result status="404" title="页面未找到" subTitle="这个页面不存在，或入口已经变更。" extra={<Button type="primary" href="/app">返回工作台</Button>} />;
  }
}
