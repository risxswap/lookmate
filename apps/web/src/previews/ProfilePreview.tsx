import { StrictMode, useEffect, useState, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { Alert, Button, Collapse, ConfigProvider, DatePicker, Empty, Input, Modal, Radio, Tabs, message, type DatePickerProps } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import { BodyMeasurementEditor, type BodyGender } from '../features/profile/BodyMeasurementEditor';
import { emptyMeasurements, measurementGroups } from '../features/profile/queries';
import './profile-preview.css';

const choices = {
  interests: ['徒步', '露营', '骑行', '跑步', '健身', '旅行', '摄影', '音乐', '阅读', '艺术'],
  styles: ['简约', '休闲', '通勤', '运动', '户外', '复古', '街头', '优雅', '甜美', '中性'],
  preferredColors: ['黑', '白', '灰', '米色', '棕', '红', '橙', '黄', '绿', '蓝', '紫', '粉'],
  avoidedColors: ['黑', '白', '灰', '米色', '棕', '红', '橙', '黄', '绿', '蓝', '紫', '粉'],
  fits: ['宽松', '合身', '修身'], hairLengths: ['短发', '中长发', '长发'],
  restrictions: ['不穿高跟鞋', '不穿露腰款', '不穿紧身款', '不接受剪短'],
};
type ChoiceKey = keyof typeof choices;
const colors: Record<string, string> = { 黑: '#363936', 白: '#fff', 灰: '#a5a8a5', 米色: '#e6dcc7', 棕: '#977657', 红: '#bd605a', 橙: '#dc965a', 黄: '#dfc56b', 绿: '#759582', 蓝: '#7e9db6', 紫: '#a293b0', 粉: '#d9abb6' };
const emptyPreferences = { interests: [] as string[], styles: [] as string[], preferredColors: [] as string[], avoidedColors: [] as string[], fits: [] as string[], hairLengths: [] as string[], restrictions: [] as string[], dyeAcceptance: '', permAcceptance: '', groomingEffort: '', outfitNote: '', hairNote: '', restrictionNote: '' };
const count = (value: string) => Array.from(value).length;
const normalize = (value: string) => value.trim().normalize('NFC');
function Section({ number, title, description, children, className = '' }: { number: string; title: string; description: string; children: ReactNode; className?: string }) {
  return <section className={`pp-section ${className}`}><header className="pp-section-heading"><span>{number}</span><div><h2>{title}</h2><p>{description}</p></div></header>{children}</section>;
}
function Preview() {
  const [tab, setTab] = useState('preferences');
  const [gender, setGender] = useState<BodyGender | null>(null);
  const [savedGender, setSavedGender] = useState<BodyGender | null>(null);
  const [name, setName] = useState('');
  const [birthday, setBirthday] = useState<Exclude<DatePickerProps['value'], unknown[]>>(null);
  const [basicBaseline, setBasicBaseline] = useState({ name: '', birthday: '' });
  const [values, setValues] = useState(emptyMeasurements);
  const [savedValues, setSavedValues] = useState(emptyMeasurements);
  const [measurementTime, setMeasurementTime] = useState('');
  const [preferences, setPreferences] = useState(emptyPreferences);
  const [savedPreferences, setSavedPreferences] = useState(emptyPreferences);
  const [drafts, setDrafts] = useState<Partial<Record<ChoiceKey, string>>>({});
  const [customOpen, setCustomOpen] = useState<Partial<Record<ChoiceKey, boolean>>>({});
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<ChoiceKey, string>>>({});
  const [feedback, setFeedback] = useState<Record<string, string>>({});
  const [toast, contextHolder] = message.useMessage();
  const [modal, modalHolder] = Modal.useModal();
  const basicDirty = name !== basicBaseline.name || (birthday?.format('YYYY-MM-DD') || '') !== basicBaseline.birthday || gender !== savedGender;
  const sizesDirty = JSON.stringify(values) !== JSON.stringify(savedValues);
  const preferencesDirty = JSON.stringify(preferences) !== JSON.stringify(savedPreferences) || Object.values(drafts).some(value => !!value);
  const dirty = basicDirty || sizesDirty || preferencesDirty;
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => { if (dirty) { event.preventDefault(); event.returnValue = ''; } };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);
  const conflicts = [
    preferences.preferredColors.some(color => preferences.avoidedColors.includes(color)) ? '同一种颜色不能同时设为喜欢和不喜欢，请调整选择。' : '',
    preferences.fits.includes('修身') && preferences.restrictions.includes('不穿紧身款') ? '“修身”与“不穿紧身款”存在冲突，请调整其中一项。' : '',
  ].filter(Boolean);
  const notesTooLong = ['outfitNote', 'hairNote', 'restrictionNote'].some(key => count(preferences[key as 'outfitNote']) > 500);
  function updatePreference<K extends keyof typeof preferences>(key: K, value: typeof preferences[K]) { setPreferences(previous => ({ ...previous, [key]: value })); setFeedback(previous => ({ ...previous, preferences: '' })); }
  function toggle(key: ChoiceKey, label: string) {
    const selected = preferences[key];
    if (!selected.includes(label) && selected.length >= 20) { setFieldErrors(previous => ({ ...previous, [key]: '每项最多选择 20 个标签。' })); return; }
    updatePreference(key, selected.includes(label) ? selected.filter(item => item !== label) : [...selected, label]);
    setFieldErrors(previous => ({ ...previous, [key]: '' }));
  }
  function addCustom(key: ChoiceKey) {
    const value = normalize(drafts[key] || '');
    const error = !value ? '请输入标签内容。' : count(value) > 20 ? '自定义标签最多 20 个字符。' : preferences[key].includes(value) ? '已添加' : preferences[key].length >= 20 ? '每项最多选择 20 个标签。' : '';
    if (error) { setFieldErrors(previous => ({ ...previous, [key]: error })); return; }
    updatePreference(key, [...preferences[key], value]);
    setDrafts(previous => ({ ...previous, [key]: '' }));
    setFieldErrors(previous => ({ ...previous, [key]: '' }));
  }
  function tags(key: ChoiceKey, label: string, custom = false) {
    const all = [...choices[key], ...preferences[key].filter(value => !choices[key].includes(value))];
    return <div className="pp-field"><div className="pp-field-heading"><span id={`label-${key}`}>{label}</span><small>已选 {preferences[key].length} / 20</small></div><div className="pp-tags" role="group" aria-labelledby={`label-${key}`}>{all.map(value => <button type="button" key={value} aria-pressed={preferences[key].includes(value)} className={`pp-chip ${preferences[key].includes(value) ? 'selected' : ''}`} onClick={() => toggle(key, value)}>{key.includes('Colors') && colors[value] && <i style={{ background: colors[value] }} />}{value}{preferences[key].includes(value) && <span aria-hidden="true">✓</span>}</button>)}{custom && !customOpen[key] && <button type="button" className="pp-chip pp-add" onClick={() => setCustomOpen(previous => ({ ...previous, [key]: true }))}>＋ 自定义</button>}</div>{custom && customOpen[key] && <div className="pp-custom"><Input aria-label={`自定义${label}`} placeholder="输入标签，最多 20 个字符" value={drafts[key] || ''} onChange={event => { setDrafts(previous => ({ ...previous, [key]: event.target.value })); setFieldErrors(previous => ({ ...previous, [key]: '' })); }} onPressEnter={event => { if (!event.nativeEvent.isComposing) addCustom(key); }} /><Button onClick={() => addCustom(key)}>添加</Button><Button type="text" onClick={() => { setDrafts(previous => ({ ...previous, [key]: '' })); setCustomOpen(previous => ({ ...previous, [key]: false })); setFieldErrors(previous => ({ ...previous, [key]: '' })); }}>取消</Button></div>}{fieldErrors[key] && <p role="alert" className="pp-error">{fieldErrors[key]}</p>}</div>;
  }
  function note(key: 'outfitNote' | 'hairNote' | 'restrictionNote', label: string, placeholder: string) { return <div className="pp-field"><div className="pp-field-heading"><label htmlFor={key}>{label}</label><small className={count(preferences[key]) > 500 ? 'pp-error' : ''}>{count(preferences[key])} / 500</small></div><Input.TextArea id={key} rows={3} placeholder={placeholder} value={preferences[key]} status={count(preferences[key]) > 500 ? 'error' : undefined} onChange={event => updatePreference(key, event.target.value)} />{count(preferences[key]) > 500 && <p className="pp-error">补充说明最多 500 个字符。</p>}</div>; }
  function radio(key: 'dyeAcceptance' | 'permAcceptance' | 'groomingEffort', label: string, options: string[]) { return <div className="pp-field"><div className="pp-field-heading"><span>{label}</span></div><Radio.Group aria-label={label} value={preferences[key]} onChange={event => updatePreference(key, event.target.value)} options={['', ...options].map(value => ({ value, label: value || '未设置' }))} /></div>; }
  function saved(section: string) { setFeedback(previous => ({ ...previous, [section]: '已模拟保存 · 仅在当前图稿中生效，刷新后清空' })); toast.success('已模拟保存'); }
  function savePreferences() {
    if (Object.values(drafts).some(value => value?.trim())) { toast.warning('有尚未添加的标签文字，请先添加或清除。'); return; }
    if (conflicts.length || notesTooLong) { toast.warning('请先调整冲突选项或超长说明。'); return; }
    const cleaned = { ...preferences, outfitNote: preferences.outfitNote.trim(), hairNote: preferences.hairNote.trim(), restrictionNote: preferences.restrictionNote.trim() };
    setPreferences(cleaned); setSavedPreferences(cleaned); setDrafts({}); saved('preferences');
  }
  function saveSizes() {
    const invalid = measurementGroups.flatMap(group => group.fields.map(([key, label]) => ({ key, label }))).find(({ key }) => { const value = values[key]; return value !== null && (!Number.isFinite(value) || value <= 0 || value > 9999.99 || Math.abs(value * 100 - Math.round(value * 100)) > 0.000001); });
    if (invalid) { toast.error(`${invalid.label}：请输入大于 0、不超过 9999.99 且最多两位小数的数值。`); return; }
    const commit = () => { setSavedValues({ ...values }); setSavedGender(gender); setMeasurementTime(new Date().toLocaleString('zh-CN')); saved('measurements'); };
    if (Object.values(values).every(value => value === null)) modal.confirm({ title: '保存全空尺寸？', content: '将模拟新增一条全空记录并设为当前，后续按无有效尺寸处理。', okText: '模拟保存', cancelText: '继续填写', onOk: commit }); else commit();
  }
  function replaceSizes(clear: boolean) { const commit = () => setValues(clear ? emptyMeasurements() : { ...savedValues }); if (sizesDirty) modal.confirm({ title: clear ? '清空尺寸？' : '恢复当前尺寸？', content: '当前未保存的尺寸改动将被替换，性别保持不变。', okText: '确认', cancelText: '继续编辑', onOk: commit }); else commit(); }
  function changeTab(key: string) { if (key === 'measurements' && !gender) setGender('FEMALE'); setTab(key); }
  const currentDirty = tab === 'preferences' ? preferencesDirty : tab === 'basic' ? basicDirty : sizesDirty || gender !== savedGender;
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  return <ConfigProvider locale={zhCN} theme={{ token: { colorPrimary: '#315c50', colorText: '#273d34', colorBorder: '#dce3d9', borderRadius: 7, fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif' } }}>{contextHolder}{modalHolder}<div className="pp-shell"><aside className="pp-sidebar"><a className="pp-brand" href="/profile-preview.html">lookmate<span>个人形象设计</span></a><div className="pp-nav"><span>工作台</span><span>我的设计</span><span>我的衣橱</span><span className="active">个人资料</span></div><div className="pp-sidebar-bottom"><span className="pp-avatar">我</span><div>我的形象档案<small>完整资料页图稿</small></div></div></aside><main className="pp-main"><header className="pp-topbar"><span>个人中心 / 个人资料</span><span className="pp-preview-badge">交互图稿 · 不写入资料</span></header><div className="pp-content"><div className="pp-page-heading"><p>MY PROFILE</p><h1>个人资料</h1><div>记录你的日常与偏好，让每一次形象建议更懂你。</div></div><Tabs activeKey={tab} onChange={changeTab} items={[{ key: 'basic', label: '基础资料' }, { key: 'photos', label: '我的照片' }, { key: 'measurements', label: '身体尺寸' }, { key: 'preferences', label: '兴趣与偏好' }]} />
      {tab === 'preferences' && <div className="pp-preferences"><div className="pp-intro"><div><h2>你喜欢的，慢慢告诉我们</h2><p>所有项目均可选填。未设置表示暂未提供信息，之后随时可以补充。</p></div><span>长期偏好</span></div><Section number="01" title="兴趣与活动" description="帮助了解日常生活，不代表每次设计的场景。">{tags('interests', '平时喜欢做什么', true)}</Section><Section number="02" title="穿搭偏好" description="从喜欢的风格与颜色开始，留下你穿得自在的选择。">{tags('styles', '喜欢的风格', true)}{tags('preferredColors', '喜欢的颜色', true)}{tags('avoidedColors', '不喜欢的颜色', true)}{conflicts[0]?.startsWith('同一种') && <Alert type="warning" showIcon title={conflicts[0]} />}{tags('fits', '穿着版型')}{note('outfitNote', '穿搭补充说明', '例如：通勤需要方便走动')}</Section><Section number="03" title="发型偏好" description="告诉我们你接受的变化，以及愿意投入的打理时间。">{tags('hairLengths', '发型长度')}<div className="pp-two-columns">{radio('dyeAcceptance', '染发接受度', ['可接受', '不接受'])}{radio('permAcceptance', '烫发接受度', ['可接受', '不接受'])}</div>{radio('groomingEffort', '日常打理投入', ['简单省事', '愿意适当打理', '愿意花时间打理'])}{note('hairNote', '发型补充说明', '例如：早上只有十分钟打理')}</Section><Section number="04" title="明确限制" description="设计时应遵守的要求。与一般不喜欢区分，请填写你明确不接受的选择。" className="pp-restrictions">{tags('restrictions', '不接受的选择')}{conflicts.some(item => item.startsWith('“修身')) && <Alert type="warning" showIcon title="“修身”与“不穿紧身款”存在冲突，请调整其中一项。" />}{note('restrictionNote', '其他明确限制', '例如：工作场合不能染鲜艳发色')}</Section></div>}
      {tab === 'basic' && <Section number="01" title="基础资料" description="性别与出生日期会作为后续建议的参考，均可随时修改或清空。"><div className="pp-basic"><div className="pp-field"><label htmlFor="username">用户名</label><Input id="username" readOnly value="lookmate_demo" /><small>图稿示例账号 · 用户名不可修改</small></div><div className="pp-field"><label htmlFor="display-name">显示名称</label><Input id="display-name" placeholder="你希望我们如何称呼你" value={name} allowClear onChange={event => setName(event.target.value)} /><small>可留空，最多 64 个字符</small></div><div className="pp-field"><label>性别</label><Radio.Group aria-label="基础资料性别" value={gender || ''} onChange={event => setGender(event.target.value || null)} options={[{ label: '未设置', value: '' }, { label: '女', value: 'FEMALE' }, { label: '男', value: 'MALE' }]} /><small>与身体尺寸共用同一份性别资料</small></div><div className="pp-field"><label htmlFor="birthday">出生日期</label><DatePicker id="birthday" placeholder="选择或输入出生日期" value={birthday} onChange={setBirthday} format="YYYY-MM-DD" disabledDate={date => date.format('YYYY-MM-DD') > today || date.year() < 1000} allowClear /><small>年龄根据出生日期计算，不单独填写</small></div></div></Section>}
      {tab === 'photos' && <Section number="01" title="我的照片" description="管理用于形象建议的头像、全身照与参考图。本图稿只展示空态，不上传照片。"><div className="pp-photo-grid">{['头像照片', '全身照片', '参考图'].map(title => <div className="pp-photo-card" key={title}><div className="pp-photo-placeholder">＋</div><h3>{title}</h3><p>{title === '头像照片' ? '正面清晰，面部无遮挡' : title === '全身照片' ? '自然站立，完整呈现身体比例' : '保存喜欢的造型与风格参考'}</p><Button disabled>上传照片（图稿）</Button><small>尚无照片</small></div>)}</div></Section>}
      {tab === 'measurements' && <div className="pp-measurements"><div className="pp-intro"><div><h2>身体尺寸</h2><p>当前尺寸：{measurementTime ? `${measurementTime}（模拟记录）` : '尚未设置'}。每次保存会新增完整记录。</p></div></div><BodyMeasurementEditor gender={gender || 'FEMALE'} values={values} onGenderChange={setGender} onChange={(key, value) => setValues(previous => ({ ...previous, [key]: value }))} /><Collapse className="pp-history" items={[{ key: 'history', label: '尺寸历史', children: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="图稿不加载真实历史；模拟保存仅更新本页当前尺寸。" /> }]} /></div>}
      {tab !== 'photos' && <footer className="pp-savebar"><div aria-live="polite"><strong>{currentDirty ? '有未保存的修改' : '当前没有未保存的修改'}</strong><small>{feedback[tab] || '图稿中的数据仅保留在本页，刷新后清空。'}</small>{tab === 'preferences' && conflicts.length > 0 && <small className="pp-error">有 {conflicts.length} 项选择冲突，请调整后保存</small>}</div><div className="pp-save-actions">{tab === 'measurements' && <><Button onClick={() => replaceSizes(false)}>恢复当前尺寸</Button><Button onClick={() => replaceSizes(true)}>清空尺寸</Button></>}<Button type="primary" disabled={tab === 'preferences' && (conflicts.length > 0 || notesTooLong)} onClick={() => { if (tab === 'preferences') savePreferences(); else if (tab === 'measurements') saveSizes(); else { if (count(name.trim()) > 64) { toast.error('显示名称最多 64 个字符。'); return; } setName(name.trim()); setBasicBaseline({ name: name.trim(), birthday: birthday?.format('YYYY-MM-DD') || '' }); setSavedGender(gender); saved('basic'); } }}>{tab === 'preferences' ? '保存偏好' : tab === 'measurements' ? '保存为新记录' : '保存资料'}</Button></div></footer>}
      <p className="pp-page-note">交互图稿 · 不连接保存接口，不修改真实个人资料。</p></div></main></div></ConfigProvider>;
}
createRoot(document.getElementById('root')!).render(<StrictMode><Preview /></StrictMode>);
