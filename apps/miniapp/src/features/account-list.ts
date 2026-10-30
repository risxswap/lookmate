import { getAccount } from '../lib/auth';
import { PagedList as BaseList, type PageResult } from '../lib/pagination';
/** List caches survive page recreation, but must never carry records into another account. */
export class PagedList<T extends {id:string}> extends BaseList<T> {
  private accountId: string | undefined;
  override async load(fetcher:(page:number,pageSize:number)=>Promise<PageResult<T>>,refresh=false):Promise<void> {
    const accountId=getAccount()?.id;
    if(accountId!==this.accountId){
      this.invalidate();this.items=[];this.page=0;this.total=0;this.error='';
      this.accountId=accountId;refresh=true;
    }
    return super.load(fetcher,refresh);
  }
}
