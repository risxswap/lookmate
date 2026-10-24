import { theme } from 'antd';
import type { ReactNode } from 'react';
import './PageActionBar.css';

/** Page-level status and actions; the owning page controls all action behavior. */
export function PageActionBar({ status, children }: { status?: ReactNode; children: ReactNode }) {
  const { token } = theme.useToken();
  return <footer className="page-action-bar" style={{ background: token.colorBgContainer, borderColor: token.colorBorderSecondary, boxShadow: token.boxShadowTertiary }}>
    {status && <div className="page-action-bar-status">{status}</div>}
    <div className="page-action-bar-actions">{children}</div>
  </footer>;
}
