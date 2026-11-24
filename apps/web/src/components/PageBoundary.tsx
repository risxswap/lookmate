import { Button, Spin } from 'antd';
import { Component, Suspense, type ReactNode } from 'react';

export class PageBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  render() {
    if (this.state.failed) {
      return <div role="alert" className="loading-page">
        <p>页面暂时无法显示，请刷新后重试。</p>
        <Button onClick={() => window.location.reload()}>刷新页面</Button>
      </div>;
    }
    return <Suspense fallback={<div className="loading-page" role="status">
      <Spin description="正在加载页面"><div className="loading-space" /></Spin>
    </div>}>{this.props.children}</Suspense>;
  }
}
