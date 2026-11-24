import { coverUrls, forgetFileImage } from '../lib/files';
import { assertAccount } from '../lib/request';
import { type PagedList, type PageResult } from '../lib/pagination';
import { errorMessage } from '../lib/ui';

export type PickerCover = { coverFileId: string; cover: string };

export async function loadPickerPage<T extends { id: string }>(
    list: PagedList<T>, fetchPage: (page: number, size: number) => Promise<PageResult<T>>,
    refresh: boolean, showError: (message: string) => void, showCovers: () => Promise<void>
) {
    try {
        await list.load(fetchPage, refresh);
    } catch (error) {
        showError(errorMessage(error));
        return;
    }
    showError('');
    await showCovers();
}

/** Publish the page first. Appending fetches only newly seen covers, explicit retry fills gaps. */
export async function showPickerCovers<T>(
    items: T[], fileId: (item: T) => string, displayed: () => PickerCover[], account: string,
    retryMissing: boolean, show: (rows: (T & PickerCover)[], failed: boolean) => void
) {
    assertAccount(account);
    const previous = new Map(displayed().map(row => [row.coverFileId, row.cover]));
    const rows = items.map(item => {
        const id = fileId(item);
        return { ...item, coverFileId: id, cover: previous.get(id) || '' };
    });
    const missing = rows.filter(row => row.coverFileId && !row.cover && (retryMissing || !previous.has(row.coverFileId)));
    show(rows, rows.some(row => previous.get(row.coverFileId) === '' && !!row.coverFileId));
    if (!missing.length) return;
    const { urls } = await coverUrls(missing.map(row => row.coverFileId), account, []);
    assertAccount(account);
    // A native image error may have invalidated an existing path while a new page was loading.
    const current = new Map(displayed().map(row => [row.coverFileId, row.cover]));
    const ready = rows.map(row => ({ ...row, cover: urls[row.coverFileId] || current.get(row.coverFileId) || '' }));
    show(ready, ready.some(row => !!row.coverFileId && !row.cover));
}

export function clearPickerCover<T extends PickerCover>(rows: T[], fileId: string, path: string) {
    if (!path || !rows.some(row => row.coverFileId === fileId && row.cover === path)) return;
    forgetFileImage(fileId, path);
    return rows.map(row => row.coverFileId === fileId && row.cover === path ? { ...row, cover: '' } : row);
}
