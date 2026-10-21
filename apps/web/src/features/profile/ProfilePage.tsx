import { useState } from 'react';
import { Alert, Button, Card, Descriptions, Empty, Form, Input, InputNumber, Modal, Pagination, Popconfirm, Select, Skeleton, Space, Table, Tabs, Tag, Typography } from 'antd';
import { ApiError, type Account } from '../../api/client';
import { QueryFailure } from '../workspace/TaskViews';
import { ImageUpload, usableImage, type ImageDraft } from '../wardrobe/ImageUpload';
import { PrivateImage } from '../wardrobe/PrivateImage';
import { countText, trimText } from '../wardrobe/queries';
import { emptyMeasurements, measurementGroups, measurementValues, photoTypes, useMeasurements, usePhotos, useProfile, useProfileEditor, type Measurement, type MeasurementValues, type Profile } from './queries';
const { Title, Paragraph, Text } = Typography;
type Editor = ReturnType<typeof useProfileEditor>;
function MeasurementDetails({ value }: { value: Measurement | null }) {
  return value ? <Descriptions size="small" column={{ xs: 1, sm: 2, lg: 3 }} items={measurementGroups.flatMap(group => group.fields.map(([key, label]) => ({ key, label, children: value[key] == null ? '未填写' : `${value[key]} ${key === 'weight' ? 'kg' : 'cm'}` })))} /> : <Text type="secondary">未选择当前尺寸</Text>;
}
function Feedback({ editor }: { editor: Editor }) {
  return <>
    {editor.mutation.isError && !(editor.compared && editor.mutation.error instanceof ApiError && editor.mutation.error.detail.code === 'VERSION_CONFLICT') ? <Alert className="form-alert" showIcon type="error" title={editor.conflict ? '资料已在其他页面更新，当前输入已保留。' : editor.mutation.error.message} description={editor.conflict ? '请刷新最新资料，与当前输入比较后再次保存。' : undefined} /> : null}
    {editor.conflict && !editor.mutation.isError ? <Alert className="form-alert" type="warning" showIcon title="操作已保存，但最新资料读取失败。请刷新后再进行下一步。" /> : null}
    {editor.conflict ? <Button className="form-alert" loading={editor.refresh.isPending} onClick={() => editor.refresh.mutate()}>刷新最新资料并保留输入</Button> : null}
    {editor.refresh.isError ? <Alert type="error" showIcon title={editor.refresh.error.message} /> : null}
    {editor.compared ? <Card size="small" className="form-alert" title="最新服务端资料（你的输入未改变）"><Descriptions size="small" column={1} items={[
      { key: 'name', label: '显示名称', children: editor.baseline.displayName || '未设置' },
      { key: 'portrait', label: '默认头像', children: editor.baseline.defaultPortraitId ? '已设置，可在我的照片中查看默认标记' : '未设置' },
      { key: 'full', label: '默认全身照', children: editor.baseline.defaultFullBodyId ? '已设置，可在我的照片中查看默认标记' : '未设置' },
      { key: 'measurement', label: '当前尺寸记录时间', children: editor.baseline.currentMeasurement ? new Date(editor.baseline.currentMeasurement.createdAt).toLocaleString('zh-CN') : '未设置' },
    ]} /><MeasurementDetails value={editor.baseline.currentMeasurement} /><Paragraph type="secondary">核对以上最新值后，可重新执行保存或操作。</Paragraph></Card> : null}
    {editor.mutation.isSuccess && !editor.compared && !editor.conflict ? <Alert className="form-alert" type="success" showIcon title="已保存" /> : null}
  </>;
}
function BasicProfile({ profile }: { profile: Profile }) {
  const editor = useProfileEditor(profile);
  const [name, setName] = useState(profile.displayName ?? '');
  const [validation, setValidation] = useState('');
  function save() {
    const value = trimText(name);
    if (value && countText(value) > 64) { setValidation('显示名称最多 64 个字符。'); return; }
    setValidation('');
    editor.mutation.mutate({ path: '/profile', method: 'PATCH', body: { displayName: value || null } });
  }
  return <div className="profile-basic"><div className="profile-identity"><span className="profile-avatar">{Array.from(profile.displayName || profile.username)[0]}</span><div><Title level={4}>{profile.displayName || profile.username}</Title><Text type="secondary">你的个人形象档案</Text></div></div><Feedback editor={editor} /><Form layout="vertical" onFinish={save}><Form.Item label="用户名"><Input value={profile.username} readOnly /></Form.Item><Form.Item label="显示名称" htmlFor="profile-display-name" extra="最多 64 个字符；留空保存可清除显示名称。" validateStatus={validation ? 'error' : undefined} help={validation || undefined}><Input id="profile-display-name" value={name} disabled={editor.busy} onChange={event => { setName(event.target.value); setValidation(''); }} allowClear /></Form.Item><Button type="primary" htmlType="submit" loading={editor.mutation.isPending} disabled={editor.conflict || editor.refresh.isPending}>保存资料</Button></Form></div>;
}
function Measurements({ profile }: { profile: Profile }) {
  const editor = useProfileEditor(profile);
  const [page, setPage] = useState(1);
  const query = useMeasurements(profile.id, page);
  const [values, setValues] = useState<MeasurementValues>(() => measurementValues(profile.currentMeasurement));
  const [detail, setDetail] = useState<Measurement | null>(null);
  const [validation, setValidation] = useState('');
  const blocked = editor.busy || editor.conflict;
  const invalidValue = (v: number | null) => v != null && (!Number.isFinite(v) || v <= 0 || v > 9999.99 || Math.abs(v * 100 - Math.round(v * 100)) > 0.000001);
  function save() {
    const invalid = Object.values(values).some(invalidValue);
    if (invalid) { setValidation('尺寸必须大于 0、不超过 9999.99，且最多两位小数。'); return; }
    setValidation(''); editor.mutation.mutate({ path: '/profile/measurements', method: 'POST', body: values }, { onSuccess: () => setPage(1) });
  }
  return <div className="profile-measurements"><Feedback editor={editor} /><Card size="small" title="当前尺寸" extra={profile.currentMeasurementId ? <Popconfirm title="清空当前尺寸引用？" description="历史记录会保留。" onConfirm={() => editor.mutation.mutate({ path: '/profile/current-measurement', method: 'PUT', body: { measurementId: null } })}><Button disabled={blocked}>清空当前选择</Button></Popconfirm> : null}><MeasurementDetails value={profile.currentMeasurement} /></Card>
    <Title level={4}>记录一组新尺寸</Title><Paragraph type="secondary">各项均可留空。每次保存会新增完整历史并设为当前；留空项不会继承旧值。长度和围度使用 cm，体重使用 kg。测量时保持自然姿态，软尺贴合但不勒紧。</Paragraph>
    <Space wrap className="form-alert"><Button disabled={blocked} onClick={() => setValues(measurementValues(profile.currentMeasurement))}>从当前尺寸填写</Button><Button disabled={blocked} onClick={() => setValues(emptyMeasurements())}>清空表单</Button></Space>
    <Form layout="vertical" onFinish={save} disabled={editor.busy}>{measurementGroups.map(group => <section key={group.title}><Title level={5}>{group.title}</Title><div className="profile-measurement-grid">{group.fields.map(([key, label, hint]) => <Form.Item key={key} label={`${label}（${key === 'weight' ? 'kg' : 'cm'}）`} htmlFor={`measurement-${key}`} extra={hint} validateStatus={invalidValue(values[key]) ? 'error' : undefined} help={invalidValue(values[key]) ? '请输入大于 0、最多两位小数且不超过 9999.99 的数值' : undefined}><InputNumber id={`measurement-${key}`} aria-invalid={invalidValue(values[key])} value={values[key]} onChange={v => setValues(old => ({ ...old, [key]: v }))} step={0.01} style={{ width: '100%' }} /></Form.Item>)}</div></section>)}{validation ? <Alert className="form-alert" type="error" showIcon title={validation} /> : null}<Button type="primary" htmlType="submit" loading={editor.mutation.isPending} disabled={blocked}>保存为新记录并设为当前</Button></Form>
    <Title level={4}>尺寸历史</Title>{query.isError ? <QueryFailure error={query.error} stale={!!query.data} loading={query.isFetching} retry={() => void query.refetch()} /> : null}
    <Table<Measurement> rowKey="id" loading={query.isPending} dataSource={query.data?.items ?? []} pagination={false} scroll={{ x: 650 }} locale={{ emptyText: <Empty description="还没有尺寸记录" /> }} columns={[
      { title: '记录时间', dataIndex: 'createdAt', render: value => new Date(value).toLocaleString('zh-CN') },
      { title: '身高 / 体重', render: (_, row) => `${row.height ?? '—'} cm / ${row.weight ?? '—'} kg` },
      { title: '状态', render: (_, row) => row.id === profile.currentMeasurementId ? <Tag color="green">当前</Tag> : '历史' },
      { title: '操作', render: (_, row) => <Space wrap><Button size="small" onClick={() => setDetail(row)}>查看详情</Button><Button size="small" disabled={blocked || row.id === profile.currentMeasurementId} onClick={() => editor.mutation.mutate({ path: '/profile/current-measurement', method: 'PUT', body: { measurementId: row.id } })}>设为当前</Button><Popconfirm title="删除这条尺寸记录？" description="如果它是当前记录，将同时清空当前选择；已有设计快照不变。" onConfirm={() => editor.mutation.mutate({ path: `/profile/measurements/${row.id}`, method: 'DELETE' }, { onSuccess: () => { if (query.data?.items.length === 1 && page > 1) setPage(page - 1); } })}><Button size="small" danger disabled={blocked}>删除</Button></Popconfirm></Space> },
    ]} /><Pagination className="profile-pagination" current={page} pageSize={10} total={query.data?.total ?? 0} showSizeChanger={false} onChange={setPage} />
    <Modal open={!!detail} title="尺寸记录详情" footer={<Button onClick={() => setDetail(null)}>关闭</Button>} onCancel={() => setDetail(null)} width={800}><MeasurementDetails value={detail} /></Modal></div>;
}
function Photos({ profile }: { profile: Profile }) {
  const editor = useProfileEditor(profile);
  const [page, setPage] = useState(1);
  const [filter, setFilter] = useState('');
  const [type, setType] = useState('PORTRAIT');
  const [items, setItems] = useState<ImageDraft[]>([]);
  const query = usePhotos(profile.id, page, filter);
  const blocked = editor.busy || editor.conflict;
  return <div><Feedback editor={editor} /><Card size="small" title="添加个人照片"><Paragraph type="secondary">先选择照片类型，上传并核验后保存。保存照片不会自动设为默认。</Paragraph><Form layout="vertical"><Form.Item label="照片类型"><Select style={{ width: 200 }} options={photoTypes} value={type} onChange={setType} disabled={editor.busy} /></Form.Item></Form><ImageUpload accountId={profile.id} items={items} setItems={setItems} disabled={editor.busy} mode="photo" />{items.map(item => <Button className="profile-save-photo" key={item.key} type="primary" disabled={!usableImage(item) || editor.busy} loading={editor.mutation.isPending} onClick={() => editor.mutation.mutate({ path: '/photos', method: 'POST', versioned: false, body: { fileId: item.fileId, photoType: type } }, { onSuccess: () => { setItems(current => current.filter(v => v.key !== item.key)); setPage(1); } })}>保存「{item.name}」为{photoTypes.find(v => v.value === type)?.label}</Button>)}</Card>
    <div className="profile-photo-toolbar"><Select aria-label="筛选照片类型" style={{ width: 180 }} options={[{ value: '', label: '全部照片' }, ...photoTypes]} value={filter} onChange={v => { setFilter(v); setPage(1); }} /><Space wrap>{profile.defaultPortraitId ? <Button disabled={blocked} onClick={() => editor.mutation.mutate({ path: '/profile/default-photos', method: 'PUT', body: { portraitId: null } })}>清除默认头像</Button> : null}{profile.defaultFullBodyId ? <Button disabled={blocked} onClick={() => editor.mutation.mutate({ path: '/profile/default-photos', method: 'PUT', body: { fullBodyId: null } })}>清除默认全身照</Button> : null}</Space></div>
    {query.isError ? <QueryFailure error={query.error} stale={!!query.data} loading={query.isFetching} retry={() => void query.refetch()} /> : null}{query.isPending ? <Skeleton active /> : query.data?.items.length ? <div className="profile-photo-grid">{query.data.items.map(photo => <Card key={photo.id} size="small"><PrivateImage accountId={profile.id} fileId={photo.fileId} alt={photoTypes.find(v => v.value === photo.photoType)?.label ?? '个人照片'} /><Space wrap className="form-alert"><Tag>{photoTypes.find(v => v.value === photo.photoType)?.label}</Tag>{[profile.defaultPortraitId, profile.defaultFullBodyId].includes(photo.id) ? <Tag color="green">默认</Tag> : null}</Space><Space wrap>{photo.photoType !== 'REFERENCE' ? <Button size="small" disabled={blocked || [profile.defaultPortraitId, profile.defaultFullBodyId].includes(photo.id)} onClick={() => editor.mutation.mutate({ path: '/profile/default-photos', method: 'PUT', body: { [photo.photoType === 'PORTRAIT' ? 'portraitId' : 'fullBodyId']: photo.id } })}>设为默认{photo.photoType === 'PORTRAIT' ? '头像' : '全身照'}</Button> : null}<Popconfirm title="删除这张照片？" description="匹配的默认照片会清除，已有设计使用的图片仍会保留。" onConfirm={() => editor.mutation.mutate({ path: `/photos/${photo.id}`, method: 'DELETE' }, { onSuccess: () => { if (query.data?.items.length === 1 && page > 1) setPage(page - 1); } })}><Button size="small" danger disabled={blocked}>删除</Button></Popconfirm></Space></Card>)}</div> : query.data ? <Empty description="还没有这一类照片，可在上方上传" /> : null}<Pagination className="profile-pagination" current={page} pageSize={12} total={query.data?.total ?? 0} showSizeChanger={false} onChange={setPage} /></div>;
}
export function ProfilePage({ account }: { account: Account }) {
  const query = useProfile(account.id);
  const value = new URLSearchParams(window.location.search).get('tab');
  const [tab, setTab] = useState(value && ['basic', 'photos', 'measurements'].includes(value) ? value : 'basic');
  function changeTab(next: string) { setTab(next); const url = new URL(window.location.href); url.searchParams.set('tab', next); window.history.replaceState(null, '', url); }
  return <><div className="section-heading"><div><Title level={2}>从了解自己开始</Title><Paragraph type="secondary">你的资料、照片与尺寸，为个人形象设计提供参考。</Paragraph></div></div>{query.isError ? <QueryFailure error={query.error} stale={!!query.data} loading={query.isFetching} retry={() => void query.refetch()} /> : null}<Card>{query.isPending ? <Skeleton active /> : query.data ? <Tabs activeKey={tab} onChange={changeTab} items={[
    { key: 'basic', label: '基础资料', children: <BasicProfile profile={query.data} /> }, { key: 'photos', label: '我的照片', children: <Photos profile={query.data} /> }, { key: 'measurements', label: '身体尺寸', children: <Measurements profile={query.data} /> },
  ]} /> : <Text type="secondary">个人资料读取失败，请重试。</Text>}</Card></>;
}
