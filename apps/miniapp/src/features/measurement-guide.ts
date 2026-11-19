import { measurementGroups, type MeasurementKey, type Profile } from '../types/api';

export interface MeasurementGuide {
    label: string;
    hint: string;
    view: string;
    image: string;
}

const footViews: Partial<Record<MeasurementKey, string>> = {
    leftFootLength: '本人左脚 · 俯视',
    leftFootWidth: '本人左脚 · 俯视',
    rightFootLength: '本人右脚 · 俯视',
    rightFootWidth: '本人右脚 · 俯视'
};

export function measurementGuide(key: string, gender: Profile['gender']): MeasurementGuide | null {
    for (const group of measurementGroups) {
        const field = group.fields.find(([fieldKey]) => fieldKey === key);
        if (!field) continue;
        const [fieldKey, label, hint] = field;
        if (fieldKey === 'weight') return { label, hint, view: '', image: '' };
        const foot = footViews[fieldKey];
        const view = foot || (fieldKey === 'head' ? '头部' :
            fieldKey === 'backWidth' || fieldKey === 'backWaistLength' ? '背面' : '正面');
        // Match the Web editor's display fallback without changing the profile.
        const stem = foot ? fieldKey : `${gender === 'MALE' ? 'male' : 'female'}-${fieldKey}`;
        return { label, hint, view, image: `/assets/measurements/${stem}.png` };
    }
    return null;
}
