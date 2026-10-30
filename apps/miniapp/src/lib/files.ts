import { API_BASE } from '../config';
import { assertAccount, request, tokenHeaders } from './request';
import { getAccount } from './auth';
interface Intent {fileId:string;key:string;uploadUrl:string;token:string;expiresAt:string}
interface Asset {id:string;status:string;validationError:string|null}
export async function chooseAndUpload(count=1):Promise<string[]> {
  const owner=getAccount()?.id;
  const result=await new Promise<WechatMiniprogram.ChooseMediaSuccessCallbackResult>((resolve,reject)=>wx.chooseMedia({count:Math.min(9,count),mediaType:['image'],sourceType:['album','camera'],sizeType:['original'],success:resolve,fail:reject}));
  assertAccount(owner);
  const ids:string[]=[];
  for(const item of result.tempFiles) { assertAccount(owner); ids.push(await uploadImage(item.tempFilePath,item.size)); assertAccount(owner); }
  return ids;
}
export async function uploadImage(path:string,size:number):Promise<string> {
  const owner=getAccount()?.id;
  if(size>20*1024*1024)throw new Error('单张照片不能超过 20 MiB');
  const info=await new Promise<WechatMiniprogram.GetImageInfoSuccessCallbackResult>((resolve,reject)=>wx.getImageInfo({src:path,success:resolve,fail:reject}));
  assertAccount(owner);
  const type=info.type.toLowerCase();const mime=type==='jpg'||type==='jpeg'?'image/jpeg':type==='png'?'image/png':type==='webp'?'image/webp':null;
  if(!mime)throw new Error('请选择 JPEG、PNG 或 WebP 图片；不支持 HEIC');
  const intent=await request<Intent>('/files/upload-intents',{method:'POST',body:{originalName:`photo.${type==='jpeg'?'jpg':type}`,sizeBytes:size,mimeType:mime}});
  assertAccount(owner);
  await new Promise<void>((resolve,reject)=>wx.uploadFile({url:intent.uploadUrl,filePath:path,name:'file',formData:{key:intent.key,token:intent.token},success:r=>r.statusCode>=200&&r.statusCode<300?resolve():reject(new Error('图片上传失败，请重新选择并上传')),fail:()=>reject(new Error('图片上传中断，请重新选择并上传'))}));
  assertAccount(owner);
  const asset=await request<Asset>(`/files/${intent.fileId}/complete`,{method:'POST'});
  assertAccount(owner);
  if(!['TEMP','READY'].includes(asset.status))throw new Error(asset.validationError||'图片尚未登记为可用，请重新上传');
  return intent.fileId;
}
export async function fileUrl(id:string,variant:'THUMBNAIL'|'DISPLAY'|'ORIGINAL'='DISPLAY'):Promise<string> {
  const value=await request<{url:string;expiresAt:string}>(`/files/${encodeURIComponent(id)}/access`,{method:'POST',body:{variant}});return value.url;
}
export async function fileUrls(ids:string[]):Promise<Record<string,string>> {
  const entries=await Promise.all([...new Set(ids)].filter(Boolean).map(async id=>[id,await fileUrl(id)] as const));return Object.fromEntries(entries);
}
const imageCache=new Map<string,string>();
/** Platform catalogue images are authenticated. Only send credentials to our own API origin. */
export async function displayUrl(source:string):Promise<string> {
  const root=API_BASE.replace(/\/api\/?$/,'');
  const url=source.startsWith('/')?root+source:source;
  if(!url.startsWith(`${API_BASE}/`))return url;
  const owner=getAccount()?.id;
  const key=`${owner||''}:${url}`;const cached=imageCache.get(key);if(cached)return cached;
  const local=await download(url,true);
  assertAccount(owner);
  if(imageCache.size>=80)imageCache.delete(imageCache.keys().next().value!);
  imageCache.set(key,local);return local;
}
export async function download(url:string,authenticated=false):Promise<string> {
  const owner=getAccount()?.id;
  const local=await new Promise<string>((resolve,reject)=>wx.downloadFile({url,header:authenticated?tokenHeaders():{},success:r=>r.statusCode===200?resolve(r.tempFilePath):reject(new Error('图片下载失败，请刷新后重试')),fail:()=>reject(new Error('图片下载失败，请检查网络'))}));
  assertAccount(owner); return local;
}
export async function saveImage(url:string):Promise<void> {
  const owner=getAccount()?.id;
  const filePath=/^https?:\/\//.test(url)?await download(url,url.startsWith(`${API_BASE}/`)):url;
  assertAccount(owner);
  try {await new Promise<void>((resolve,reject)=>wx.saveImageToPhotosAlbum({filePath,success:()=>resolve(),fail:reject}));wx.showToast({title:'已保存到相册',icon:'success'});}
  catch(error) {
    const setting=await new Promise<WechatMiniprogram.GetSettingSuccessCallbackResult>(resolve=>wx.getSetting({success:resolve,fail:()=>resolve({authSetting:{},subscriptionsSetting:{mainSwitch:false,itemSettings:{}},errMsg:''})}));
    if(setting.authSetting['scope.writePhotosAlbum']===false)wx.showModal({title:'需要相册权限',content:'请在设置中允许保存到相册后，再点击保存图片。',confirmText:'打开设置',success:r=>{if(r.confirm)wx.openSetting({});}});
    else throw new Error('图片未保存，请稍后重试');
  }
}
