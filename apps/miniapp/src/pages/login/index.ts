import { bind, bindingTicket, ensureSession, manualLogin, register } from '../../lib/auth';
import { errorMessage } from '../../lib/ui';
Page({
  data:{busy:false,error:'',unbound:false,existing:false,username:'',password:''},
  onShow(){this.setData({unbound:!!bindingTicket()});},
  async login(){
    if(this.data.busy)return;this.setData({busy:true,error:''});
    try{const result=await manualLogin();if(result.status==='UNBOUND')this.setData({unbound:true});else this.finish();}
    catch(error){this.setData({error:errorMessage(error)});}finally{this.setData({busy:false});}
  },
  async create(){if(this.data.busy)return;this.setData({busy:true,error:''});try{await register();this.finish();}catch(error){this.setData({error:errorMessage(error)});}finally{this.setData({busy:false});}},
  chooseExisting(){this.setData({existing:true,error:''});},
  setUsername(e:WechatMiniprogram.CustomEvent){this.setData({username:e.detail.value});},
  setPassword(e:WechatMiniprogram.CustomEvent){this.setData({password:e.detail.value});},
  async bind(){if(this.data.busy)return;if(!this.data.username||!this.data.password){this.setData({error:'请填写原账号和密码'});return;}this.setData({busy:true,error:''});try{await bind(this.data.username,this.data.password);this.setData({password:''});this.finish();}catch(error){this.setData({error:errorMessage(error)});}finally{this.setData({busy:false});}},
  finish(){const pages=getCurrentPages();const previous=pages[pages.length-2];if(previous?.route==='pages/scan/index')wx.navigateBack();else wx.reLaunch({url:'/pages/home/index'});},
});
