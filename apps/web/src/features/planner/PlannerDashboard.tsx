import { useRef, useState } from 'react';
import { Alert, Button, Calendar, Empty, Modal, Pagination, Skeleton, Space, Tag } from 'antd';
import dayjs from 'dayjs';
import 'dayjs/locale/zh-cn';
import { ApiError, request } from '../../api/client';
import { RecordActions } from '../designs/RecordActions';
import { usePageBounds } from '../designs/queries';
import { OutfitBoard } from '../outfits/OutfitsList';
import { PrivateImage } from '../wardrobe/PrivateImage';
import type { Outfit } from '../outfits/api';
import { LocalTime, StatusTag, designTypeName } from '../workspace/TaskViews';
import { useWorkspace, type TaskSummary } from '../workspace/queries';
import { PlanEditor } from './PlanEditor';
import { SceneOutfits } from './SceneOutfits';
import { errorMessage, readPlanRecovery, unknownWrite, usePlanCalendar, usePlans, useRefreshPlanner, type CreatePlan, type OutfitPlan } from './api';
import './planner.css';

dayjs.locale('zh-cn');
function CompactTask({ accountId, task }: { accountId: string; task: TaskSummary }) {
  return <div className="planner-task-row"><div className="planner-task-copy">{task.actions.includes('VIEW') ? <a href={`/app/designs/${task.id}`}>{task.title || `${designTypeName(task.designType)}任务`}</a> : <strong>{task.title || '设计任务'}</strong>}<span><LocalTime value={task.createdAt} /></span></div><StatusTag status={task.status} /><RecordActions accountId={accountId} task={task} /></div>;
}
function RemovePlan({ accountId, plan, onClose }: { accountId: string; plan: OutfitPlan; onClose: () => void }) {
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [blocked, setBlocked] = useState(false);
  const lock = useRef(false); const refresh = useRefreshPlanner(accountId);
  async function remove() {
    if (lock.current || blocked) return;
    lock.current = true; setBusy(true); setError('');
    try { await request(`/outfit-plans/${plan.id}?version=${encodeURIComponent(plan.version)}`, { method: 'DELETE' }); await refresh(); onClose(); }
    catch (failure) { setError(errorMessage(failure)); if (unknownWrite(failure) || failure instanceof ApiError && ['VERSION_CONFLICT', 'OUTFIT_PLAN_NOT_FOUND'].includes(failure.detail.code)) setBlocked(true); }
    finally { lock.current = false; setBusy(false); }
  }
  return <Modal open title="移除这条穿搭安排？" onCancel={onClose} onOk={() => void remove()} okText="移除安排" cancelText="取消" confirmLoading={busy} okButtonProps={{ danger: true, disabled: blocked }} cancelButtonProps={{ disabled: busy }} closable={!busy} keyboard={!busy} maskClosable={false}><p>{plan.date} · {plan.scene}。只移除此日历安排，常用搭配仍然保留。</p>{error && <Alert showIcon type="error" title={error} />}{blocked && <Alert type="warning" title="记录可能变化或操作结果未知，请先刷新核对" action={<Button onClick={() => { void refresh(); onClose(); }}>关闭并刷新</Button>} />}</Modal>;
}

export function PlannerDashboard({ accountId }: { accountId: string }) {
  const [selected, setSelected] = useState(() => dayjs());
  const [page, setPage] = useState(1);
  const [monthOpen, setMonthOpen] = useState(false);
  const [month, setMonth] = useState(() => dayjs());
  const [editor, setEditor] = useState<{ key: string; plan?: OutfitPlan; outfit?: Outfit; recovery?: CreatePlan }>();
  const [removing, setRemoving] = useState<OutfitPlan>();
  const [viewing, setViewing] = useState<OutfitPlan>();
  const [recovery, setRecovery] = useState(() => readPlanRecovery(accountId));
  const monday = selected.subtract((selected.day() + 6) % 7, 'day');
  const monthStart = month.startOf('month').subtract((month.startOf('month').day() + 6) % 7, 'day');
  const week = usePlanCalendar(accountId, monday.format('YYYY-MM-DD'), monday.add(6, 'day').format('YYYY-MM-DD'));
  const monthCounts = usePlanCalendar(accountId, monthStart.format('YYYY-MM-DD'), monthStart.add(41, 'day').format('YYYY-MM-DD'));
  const plans = usePlans(accountId, selected.format('YYYY-MM-DD'), page);
  const tasks = useWorkspace(accountId);
  usePageBounds(plans.data?.total, 5, plans.isSuccess && !plans.isFetching, setPage);
  const dates = Array.from({ length: 7 }, (_, i) => monday.add(i, 'day'));
  const chooseDate = (value: dayjs.Dayjs) => { setSelected(value); setPage(1); };
  const openNew = (outfit?: Outfit) => {
    const pending = readPlanRecovery(accountId);
    setRecovery(pending);
    setEditor({ key: crypto.randomUUID(), outfit: pending ? undefined : outfit, recovery: pending || undefined });
  };
  const closeEditor = () => { setEditor(undefined); setRecovery(readPlanRecovery(accountId)); };
  return <div className="planner-dashboard">
    <header className="section-heading planner-heading"><h1>工作台</h1></header>
    {recovery && <Alert showIcon type="warning" title="有一条保存结果待确认的穿搭安排" action={<Button onClick={() => openNew()}>找回安排</Button>} />}
    <div className="planner-top-grid">
      <section className="planner-calendar"><header className="planner-section-heading"><h2>穿搭日历</h2><Space><Button size="small" onClick={() => chooseDate(dayjs())}>今天</Button><Button size="small" onClick={() => { setMonth(selected); setMonthOpen(true); }}>月历</Button></Space></header>
        <div className="planner-week-heading"><h3>{monday.format('YYYY 年 M 月')}<span>{monday.format('M.D')} — {monday.add(6, 'day').format('M.D')}</span></h3><Space size={4}><Button aria-label="上一周" onClick={() => chooseDate(selected.subtract(7, 'day'))}>‹</Button><Button aria-label="下一周" onClick={() => chooseDate(selected.add(7, 'day'))}>›</Button></Space></div>
        {week.isError && <Alert type="warning" title="日历安排数量读取失败" action={<Button onClick={() => void week.refetch()}>重试</Button>} />}
        <div className="planner-week" aria-label="本周日期">{dates.map(date => { const key = date.format('YYYY-MM-DD'); const count = week.data?.days.find(day => day.date === key)?.count || 0; return <button key={key} aria-pressed={date.isSame(selected, 'day')} aria-label={`${date.format('M月D日')}${week.isSuccess ? `，${count}条安排` : ''}`} className={`planner-day ${date.isSame(selected, 'day') ? 'selected' : ''}`} onClick={() => chooseDate(date)}><span>{date.format('ddd')}{date.isSame(dayjs(), 'day') && <i>今天</i>}</span><strong>{date.date()}</strong><small>{week.isPending ? '读取中' : week.isError ? '数量未知' : count ? `${count} 条安排` : '未安排'}</small></button>; })}</div>
        <div className="planner-day-heading"><div><h3>{selected.format('M 月 D 日')}<span>{selected.format('dddd')}</span></h3>{plans.data && <p>{plans.data.total} 条安排 · 可按场景安排多套</p>}</div><Button onClick={() => openNew()}>＋ 添加安排</Button></div>
        {plans.isError && <Alert showIcon type="error" title={plans.data ? '刷新失败，以下为上次读取的安排' : '无法读取这一天的安排'} description={plans.error.message} action={<Button onClick={() => void plans.refetch()}>重试</Button>} />}
        {plans.isPending ? <Skeleton active paragraph={{ rows: 5 }} /> : plans.data && <>
          {plans.data.items.length ? <div className="planner-plan-list">{plans.data.items.map(plan => <article className="planner-plan" key={plan.id}><div className="planner-plan-image">{plan.outfit ? <OutfitBoard accountId={accountId} outfit={plan.outfit} /> : <span>待选搭配</span>}</div><div className="planner-plan-copy"><div className="planner-plan-meta"><Tag>{plan.scene}</Tag><span>{plan.note}</span></div><h4><button className="planner-plan-title" onClick={() => setViewing(plan)} aria-label={`查看安排 ${plan.outfit?.name || plan.scene}`}>{plan.outfit?.name || '先记下场景，稍后选衣'}</button></h4>{plan.outfit?.note && <p>{plan.outfit.note}</p>}{plan.sourceMissing && <Tag color="orange">原搭配已删除，保留安排时的内容</Tag>}{plan.outfit?.items.some(item => item.missing) && <Tag color="orange">有缺失单品</Tag>}<Space wrap><Button size="small" type="link" onClick={() => setEditor({ key: crypto.randomUUID(), plan })}>{plan.outfit ? '调整安排' : '选择搭配'}</Button><Button size="small" type="text" onClick={() => setRemoving(plan)}>移除</Button>{!plan.outfit && <Button size="small" type="link" href={`/app/design/new?occasion=${encodeURIComponent(plan.scene)}&type=OUTFIT`}>为此场景设计</Button>}</Space></div></article>)}</div> : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="把常用搭配安排到这一天"><Button onClick={() => openNew()}>安排第一套</Button></Empty>}
          {plans.data.total > 5 && <Pagination className="planner-pagination" current={page} pageSize={5} total={plans.data.total} showSizeChanger={false} onChange={setPage} />}
        </>}
        <footer className="planner-calendar-foot">保留安排时的组合与穿法，修改常用搭配不会自动改变计划。</footer>
      </section>
      <aside className="planner-sidebar"><Button className="planner-start-design" type="primary" size="large" block href="/app/design/new">＋ 开始形象设计</Button><div className="planner-activity"><section><header className="planner-section-heading"><h2>进行中的任务</h2></header>{tasks.isError && <Alert type="error" title="任务读取失败" action={<Button size="small" onClick={() => void tasks.refetch()}>重试</Button>} />}{tasks.isPending ? <Skeleton active paragraph={{ rows: 1 }} /> : tasks.data ? tasks.data.activeTask ? <CompactTask accountId={accountId} task={tasks.data.activeTask} /> : <p className="planner-hint">暂无进行中的任务</p> : null}</section>
        <section className="planner-recent"><header className="planner-section-heading"><h2>最近设计</h2><a href="/app/designs">查看全部</a></header>{tasks.isPending ? <Skeleton active paragraph={{ rows: 4 }} /> : tasks.data ? tasks.data.recentTasks.length ? tasks.data.recentTasks.map(task => <CompactTask key={task.id} accountId={accountId} task={task} />) : <p className="planner-hint">还没有设计记录</p> : <p className="planner-hint">记录暂时无法读取</p>}</section>
        </div>
        <section className="planner-quick" aria-labelledby="planner-quick-title"><h2 id="planner-quick-title">准备下一次设计</h2><div className="planner-quick-links"><a href="/app/profile?tab=basic#profile-photos">我的照片</a><a href="/app/profile?tab=measurements">身体尺寸</a><a href="/app/wardrobe">我的衣橱</a></div></section>
      </aside>
    </div>
    <SceneOutfits accountId={accountId} onArrange={openNew} />
    <Modal open={monthOpen} title="选择日期" footer={null} onCancel={() => setMonthOpen(false)} width={660}><Calendar fullscreen={false} value={month} onPanelChange={value => setMonth(value)} onSelect={(value, info) => { setMonth(value); if (info.source === 'date') { chooseDate(value); setMonthOpen(false); } }} cellRender={(date, info) => info.type === 'date' && monthCounts.data?.days.some(day => day.date === date.format('YYYY-MM-DD')) ? <span className="planner-month-dot" aria-label="有穿搭安排" /> : null} />{monthCounts.isError && <Alert type="warning" title="月历安排数量读取失败，仍可选择日期" action={<Button onClick={() => void monthCounts.refetch()}>重试</Button>} />}<p className="planner-hint">圆点表示当天有穿搭安排。</p></Modal>
    {editor && <PlanEditor key={editor.key} accountId={accountId} date={selected.format('YYYY-MM-DD')} plan={editor.plan} initialOutfit={editor.outfit} recovery={editor.recovery} onClose={closeEditor} onSaved={date => { chooseDate(dayjs(date)); closeEditor(); }} />}
    {viewing && <Modal open title="穿搭安排" width={720} onCancel={() => setViewing(undefined)} footer={<Button onClick={() => setViewing(undefined)}>关闭</Button>}>
      <div className="planner-snapshot"><p>{viewing.date} · {viewing.scene}</p>{viewing.note && <p className="planner-full-note">{viewing.note}</p>}
        {viewing.sourceMissing && <Alert type="warning" title="原搭配已删除，以下为安排时保留的内容" />}
        {viewing.outfit ? <><h3>{viewing.outfit.name}</h3><h4>安排时的穿法</h4><p className="planner-full-note">{viewing.outfit.note || '未填写穿法'}</p><h4>安排时的单品</h4><div className="planner-snapshot-items">{viewing.outfit.items.map(item => <article key={item.dressId}>{item.imageFileIds[0] && <PrivateImage accountId={accountId} fileId={item.imageFileIds[0]} thumbnail compact alt={item.dressName} />}<strong>{item.dressName}</strong><span>{item.categoryName}</span>{item.missing && <Tag color="orange">原单品已删除</Tag>}</article>)}</div></> : <p>尚未选择搭配，可以在调整安排中补充。</p>}
      </div>
    </Modal>}
    {removing && <RemovePlan key={removing.id} accountId={accountId} plan={removing} onClose={() => setRemoving(undefined)} />}
  </div>;
}
