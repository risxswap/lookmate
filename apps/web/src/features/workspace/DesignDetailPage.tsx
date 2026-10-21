import { Alert, Button, Card, Descriptions, Empty, Result, Skeleton, Space, Typography } from 'antd';
import { PrivateImage } from '../wardrobe/PrivateImage';
import { RetryActions } from '../generation/RetryActions';
import { ContextDetails } from '../generation/PreviewDetails';
import '../generation/generation.css';
import { FavoriteAction } from '../designs/FavoriteAction';
import { ApiError } from '../../api/client';
import { useDesignDetail } from './queries';
import { QueryFailure, StatusTag, TaskMetadata, TaskNotice } from './TaskViews';

export function DesignDetailPage({ accountId, id }: { accountId: string; id: string }) {
  const query = useDesignDetail(accountId, id);
  const task = query.data;
  const result = task?.result;
  const unavailable = query.error instanceof ApiError && query.error.status === 404;
  return <div className="design-detail">
    <div className="section-heading"><div><Typography.Title level={2}>设计详情</Typography.Title><Typography.Paragraph type="secondary">查看任务进度、效果图与设计说明。</Typography.Paragraph></div><Space><Button href="/app">返回工作台</Button><Button loading={query.isFetching} onClick={() => void query.refetch()}>刷新</Button></Space></div>
    {unavailable ? <Result status="404" title="设计记录不可用" subTitle="记录不存在或已不可访问。" extra={<Button href="/app">返回工作台</Button>} /> : <>
      {query.isError ? <QueryFailure error={query.error} stale={!!task} loading={query.isFetching} retry={() => void query.refetch()} /> : null}
      {query.isPending ? <Card><Skeleton active title paragraph={{ rows: 5 }} /></Card> : null}
      {task ? <>
        <Card title={task.title || '设计任务'} extra={<StatusTag status={task.status} />}><TaskMetadata task={task} /><FavoriteAction accountId={accountId} task={task} /><TaskNotice task={task} /><RetryActions accountId={accountId} task={task} /></Card>
        {task.outputFileId || result?.notices?.some(n => n.placement === 'NEAR_IMAGE') || result?.illustrativeShoes ? <Card title="效果图与使用提示">
          {task.outputFileId ? <div className="generation-result-image"><PrivateImage accountId={accountId} fileId={task.outputFileId} alt="本次设计效果图" /></div> : <Typography.Paragraph type="secondary">效果图尚未保存完成。</Typography.Paragraph>}
          <div className="generation-notices">{result?.notices?.filter(n => n.placement === 'NEAR_IMAGE').map((notice, index) => <Alert showIcon key={`${notice.code}-${index}`} type={notice.severity === 'WARNING' ? 'warning' : 'info'} title={notice.message} />)}
          {result?.illustrativeShoes && !result.notices?.some(n => n.code === 'ILLUSTRATIVE_SHOES' && n.placement === 'NEAR_IMAGE') ? <Alert showIcon type="info" title="鞋子为 AI 生成示意，非衣橱单品" description={result.illustrativeShoes.description} /> : null}</div>
        </Card> : null}
        {result ? <>
          {task.status !== 'SUCCEEDED' ? <Alert type="info" showIcon title="以下为已保存的方案文字" description="任务尚未完整成功，已保存的文字不代表效果图生成或结果保存全部完成。" /> : null}
          <Card title={result.title}>
            {result.matchLevel === 'APPROXIMATE' ? <Alert className="feature-notice" type="warning" showIcon title="本方案尽量接近你的目标，请留意适用局限" /> : null}
            {result.notices?.filter(n => n.placement !== 'NEAR_IMAGE').map((notice, index) => <Alert className="feature-notice" key={`${notice.code}-${index}`} showIcon type={notice.severity === 'WARNING' ? 'warning' : 'info'} title={notice.message} />)}
            {result.novelty?.description || result.novelty?.explanation ? <Typography.Paragraph>{result.novelty.description || result.novelty.explanation}</Typography.Paragraph> : null}
            <Typography.Paragraph className="task-text">{result.summary}</Typography.Paragraph>
            <Descriptions className="task-text" column={1} items={[
              { key: 'style', label: '风格', children: result.style },
              { key: 'occasion', label: '适用场合', children: result.occasion },
              { key: 'reason', label: '设计理由', children: result.designReason },
              { key: 'color', label: '配色建议', children: result.colorAdvice || '暂无建议' },
              { key: 'wearing', label: '整体穿着建议', children: result.wearingAdvice || '暂无建议' },
            ]} />
          </Card>
          {result.hairstyle ? <Card title="发型方案"><Descriptions className="task-text" column={1} items={[
            { key: 'name', label: '发型名称', children: result.hairstyle.hairstyleName },
            { key: 'length', label: '长度建议', children: result.hairstyle.lengthAdvice },
            { key: 'bangs', label: '刘海建议', children: result.hairstyle.bangsAdvice },
            { key: 'parting', label: '分缝建议', children: result.hairstyle.partingAdvice },
            { key: 'texture', label: '质感建议', children: result.hairstyle.textureAdvice },
            { key: 'color', label: '发色建议', children: result.hairstyle.hairColorAdvice },
            { key: 'care', label: '打理建议', children: result.hairstyle.careAdvice },
          ]} /></Card> : null}
          {result.items.length ? <Card title="穿搭单品"><div className="outfit-detail-list">{result.items.map((item, index) => <section key={`${item.dressId}-${index}`}><Typography.Title level={4}>{index + 1}. {item.dressName}</Typography.Title>{item.imageFileIds?.length ? <div className="generation-picker-grid">{item.imageFileIds.map(fileId => <PrivateImage key={fileId} accountId={accountId} fileId={fileId} thumbnail alt={item.dressName} />)}</div> : null}<Descriptions className="task-text" column={1} items={[
            { key: 'category', label: '分类', children: item.categoryName },
            { key: 'reason', label: '搭配理由', children: item.matchReason },
            { key: 'method', label: '穿着方式', children: item.wearingMethod },
          ]} /></section>)}</div></Card> : null}
          {!task.outputFileId ? <Alert type="info" showIcon title="暂无已保存的效果图" description={task.status === 'SUCCEEDED' ? '这条历史记录未提供可访问的效果图。' : '文字方案已保留；图片生成或保存完成后可在这里查看。'} /> : null}
        </> : <Card><Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无已保存的方案文字" /></Card>}
        {task.inputSummary ? <Card title="本次输入快照"><Typography.Paragraph className="task-text">{task.inputSummary.request.requirements || '没有额外设计要求'}</Typography.Paragraph><Descriptions column={1} items={[
          { key: 'occasion', label: '场合', children: task.inputSummary.request.occasion || '日常' },
          { key: 'style', label: '风格', children: task.inputSummary.request.style || '参考已有偏好' },
          { key: 'weather', label: '天气', children: task.inputSummary.request.weatherNote || '未提供' },
          { key: 'required', label: '必穿', children: task.inputSummary.requiredDresses?.map(d => d.dressName).join('、') || '未指定' },
          { key: 'overrides', label: '本次允许的例外', children: task.inputSummary.constraintOverrides?.map(v => v.originalText).join('；') || '无' },
        ]} />{task.inputSummary.personalContext ? <ContextDetails value={task.inputSummary.personalContext} /> : null}{task.inputSummary.personPhoto?.fileId ? <div className="generation-person-preview"><PrivateImage accountId={accountId} fileId={task.inputSummary.personPhoto.fileId} alt="提交时使用的本人照片" /></div> : null}</Card> : null}
      </> : null}
    </>}
  </div>;
}
