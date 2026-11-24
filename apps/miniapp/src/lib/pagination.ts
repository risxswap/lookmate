export interface PageResult<T> { items: T[]; page: number; pageSize: number; total: number }

/** A generation guards refresh/filter changes against late responses. Failures leave prior items intact. */
export class PagedList<T extends { id: string }> {
  items: T[] = [];
  page = 0;
  total = 0;
  loading = false;
  error = '';
  private generation = 0;
  private retryFirstPage = false;

  constructor(public readonly pageSize = 20) {}

  get hasMore(): boolean { return this.page === 0 || this.page * this.pageSize < this.total; }

  invalidate(): void {
    this.generation++;
    this.loading = false;
    this.retryFirstPage = false;
  }

  async load(fetcher: (page: number, pageSize: number) => Promise<PageResult<T>>, refresh = false): Promise<void> {
    if (!refresh && (this.loading || (!this.hasMore && !this.retryFirstPage))) return;
    const first = refresh || this.retryFirstPage;
    if (first) this.generation++;
    const generation = this.generation;
    this.loading = true;
    this.error = '';
    try {
      const result = await fetcher(first ? 1 : this.page + 1, this.pageSize);
      if (generation !== this.generation) return;
      const combined = first ? result.items : [...this.items, ...result.items];
      this.items = Array.from(new Map(combined.map(item => [item.id, item])).values());
      this.page = result.page;
      this.total = result.total;
      this.retryFirstPage = false;
    } catch (error) {
      if (generation !== this.generation) return;
      this.retryFirstPage = first;
      this.error = error instanceof Error ? error.message : '加载失败，请重试';
      throw error;
    } finally {
      if (generation === this.generation) this.loading = false;
    }
  }
}
