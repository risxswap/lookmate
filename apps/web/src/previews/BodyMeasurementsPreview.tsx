import { StrictMode, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ConfigProvider } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import { BodyMeasurementEditor, type BodyGender } from '../features/profile/BodyMeasurementEditor';
import { emptyMeasurements } from '../features/profile/queries';
import './body-measurements-preview.css';
function Preview() {
  const [gender, setGender] = useState<BodyGender>('FEMALE');
  const [values, setValues] = useState(emptyMeasurements);
  return <ConfigProvider locale={zhCN} theme={{ token: { colorPrimary: '#315c50', colorText: '#273d34', borderRadius: 7, fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif' } }}><main className="body-preview"><header className="body-preview-header"><span className="body-preview-brand">lookmate<span>个人形象档案</span></span><span className="body-preview-badge">交互预览 · 不保存</span></header><div className="body-preview-heading"><p>MY MEASUREMENTS</p><h1>身体尺寸</h1><span>认识自己的比例，让每一次穿搭更合身。</span></div><BodyMeasurementEditor gender={gender} values={values} onGenderChange={setGender} onChange={(key, value) => setValues(previous => ({ ...previous, [key]: value }))} /><footer>当前为人体图与填写交互预览。数据仅保留在此页面，刷新后清空，不会修改个人资料。</footer></main></ConfigProvider>;
}
createRoot(document.getElementById('root')!).render(<StrictMode><Preview /></StrictMode>);
