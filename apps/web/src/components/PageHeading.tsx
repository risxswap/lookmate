import type { ReactNode } from 'react';
import { Button, Typography } from 'antd';
import { goBack } from '../app/navigation';

export function PageHeading({ title, description, action, backFallback }: { backFallback?: string; title: string; description?: string; action?: ReactNode }) {
  return <div className="section-heading page-heading">
    <div className="page-heading-copy">
      <div className="page-heading-row">
        <Button type="text" className="page-heading-back" onClick={() => goBack(backFallback)}><span aria-hidden>←</span> 返回</Button>
        <span className="page-heading-divider" aria-hidden />
        <Typography.Title level={2}>{title}</Typography.Title>
      </div>
      {description ? <Typography.Paragraph type="secondary">{description}</Typography.Paragraph> : null}
    </div>
    {action ? <div className="page-heading-actions">{action}</div> : null}
  </div>;
}
