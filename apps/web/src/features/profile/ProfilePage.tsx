import { Feedback } from '../../components/Feedback';
import { PageActionBar } from '../../components/PageActionBar';
import { PageHeading } from '../../components/PageHeading';
import { useEffect, useState } from 'react';
import { Button, Card, Input, Modal, Radio, Skeleton } from 'antd';
import { BirthDateInput } from './BirthDateInput';
import { isCalendarDate } from './birthDate';
import type { Account } from '../../api/client';
import { setNavigationGuard, useLocation } from '../../app/navigation';
import { QueryFailure } from '../workspace/TaskViews';
import { emptyMeasurements, measurementGroups, measurementValues, useProfile, type MeasurementKey, type Profile } from './queries';
import { cleanPreferences, count, preferenceErrors } from './preferences';
import { useProfileSession } from './useProfileSession';
import { ProfilePhotos } from './ProfilePhotos';
import { ProfilePreferences } from './ProfilePreferences';
import { ProfileMeasurements } from './ProfileMeasurements';
import { ProfileFeedback } from './ProfileFeedback';
import './ProfileEditor.css';

type Section = 'basic' | 'measurements' | 'preferences';
const sections: Section[] = ['basic', 'measurements', 'preferences'];
function scrollToSection(section: string) {
  document.getElementById(`profile-${section}`)?.scrollIntoView({ block: 'start' });
}
function Editor({ profile }: { profile: Profile }) {
  const [photoDirty, setPhotoDirty] = useState(false);
  const [photoBusy, setPhotoBusy] = useState(false);
  const s = useProfileSession(profile, photoDirty);
  const [validation, setValidation] = useState<{ section: Section; message: string }>();
  const [focusError, setFocusError] = useState<{ key: MeasurementKey; attempt: number }>();
  const [modal, holder] = Modal.useModal();
  const location = useLocation();
  const tab = location.searchParams.get('tab');
  const dirty = s.dirty || photoDirty || s.busy || !!s.unknown || !!s.confirmed;
  const writeBlocked = s.blocked || photoBusy;

  useEffect(() => {
    const pathname = window.location.pathname;
    const cleanup = setNavigationGuard(url => url.pathname === pathname || !dirty || window.confirm('有未保存的修改或待确认操作。离开会丢失本页草稿，确定离开？'));
    const warn = (event: BeforeUnloadEvent) => { if (dirty) { event.preventDefault(); event.returnValue = ''; } };
    window.addEventListener('beforeunload', warn);
    return () => { cleanup(); window.removeEventListener('beforeunload', warn); };
  }, [dirty]);
  useEffect(() => {
    if (location.hash === '#profile-photos' || tab === 'photos') scrollToSection('photos');
    else if (sections.some(section => `#profile-${section}` === location.hash)) document.getElementById(location.hash.slice(1))?.scrollIntoView({ block: 'start' });
    else if (tab && sections.some(section => section === tab)) scrollToSection(tab);
  }, [tab, location.hash]);

  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  function invalid(section: Section, message: string, fieldId?: string) {
    setValidation({ section, message });
    scrollToSection(section);
    if (fieldId) document.getElementById(fieldId)?.focus();
    return false;
  }
  function validateMeasurements() {
    const field = measurementGroups.flatMap(group => group.fields.map(([key, label]) => ({ key, label }))).find(({ key }) => {
      const value = s.values[key];
      return value !== null && (!Number.isFinite(value) || value <= 0 || value > 9999.99 || Math.abs(value * 100 - Math.round(value * 100)) > 0.000001);
    });
    if (field) {
      setFocusError({ key: field.key, attempt: Date.now() });
      return invalid('measurements', `${field.label}：请输入大于 0、不超过 9999.99 且最多两位小数的数值。`);
    }
    if (!s.gender) return invalid('basic', '请选择性别。');
    return true;
  }
  function saveForm() {
    if (writeBlocked) return;
    const name = s.name.trim();
    if (count(name) > 64) return invalid('basic', '昵称最多 64 个字符。', 'profile-display-name');
    if (s.birthDate && (!isCalendarDate(s.birthDate) || s.birthDate > today)) return invalid('basic', '请选择 1000-01-01 至今天之间的有效出生日期。', 'profile-birth-date');
    if (!validateMeasurements()) return;
    if (Object.values(s.tagDrafts).some(Boolean)) return invalid('preferences', '有尚未添加的标签文字，请先添加或清除。');
    const errors = preferenceErrors(s.preferences);
    if (errors.length) return invalid('preferences', errors.join(' '));
    setValidation(undefined);
    s.save({ path: '/profile/form', method: 'PUT', scope: 'form', body: {
      displayName: name || null, birthDate: s.birthDate || null, gender: s.gender,
      measurements: { ...s.values }, preferences: cleanPreferences(s.preferences),
    } });
  }
  function saveHistory() {
    if (writeBlocked || !validateMeasurements()) return;
    setValidation(undefined);
    s.save({ path: '/profile/measurements', method: 'POST', scope: 'measurements', body: { gender: s.gender, ...s.values } });
  }
  function replaceSizes(clear: boolean) {
    const action = () => s.setValues(clear ? emptyMeasurements() : measurementValues(s.baseline.currentMeasurement));
    if (s.sizesDirty) modal.confirm({ title: clear ? '清空尺寸？' : '恢复当前尺寸？', content: '未保存的尺寸修改将被替换，性别保持不变。', okText: '确认', cancelText: '继续编辑', onOk: action });
    else action();
  }
  function validationFor(section: Section) {
    return validation?.section === section ? <Feedback type="error" title={validation.message} /> : null;
  }
  return <div className="profile-editor">
    {holder}
    <Card className="profile-editor-card">
      <div className="profile-page-toolbar">
        <Button loading={s.busy} disabled={s.busy || photoBusy} onClick={() => void s.refresh('form')}>刷新资料</Button>
      </div>
      <div id="profile-save-feedback"><ProfileFeedback session={s} /></div>
      <section id="profile-basic" className="profile-form-section" aria-labelledby="profile-basic-title">
        <h2 id="profile-basic-title" className="profile-form-title">基础资料</h2>
        {validationFor('basic')}
        <div className="profile-basic-layout"><ProfilePhotos profile={s.baseline} session={s} onDirty={setPhotoDirty} onBusy={setPhotoBusy}>
          <section className="profile-basic-info" aria-label="基本信息字段"><div className="pp-basic">
            <div className="pp-field"><label htmlFor="profile-username">用户名</label><span id="profile-username" className="profile-username">{profile.username}</span></div>
            <div className="pp-field"><label htmlFor="profile-display-name">昵称</label><Input id="profile-display-name" value={s.name} disabled={s.blocked} allowClear onChange={event => s.setName(event.target.value)} /><small>可留空，最多 64 个字符</small></div>
            <div className="pp-field"><span>性别</span><Radio.Group aria-label="基础资料性别" value={s.gender ?? 'FEMALE'} disabled={s.blocked} options={[{ label: '女', value: 'FEMALE' }, { label: '男', value: 'MALE' }]} onChange={event => s.setGender(event.target.value)} /></div>
            <div className="pp-field"><label htmlFor="profile-birth-date">出生日期</label><BirthDateInput value={s.birthDate} today={today} disabled={s.blocked} onChange={s.setBirthDate} /></div>
          </div></section>
        </ProfilePhotos></div>
      </section>
      <section id="profile-measurements" className="profile-form-section" aria-labelledby="profile-measurements-title">
        <h2 id="profile-measurements-title" className="profile-form-title">身体尺寸</h2>
        {validationFor('measurements')}
        <ProfileMeasurements session={s} focusError={focusError} refreshDisabled={writeBlocked} actions={<>
          <Button disabled={writeBlocked} onClick={() => replaceSizes(false)}>恢复当前尺寸</Button>
          <Button disabled={writeBlocked} onClick={() => replaceSizes(true)}>清空尺寸</Button>
          <Button disabled={writeBlocked} onClick={saveHistory}>保存为历史</Button>
        </>} />
      </section>
      <section id="profile-preferences" className="profile-form-section" aria-labelledby="profile-preferences-title">
        <h2 id="profile-preferences-title" className="profile-form-title">兴趣与偏好</h2>
        {validationFor('preferences')}
        <ProfilePreferences session={s} />
      </section>
    </Card>
    <PageActionBar status={<div className="profile-save-status" aria-live="polite"><strong>{s.dirty ? '有未保存的修改' : '当前没有未保存的修改'}</strong><small>{s.error || s.notice || '统一保存资料、尺寸与偏好；照片操作即时保存。'}</small></div>}>
      <Button type="primary" loading={s.busy} disabled={writeBlocked} onClick={saveForm}>保存修改</Button>
      {(s.comparison || s.conflict || s.unknown || s.confirmed) && <Button onClick={() => document.getElementById('profile-save-feedback')?.scrollIntoView({ block: 'start' })}>查看并处理保存状态</Button>}
    </PageActionBar>
  </div>;
}
export function ProfilePage({ account }: { account: Account }) {
  const query = useProfile(account.id);
  return <div className="profile-page"><PageHeading title="从了解自己开始" description="你的资料、照片、尺寸与偏好，为个人形象设计提供参考。" />
    {query.isError && <QueryFailure error={query.error} stale={!!query.data} loading={query.isFetching} retry={() => void query.refetch()} />}
    {query.isPending ? <Card><Skeleton active /></Card> : query.data ? <Editor key={account.id} profile={query.data} /> : <Card><p>个人资料读取失败，请重试。</p></Card>}
  </div>;
}
