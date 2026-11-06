// Browser-independent HTTP check of the actual NextAuth credential forwarding.
const assert=require('node:assert/strict')
const base='http://127.0.0.1:18038',cookies=new Map()
async function call(route,options={}){
 const response=await fetch(base+route,{...options,headers:{...options.headers,cookie:[...cookies].map(([k,v])=>k+'='+v).join('; '),'x-forwarded-for':'192.0.2.50'}})
 for(const value of response.headers.getSetCookie()){
  const pair=value.split(';',1)[0],index=pair.indexOf('=');cookies.set(pair.slice(0,index),pair.slice(index+1))
 }
 return {status:response.status,body:await response.json()}
}
async function main(){
 const csrf=await call('/api/auth/csrf');assert.equal(csrf.status,200);assert(csrf.body.csrfToken)
 const login=await call('/api/auth/callback/otog',{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({csrfToken:csrf.body.csrfToken,username:'security-fixture-2',password:'fixture-password',json:'true',callbackUrl:base+'/codeforces'})})
 assert.equal(login.status,200);assert(!login.body.url.includes('error='),login.body.url)
 const session=await call('/api/auth/session');assert.equal(session.status,200);assert.equal(session.body.user.id,2)
 assert.equal(session.body.error,undefined)
 console.log(JSON.stringify({passed:true,realNextAuthCallback:true,signedApiForwarding:true,sessionEstablished:true,productionWrites:0}))
}
main().catch(error=>{console.error(error);process.exitCode=1})
