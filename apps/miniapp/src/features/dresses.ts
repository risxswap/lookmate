import { request } from '../lib/request';
import type { Dress } from '../types/api';

interface DressForm {
    name: string;
    categoryId: string;
    color: string;
    notes: string;
    seasons: string[];
    images: { id?: string; fileId: string }[];
}

export async function saveDress(form: DressForm, previous: Dress | null): Promise<Dress> {
    const name = form.name.trim();
    const color = form.color || null;
    const notes = form.notes || null;
    const unchangedImages = previous && form.images.length === previous.images.length &&
        form.images.every((image, index) => image.id === previous.images[index].id);
    const changes = {
        ...(!previous || name !== previous.name ? { name } : {}),
        ...(!previous || form.categoryId !== previous.categoryId ? { categoryId: form.categoryId } : {}),
        ...(!previous || color !== previous.color ? { color } : {}),
        ...(!previous || notes !== previous.notes ? { notes } : {}),
        ...(!previous || form.seasons.length !== previous.seasons.length ||
            form.seasons.some(season => !previous.seasons.includes(season)) ? { seasons: form.seasons } : {}),
        ...(!unchangedImages ? { images: form.images.map(image => image.id ? { imageId: image.id } : { fileId: image.fileId }) } : {})
    };
    if (!previous) return request<Dress>('/dresses', { method: 'POST', body: changes });
    if (!Object.keys(changes).length) return previous;
    return request<Dress>(`/dresses/${previous.id}`, { method: 'PATCH', body: changes });
}
