import { DatePicker } from 'antd';
import dayjs from 'dayjs';
import { isCalendarDate } from './birthDate';

export function BirthDateInput({ value, today, disabled, onChange }: {
  value: string;
  today: string;
  disabled: boolean;
  onChange: (value: string) => void;
}) {
  const calendarValid = isCalendarDate(value);
  const invalid = !!value && (!calendarValid || value > today);
  return <>
    <DatePicker id="profile-birth-date" aria-label="选择出生日期" aria-describedby="profile-birth-date-help" style={{ width: '100%' }} inputReadOnly allowClear value={calendarValid ? dayjs(value) : null} disabled={disabled} format="YYYY-MM-DD" placeholder="选择日期" status={invalid ? 'error' : undefined} disabledDate={date => date.format('YYYY-MM-DD') > today || date.year() < 1000} onChange={date => onChange(date?.format('YYYY-MM-DD') ?? '')} />
    <small id="profile-birth-date-help" className={invalid ? 'pp-error' : undefined} role={invalid ? 'alert' : undefined}>{invalid ? '请选择 1000-01-01 至今天之间的有效日期。' : '年龄根据出生日期计算，不单独存储。'}</small>
  </>;
}
