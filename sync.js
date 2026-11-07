/* Flix – đồng bộ tài khoản giữa điện thoại và TV (Supabase) */
(function(){
// ===== ĐIỀN 2 DÒNG NÀY (Supabase → Project Settings → API) =====
var CFG={url:"https://YOUR-PROJECT.supabase.co",key:"YOUR-ANON-KEY"};
// ================================================================
var LS=window.localStorage;
function J(k,d){try{var v=JSON.parse(LS.getItem(k));return v===null||v===undefined?d:v}catch(e){return d}}
function W(k,v){try{LS.setItem(k,JSON.stringify(v))}catch(e){}}
function rm(k){try{LS.removeItem(k)}catch(e){}}
function msg(j){var m=String(j.msg||j.error_description||j.message||j.error||"Lỗi không xác định");
 if(/invalid login/i.test(m))return"Sai tên đăng nhập hoặc mật khẩu";
 if(/already registered|already exists/i.test(m))return"Tên đăng nhập đã tồn tại";
 if(/password/i.test(m)&&/6|short|least/i.test(m))return"Mật khẩu tối thiểu 6 ký tự";
 if(/confirm/i.test(m))return"Cần tắt Confirm email trong Supabase";
 if(/login required/i.test(m))return"Hãy đăng nhập trên điện thoại trước";
 return m}
function post(path,body){
 return fetch(CFG.url+path,{method:"POST",headers:{apikey:CFG.key,"Content-Type":"application/json"},body:JSON.stringify(body)})
 .then(function(r){return r.json().then(function(j){if(!r.ok)throw new Error(msg(j));return j})})}
function rpc(name,args,token){
 var h={apikey:CFG.key,"Content-Type":"application/json"};if(token)h.Authorization="Bearer "+token;
 return fetch(CFG.url+"/rest/v1/rpc/"+name,{method:"POST",headers:h,body:JSON.stringify(args||{})})
 .then(function(r){return r.text().then(function(t){
  if(!r.ok){var j={};try{j=JSON.parse(t)}catch(e){}throw new Error(msg(j)||("Lỗi "+r.status))}
  return t?JSON.parse(t):null})})}
function store(j,user){
 if(!j.access_token)throw new Error("Cần tắt Confirm email trong Supabase (Authentication → Providers → Email)");
 var s={access:j.access_token,refresh:j.refresh_token,exp:Date.now()+(j.expires_in||3600)*1000-60000,uid:j.user.id,user:user};
 W("sb",s);W("session",user);return s}
function tok(){
 var s=J("sb",null);if(!s)return Promise.reject(new Error("Chưa đăng nhập"));
 if(Date.now()<s.exp)return Promise.resolve(s.access);
 return post("/auth/v1/token?grant_type=refresh_token",{refresh_token:s.refresh}).then(function(j){return store(j,s.user).access})}
function rest(method,body,qs){
 return tok().then(function(t){
  var h={apikey:CFG.key,Authorization:"Bearer "+t,"Content-Type":"application/json"};
  if(method==="POST")h.Prefer="resolution=merge-duplicates,return=minimal";
  return fetch(CFG.url+"/rest/v1/profiles"+(qs||""),{method:method,headers:h,body:body?JSON.stringify(body):undefined})
  .then(function(r){if(!r.ok)throw new Error("Đồng bộ lỗi "+r.status);return method==="GET"?r.json():null})})}
function rnd(n,al){var o="",a,i;
 if(window.crypto&&crypto.getRandomValues){a=new Uint8Array(n);crypto.getRandomValues(a);for(i=0;i<n;i++)o+=al.charAt(a[i]%al.length)}
 else for(i=0;i<n;i++)o+=al.charAt(Math.floor(Math.random()*al.length));
 return o}
function mgl(a,b){var m={},o=[],k;(a||[]).concat(b||[]).forEach(function(x){var id=x.s+"|"+x.slug,p=m[id];if(!p||(x.t||0)>(p.t||0))m[id]=x});
 for(k in m)o.push(m[k]);o.sort(function(x,y){return(y.t||0)-(x.t||0)});return o}
function merge(a,b){
 var r={},w;
 r.hc=Math.max(a.hc||0,b.hc||0);
 r.hist=mgl(a.hist,b.hist).filter(function(x){return!r.hc||(x.t||0)>r.hc}).slice(0,60);
 if(a.ft||b.ft){w=(a.ft||0)>=(b.ft||0)?a:b;r.fav=w.fav||[];r.ft=Math.max(a.ft||0,b.ft||0)}else r.fav=mgl(a.fav,b.fav);
 r.mt=Math.max(a.mt||0,b.mt||0);
 if(a.mt||b.mt){w=(a.mt||0)>=(b.mt||0)?a:b;r.name=w.name;r.avatar=w.avatar}
 else{r.name=a.name&&a.name!=="Khách"?a.name:(b.name||a.name);r.avatar=a.avatar||b.avatar}
 return r}
var busy=false,again=false,T;
var S={
 cfg:CFG,
 on:function(){return/^https:\/\/[^\/]+\.supabase\.co/.test(CFG.url)&&CFG.url.indexOf("YOUR")<0&&CFG.key&&CFG.key.indexOf("YOUR")<0},
 linked:function(){return!!(J("sb",null)||J("tvlink",null))},
 signup:function(u,p){return post("/auth/v1/signup",{email:u+"@flixuser.com",password:p}).then(function(j){
   if(j.access_token)return store(j,u);return S.login(u,p)})},
 login:function(u,p){return post("/auth/v1/token?grant_type=password",{email:u+"@flixuser.com",password:p}).then(function(j){return store(j,u)})},
 logout:function(){var tl=J("tvlink",null);if(tl)rpc("tv_unlink",{p_secret:tl.secret}).catch(function(){});rm("sb");rm("tvlink");rm("tvpair")},
 /* Phone: nhập mã hiển thị trên TV */
 approve:function(code){return tok().then(function(t){return rpc("tv_approve",{p_code:String(code).toUpperCase()},t)})},
 /* TV: tạo mã, chờ điện thoại duyệt */
 tvStart:function(n){
  var secret=rnd(32,"0123456789abcdef"),code=rnd(6,"ABCDEFGHJKMNPQRSTUVWXYZ23456789");
  return rpc("tv_start",{p_code:code,p_secret:secret}).then(function(){W("tvpair",{code:code,secret:secret});return code})
  .catch(function(e){if((n||0)<2)return S.tvStart((n||0)+1);throw e})},
 tvPoll:function(){var p=J("tvpair",null);if(!p)return Promise.resolve(null);
  return rpc("tv_poll",{p_code:p.code,p_secret:p.secret}).then(function(u){
   if(!u)return null;W("tvlink",{secret:p.secret,user:u});W("session",u);rm("tvpair");return u})},
 touch:function(){if(!S.on()||!S.linked())return;clearTimeout(T);T=setTimeout(S.flush,2500)},
 flush:function(){
  if(!S.on()||!S.linked())return Promise.resolve();
  if(busy){again=true;return Promise.resolve()}
  busy=true;var tl=J("tvlink",null),s=J("sb",null),user=tl?tl.user:s.user,k="u:"+user,p;
  if(tl)p=rpc("tv_pull",{p_secret:tl.secret}).then(function(remote){
    var local=J(k,{}),m=remote?merge(local,remote):local;W(k,m);return rpc("tv_push",{p_secret:tl.secret,p_data:m})});
  else p=rest("GET",null,"?select=data&user_id=eq."+s.uid).then(function(rows){
    var local=J(k,{}),remote=rows&&rows[0]?rows[0].data:null,m=remote?merge(local,remote):local;W(k,m);
    return rest("POST",{user_id:s.uid,data:m,updated_at:new Date().toISOString()})});
  return p.then(function(){busy=false;try{window.dispatchEvent(new Event("syncdone"))}catch(e){}if(again){again=false;S.flush()}})
  .catch(function(e){busy=false;again=false;if(window.console)console.log(e)})}
};
window.Sync=S;
})();
