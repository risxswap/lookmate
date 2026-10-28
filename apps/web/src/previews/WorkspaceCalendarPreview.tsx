import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Button, Calendar, ConfigProvider, DatePicker, Empty, Input, Modal, Select, Space, Tag, message } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import dayjs, { type Dayjs } from 'dayjs';
import 'dayjs/locale/zh-cn';
import './workspace-calendar-preview.css';
dayjs.locale('zh-cn');

type Look = { id: number; name: string; scenes: string[]; colors: [string, string]; note: string; pieces: string };
type Plan = { id: string; date: string; scene: string; look?: Look; note: string };
const today = dayjs('2026-10-28');
const presets = ['通勤', '日常', '约会', '运动', '聚会', '旅行'];
const looks: Look[] = [
  { id: 1, name: '轻松一点去上班', scenes: ['通勤', '日常'], colors: ['#e9e0cc', '#5c6560'], note: '衬衫塞前摆，袖口卷一折，搭配黑色乐福鞋。', pieces: '米白衬衫 · 炭灰长裤 · 乐福鞋' },
  { id: 2, name: '城市里的蓝与白', scenes: ['日常', '旅行'], colors: ['#f6f2e7', '#7a92a3'], note: '上衣自然放下，搭一双白色运动鞋。', pieces: '白色上衣 · 直筒牛仔裤 · 运动鞋' },
  { id: 3, name: '晚餐时，温柔一点', scenes: ['约会', '聚会'], colors: ['#b69b88', '#e0d1bb'], note: '针织上衣配米色长裤，搭配小号手提包。', pieces: '棕色针织衫 · 米色长裤 · 手提包' },
  { id: 4, name: '周末去散步', scenes: ['运动', '日常', '旅行'], colors: ['#a6b4a0', '#dedbd0'], note: '宽松上衣配轻便长裤，方便步行。', pieces: '浅绿上衣 · 休闲长裤 · 运动鞋' },
];
const copy = (look?: Look) => look ? { ...look, scenes: [...look.scenes], colors: [...look.colors] as [string, string] } : undefined;
const initial: Plan[] = [
  { id: 'a', date: '2026-10-26', scene: '通勤', look: copy(looks[0]), note: '' },
  { id: 'b', date: '2026-10-28', scene: '通勤', look: copy(looks[0]), note: '白天办公室' },
  { id: 'c', date: '2026-10-28', scene: '聚会', look: copy(looks[2]), note: '晚上与朋友吃饭' },
  { id: 'd', date: '2026-10-30', scene: '见客户', note: '先记下安排，搭配稍后再选' },
  { id: 'e', date: '2026-10-31', scene: '旅行', look: copy(looks[3]), note: '' },
];
function Art({ look }: { look: Look }) {
  return <svg viewBox="0 0 240 170" role="img" aria-label={`${look.name}服饰组合示意`}>
    <ellipse cx="122" cy="151" rx="91" ry="5" fill="#253d32" opacity=".04" />
    <path d="m53 25-22 12-20 37 24 13 13-23-2 72q30 8 59 0l-3-72 12 23 24-13-20-37-22-12-11-4H64Z" fill={look.colors[0]} stroke="#6c7165" strokeOpacity=".26" />
    <path d="m64 21 11 20 10-20m-10 20v96M50 65h15v19H50" fill="none" stroke="#666e61" strokeOpacity=".24" />
    <path d="M155 25h56l7 113-27 2-8-73-7 73-29-2Z" fill={look.colors[1]} stroke="#566052" strokeOpacity=".25" />
    <path d="M154 35h57m-28-9v34m-20-23-7 14m47-14 8 14" fill="none" stroke="#fff" strokeOpacity=".35" />
    <path d="m41 151 12-11 26 9 12 4v7H40Zm76 0 12-11 26 9 12 4v7h-51Z" fill="#b1a18b" stroke="#8d8575" strokeWidth=".7" />
  </svg>;
}
function Preview() {
  const [selected, setSelected] = useState(today);
  const [plans, setPlans] = useState(initial);
  const [filter, setFilter] = useState('全部');
  const [customScenes, setCustomScenes] = useState(['见客户']);
  const [monthOpen, setMonthOpen] = useState(false);
  const [editing, setEditing] = useState<Plan>();
  const [custom, setCustom] = useState('');
  const [detail, setDetail] = useState<string>();
  const [toast, context] = message.useMessage();
  const monday = selected.subtract((selected.day() + 6) % 7, 'day');
  const dates = Array.from({ length: 7 }, (_, i) => monday.add(i, 'day'));
  const dateKey = selected.format('YYYY-MM-DD');
  const current = plans.filter(p => p.date === dateKey);
  const scenes = [...presets, ...customScenes];
  const shown = looks.filter(l => filter === '全部' || l.scenes.includes(filter));
  const newPlan = (look?: Look) => {
    setCustom('');
    setEditing({ id: crypto.randomUUID(), date: dateKey, scene: look?.scenes[0] || '日常', look: copy(look), note: '' });
  };
  const save = () => {
    if (!editing) return;
    const scene = editing.scene === '__custom' ? custom.trim() : editing.scene;
    if (!scene) { void toast.warning('请填写场景名称'); return; }
    if (!scenes.includes(scene)) setCustomScenes(s => [...s, scene]);
    const next = { ...editing, scene, look: copy(editing.look) };
    setPlans(all => all.some(p => p.id === next.id) ? all.map(p => p.id === next.id ? next : p) : [...all, next]);
    setSelected(dayjs(next.date)); setEditing(undefined); void toast.success('已保存到这一天（示例）');
  };
  const nav = (name: string) => setDetail(`${name}：此入口在正式产品中打开对应页面。本预览仅演示工作台布局。`);
  return <ConfigProvider locale={zhCN} theme={{ token: { colorPrimary: '#365e4e', colorText: '#293b31', colorTextSecondary: '#738075', colorBorder: '#dce2d8', borderRadius: 8, fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif' } }}>
    {context}
    <div className="wc-preview-note">界面讨论稿 · 全部为示例数据与服饰示意 · 修改仅保留在当前页面</div>
    <div className="wc-shell">
      <aside className="wc-sidebar"><a className="wc-brand" href="/workspace-calendar-preview.html">lookmate<span>个人形象设计</span></a><nav aria-label="主要导航">{['工作台', '设计记录', '我的衣橱', '个人资料'].map((n, i) => <button key={n} className={i === 0 ? 'active' : ''} onClick={() => i ? nav(n) : window.scrollTo({ top: 0, behavior: 'smooth' })}><span aria-hidden="true">{['◫', '▤', '◇', '○'][i]}</span>{n}</button>)}</nav><div className="wc-sidebar-foot"><span className="wc-avatar">M</span><div>我的空间<small>个人衣橱与穿搭</small></div></div></aside>
      <main className="wc-main"><header className="wc-heading"><div><h1>工作台</h1></div><Button type="primary" onClick={() => nav('开始形象设计')}>＋ 开始形象设计</Button></header>
        <div className="wc-top-grid"><section className="wc-calendar-panel"><header className="wc-section-header"><div><span className="wc-eyebrow">OUTFIT PLANNER</span><h2>穿搭日历</h2></div><Space size={7}><Button size="small" onClick={() => setSelected(today)}>今天</Button><Button size="small" onClick={() => setMonthOpen(true)}>月历</Button></Space></header>
          <div className="wc-week-heading"><h3>{monday.format('YYYY 年 M 月')}<span>{monday.format('M.D')} — {monday.add(6, 'day').format('M.D')}</span></h3><Space size={4}><Button aria-label="上一周" onClick={() => setSelected(selected.subtract(7, 'day'))}>‹</Button><Button aria-label="下一周" onClick={() => setSelected(selected.add(7, 'day'))}>›</Button></Space></div>
          <div className="wc-week" aria-label="本周日期">{dates.map(d => { const entries = plans.filter(p => p.date === d.format('YYYY-MM-DD')); return <button key={d.format('YYYY-MM-DD')} className={`wc-day ${d.isSame(selected, 'day') ? 'selected' : ''} ${d.isSame(today, 'day') ? 'today' : ''}`} onClick={() => setSelected(d)} aria-pressed={d.isSame(selected, 'day')} aria-label={`${d.format('M月D日')}，${entries.length}条安排`}><span>{d.format('ddd')}{d.isSame(today, 'day') && <i>今天</i>}</span><strong>{d.date()}</strong><small>{entries.length ? `${entries.length} 条安排` : '未安排'}</small><div className="wc-dots">{entries.slice(0, 3).map(p => <b key={p.id} className={!p.look ? 'pending' : ''} />)}</div></button>; })}</div>
          <div className="wc-day-title"><div><h3>{selected.format('M 月 D 日')}<span>{selected.format('dddd')}</span></h3><small>{current.length ? `${current.length} 条安排 · 可按场景安排多套` : '还没有安排，从一套搭配开始'}</small></div><Button onClick={() => newPlan()}>＋ 添加安排</Button></div>
          <div className="wc-plans">{current.length ? current.map(p => <article className="wc-plan" key={p.id}><div className={`wc-plan-art ${!p.look ? 'empty' : ''}`}>{p.look ? <Art look={p.look} /> : <span>待选搭配</span>}</div><div className="wc-plan-content"><div className="wc-plan-top"><Tag bordered={false}>{p.scene}</Tag><span>{p.note}</span></div><h4>{p.look?.name || '先留一个位置，稍后选衣'}</h4><p>{p.look?.note || '场景已经记下，找到合适的搭配再补充。'}</p><div className="wc-plan-links"><button onClick={() => { setCustom(''); setEditing({ ...p, look: copy(p.look) }); }}>{p.look ? '调整安排' : '选择搭配'}</button><button className="muted" onClick={() => { setPlans(all => all.filter(x => x.id !== p.id)); void toast.success('已移除这条示例安排'); }}>移除</button></div></div></article>) : <div className="wc-empty"><Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="把常用搭配安排到这一天" /><Button type="primary" onClick={() => newPlan()}>安排第一套</Button></div>}</div>
          <footer className="wc-calendar-foot">已安排的组合与穿法会保留，修改常用搭配不会自动改变计划。</footer>
        </section>
        <aside className="wc-activity"><section className="wc-activity-section"><header><h2>进行中的任务 <span>1</span></h2></header><button className="wc-running" onClick={() => setDetail('轻松通勤方案 · 正在生成效果图。这是固定的示例状态，没有调用模型。')}><span className="wc-status-dot"/><div><strong>轻松通勤方案</strong><small>正在生成效果图</small></div><span>查看 ›</span></button></section>
          <section className="wc-activity-section wc-recent"><header><h2>最近设计</h2><button onClick={() => nav('全部设计记录')}>全部 ›</button></header>{[{ name: '秋日通勤的另一种搭法', type: '穿搭设计', time: '今天 09:42', status: '已完成' }, { name: '自然蓬松短发', type: '发型设计', time: '昨天 16:20', status: '已完成' }, { name: '周末的轻松组合', type: '穿搭设计', time: '10.26 11:08', status: '待确认' }, { name: '聚会穿搭尝试', type: '穿搭设计', time: '10.25 18:30', status: '失败' }, { name: '干净利落的整体造型', type: '整体设计', time: '10.24 09:12', status: '已完成' }].map(r => <button className="wc-recent-row" key={r.name} onClick={() => setDetail(`${r.name} · ${r.status}。此处为示例详情，正式版本会进入已有设计详情页面。`)}><div><strong>{r.name}</strong><small>{r.type} · {r.time}</small></div><span className={r.status === '失败' ? 'failed' : r.status === '待确认' ? 'unknown' : ''}>{r.status}</span></button>)}</section>
          <section className="wc-quick"><span>准备好下一次设计</span><div>{['我的照片', '身体尺寸', '我的衣橱'].map(n => <button key={n} onClick={() => nav(n)}>{n} ↗</button>)}</div></section>
        </aside></div>
        <section className="wc-scenes"><header className="wc-section-header"><div><span className="wc-eyebrow">DRESS FOR THE OCCASION</span><h2>场景穿搭</h2><p>从已有搭配中挑选，安排到你的日程。</p></div><Button onClick={() => nav('常用搭配')}>全部常用搭配 ›</Button></header><div className="wc-scene-tabs" role="group" aria-label="按场景筛选">{['全部', ...scenes].map(s => <button key={s} className={filter === s ? 'active' : ''} aria-pressed={filter === s} onClick={() => setFilter(s)}>{s}</button>)}</div><div className="wc-look-grid">{shown.map(l => <article className="wc-look" key={l.id}><div className="wc-look-art"><Art look={l} /><span>服饰示意</span></div><div className="wc-look-info"><span>{l.scenes.join(' / ')}</span><h3>{l.name}</h3><p>{l.pieces}</p><Button block onClick={() => newPlan(l)}>安排到日历</Button></div></article>)}</div>{!shown.length && <div className="wc-scene-empty"><p>还没有标记为「{filter}」的搭配</p><Button onClick={() => nav(`为${filter}设计穿搭`)}>为这个场景设计一套</Button></div>}</section>
      </main>
    </div>
    <Modal title="选择日期" open={monthOpen} footer={null} onCancel={() => setMonthOpen(false)} width={650}><Calendar fullscreen={false} value={selected} onSelect={(value: Dayjs, info) => { setSelected(value); if (info.source === 'date') setMonthOpen(false); }} cellRender={(date, info) => info.type === 'date' && plans.some(p => p.date === date.format('YYYY-MM-DD')) ? <span className="wc-month-mark" aria-label="有穿搭安排" /> : null} /><p className="wc-dialog-hint">有圆点的日期已安排穿搭，点击日期返回周历。</p></Modal>
    <Modal title={editing && plans.some(p => p.id === editing.id) ? '调整穿搭安排' : '添加穿搭安排'} open={!!editing} onCancel={() => setEditing(undefined)} onOk={save} okText="保存安排" cancelText="取消" width={620} destroyOnHidden><div className="wc-editor">{editing && <><div className="wc-form-row"><label>日期<DatePicker value={dayjs(editing.date)} allowClear={false} onChange={d => d && setEditing({ ...editing, date: d.format('YYYY-MM-DD') })} /></label><label>场景<Select aria-label="场景" value={editing.scene} onChange={scene => setEditing({ ...editing, scene })} options={[...scenes.map(s => ({ value: s, label: s })), { value: '__custom', label: '＋ 自定义场景' }]} /></label></div>{editing.scene === '__custom' && <label>自定义场景<Input value={custom} onChange={e => setCustom(e.target.value)} placeholder="例如：参加婚礼" maxLength={20} /></label>}<label>备注 <span>选填</span><Input value={editing.note} onChange={e => setEditing({ ...editing, note: e.target.value })} placeholder="例如：晚上与朋友吃饭，无需填写具体时间" maxLength={80} /></label><div className="wc-picker-heading"><strong>选择搭配</strong><button onClick={() => setEditing({ ...editing, look: undefined })}>稍后再选</button></div><div className="wc-look-picker">{looks.map(l => <button key={l.id} className={editing.look?.id === l.id ? 'selected' : ''} aria-pressed={editing.look?.id === l.id} onClick={() => setEditing({ ...editing, look: copy(l) })}><Art look={l} /><span>{l.name}</span><small>{l.scenes.join(' / ')}</small></button>)}</div><p className="wc-dialog-hint">{editing.look ? `已选择「${editing.look.name}」，保存后保留这套组合与穿法。` : '暂未选择搭配，保存后会显示“待选搭配”。'}</p></>}</div></Modal>
    <Modal title="预览说明" open={!!detail} onCancel={() => setDetail(undefined)} footer={<Button type="primary" onClick={() => setDetail(undefined)}>知道了</Button>}><p>{detail}</p></Modal>
  </ConfigProvider>;
}
createRoot(document.getElementById('root')!).render(<Preview />);
